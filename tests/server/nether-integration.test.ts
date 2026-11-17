import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { findSafeTeleport } from '../../src/world/safeStand';
import { lightNetherPortal } from '../../src/world/netherPortal';
import { volumeContains } from '../../server/services/selection';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { bindNamedOperatorFixture } from './helpers/operatorFixture';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-nether-integration-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

describe('nether integration', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    bindNamedOperatorFixture(world, result.player);
    return { ...result, sink };
  }

  it('keeps explosions and mob spawns inside the dimension that created them', async () => {
    const world = await boot();
    const x = 40;
    const y = 70;
    const z = 40;
    const volume = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
    world.pluginStore.save('claims/claims', {
      claims: [
        {
          id: 'overworld-quiet',
          name: 'overworld-quiet',
          owner: 'zone-owner',
          worldId: world.worldId,
          volume,
          members: [],
          priority: 0,
          flags: { explosions: false, 'mob-spawn': false },
        },
        {
          id: 'nether-quiet',
          name: 'nether-quiet',
          owner: 'zone-owner',
          worldId: `${world.worldId}:nether`,
          volume: { minX: x + 8, minY: y, minZ: z, maxX: x + 8, maxY: y, maxZ: z },
          members: [],
          priority: 0,
          flags: { explosions: false, 'mob-spawn': false },
        },
      ],
    });
    const netherBlast = world.events.createExplosion(x, y, z, 3, 4, 'nether');
    world.events.emit('explosion', netherBlast);
    expect(netherBlast.cancelled).toBe(false);
    const overworldBlast = world.events.createExplosion(x, y, z, 3, 4, 'overworld');
    world.events.emit('explosion', overworldBlast);
    expect(overworldBlast.cancelled).toBe(true);
    const netherSpawn = world.events.createMobSpawn('zombie', x, y, z, 'nether');
    world.events.emit('mobSpawn', netherSpawn);
    expect(netherSpawn.cancelled).toBe(false);
    const overworldSpawn = world.events.createMobSpawn('zombie', x, y, z, 'overworld');
    world.events.emit('mobSpawn', overworldSpawn);
    expect(overworldSpawn.cancelled).toBe(true);
    const netherDenied = world.events.createMobSpawn('zombie', x + 8, y, z, 'nether');
    world.events.emit('mobSpawn', netherDenied);
    expect(netherDenied.cancelled).toBe(true);
    const overworldVolumes = world.gameplay.loadRegularClaimVolumes?.() ?? [];
    const netherVolumes = world.netherGameplay.loadRegularClaimVolumes?.() ?? [];
    expect(overworldVolumes.some((entry) => volumeContains(entry, x, y, z))).toBe(true);
    expect(netherVolumes.some((entry) => volumeContains(entry, x, y, z))).toBe(false);
    expect(netherVolumes.some((entry) => volumeContains(entry, x + 8, y, z))).toBe(true);
    expect(world.gameplay.dimension).toBe('overworld');
    expect(world.netherGameplay.dimension).toBe('nether');
  });

  it('moves wolf and cat with the owner and leaves no copy behind', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(8.5, 80, 8.5), {
      ownerId: ada.player.id,
      force: true,
    });
    const cat = world.gameplay.mobs.spawn('cat', new Vec3(9.5, 80, 8.5), {
      ownerId: ada.player.id,
      force: true,
      catVariant: 'red',
      sitting: true,
    });
    expect(wolf).toBeDefined();
    expect(cat).toBeDefined();
    const surface = world.netherWorld.surfaceY(8, 8);
    expect(world.enterDimension(ada.player, 'nether', 8.5, surface + 2, 8.5)).toBe(true);
    expect(world.gameplay.mobs.entities.some((mob) => mob.id === wolf!.id || mob.id === cat!.id)).toBe(false);
    const movedWolf = world.netherGameplay.mobs.entities.find((mob) => mob.id === wolf!.id);
    const movedCat = world.netherGameplay.mobs.entities.find((mob) => mob.id === cat!.id);
    expect(movedWolf?.ownerId).toBe(ada.player.id);
    expect(movedCat?.ownerId).toBe(ada.player.id);
    expect(movedCat?.catVariant).toBe('red');
    expect(movedCat?.sitting).toBe(true);
    expect(world.enterDimension(ada.player, 'overworld', 8.5, 80, 8.5)).toBe(true);
    expect(world.netherGameplay.mobs.entities.some((mob) => mob.id === wolf!.id || mob.id === cat!.id)).toBe(false);
    expect(world.gameplay.mobs.entities.find((mob) => mob.id === wolf!.id)?.ownerId).toBe(ada.player.id);
    expect(world.gameplay.mobs.entities.find((mob) => mob.id === cat!.id)?.ownerId).toBe(ada.player.id);
  });

  it('reattaches a cosmetic pet in the destination dimension', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.permissions.op(ada.player.id);
    ada.player.cosmeticPet = 'bee';
    const surface = world.netherWorld.surfaceY(12, 12);
    world.netherWorld.setBlock(12, surface + 1, 12, BlockId.Air);
    world.netherWorld.setBlock(12, surface + 2, 12, BlockId.Air);
    world.netherWorld.setBlock(12, surface + 3, 12, BlockId.Air);
    expect(world.enterDimension(ada.player, 'nether', 12.5, surface + 1, 12.5)).toBe(true);
    const bee = world.netherGameplay.mobs.entities.find((mob) => mob.ownerId === ada.player.id && mob.kind === 'pet_bee');
    expect(bee).toBeDefined();
    expect(world.gameplay.mobs.entities.some((mob) => mob.kind === 'pet_bee')).toBe(false);
    expect(world.enterDimension(ada.player, 'overworld', 12.5, 90, 12.5)).toBe(true);
    expect(world.netherGameplay.mobs.entities.some((mob) => mob.kind === 'pet_bee')).toBe(false);
    expect(world.gameplay.mobs.entities.some((mob) => mob.ownerId === ada.player.id && mob.kind === 'pet_bee')).toBe(true);
  });

  it('channels an overworld portal into a safe nether stand', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const base = 220;
    const place = (x: number, y: number, z: number) => world.world.setBlock(x, y, z, BlockId.Obsidian);
    for (let y = base + 1; y <= base + 3; y += 1) {
      place(0, y, 0);
      place(3, y, 0);
    }
    place(1, base, 0);
    place(2, base, 0);
    place(1, base + 4, 0);
    place(2, base + 4, 0);
    expect(lightNetherPortal(world.world, 1, base + 2, 0)?.cells.length).toBe(6);
    const safe = findSafeTeleport(world.netherWorld, 1.5, 80, 0.5, 10);
    expect(safe).toBeDefined();
    ada.player.controller.teleport([1.5, base + 1, 0.5]);
    ada.player.portalChannelStartedAt = Date.now() - 3_000;
    world.tick();
    expect(ada.player.dimension).toBe('nether');
    expect(ada.player.controller.position.y).toBeGreaterThan(1);
  });
});
