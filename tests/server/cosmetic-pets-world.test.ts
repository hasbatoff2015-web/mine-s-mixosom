import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { isCosmeticPetKind } from '../../src/entities/cosmeticPets';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

const dirs: string[] = [];
const worlds: WorldInstance[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.stop();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: false,
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: Array<{ type?: string; ok?: boolean; lines?: string[]; text?: string }> = [];
  send(payload: unknown): void {
    this.payloads.push(payload as { type?: string; ok?: boolean; lines?: string[] });
  }
}

function lines(sink: MemorySink): string[] {
  return sink.payloads.flatMap((payload) => payload.lines ?? []);
}

async function boot(dir?: string) {
  const dataDir = dir ?? await mkdtemp(join(tmpdir(), 'fc-cosmetic-'));
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const world = new WorldInstance(testConfig(dataDir));
  worlds.push(world);
  await world.initialize();
  return { world, dataDir };
}

function pad(world: WorldInstance, x: number, z: number, y = 80) {
  for (let dx = -6; dx <= 6; dx += 1) {
    for (let dz = -6; dz <= 6; dz += 1) {
      world.world.setBlock(x + dx, y - 1, z + dz, BlockId.Stone);
      for (let height = 0; height <= 4; height += 1) world.world.setBlock(x + dx, y + height, z + dz, BlockId.Air);
    }
  }
}

describe('cosmetic pets on the anarchy world', () => {
  it('spawns one owned pet, switches it, and clears it', async () => {
    const { world } = await boot();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Owner' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    pad(world, 20, 20);
    player.controller.teleport([20.5, 80, 20.5]);
    world.permissions.op(player.name);
    world.permissions.op(player.id);
    world.handleChat(player, '/spawnpet bee');
    world.handleChat(player, '/spawnpet bee');
    let pets = world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind));
    expect(pets).toHaveLength(1);
    expect(pets[0]?.kind).toBe('pet_bee');
    expect(pets[0]?.ownerId).toBe(player.id);
    expect(player.cosmeticPet).toBe('bee');
    expect(lines(sink).some((line) => line.includes('уже рядом'))).toBe(true);
    world.handleChat(player, '/petspawn creeper');
    pets = world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind));
    expect(pets).toHaveLength(1);
    expect(pets[0]?.kind).toBe('pet_creeper');
    expect(player.cosmeticPet).toBe('creeper');
    expect(world.gameplay.mobs.serialize().some((entry) => isCosmeticPetKind(entry.kind))).toBe(false);
    world.handleChat(player, '/spawnpet off');
    world.handleChat(player, '/spawnpet off');
    expect(world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind))).toHaveLength(0);
    expect(player.cosmeticPet).toBeNull();
    expect(lines(sink).some((line) => line.includes('отключён'))).toBe(true);
  }, 40_000);

  it('removes a bee or mini creeper with /spawnpet off and does not restore it', async () => {
    const { world, dataDir } = await boot();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Owner' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const token = player.sessionToken;
    pad(world, 20, 20);
    player.controller.teleport([20.5, 80, 20.5]);
    world.permissions.op(player.id);
    world.handleChat(player, '/spawnpet bee');
    expect(world.gameplay.mobs.entities.some((mob) => mob.kind === 'pet_bee')).toBe(true);
    world.handleChat(player, '/spawnpet off');
    for (let index = 0; index < 40; index += 1) world.tick();
    expect(world.gameplay.mobs.entities.some((mob) => isCosmeticPetKind(mob.kind))).toBe(false);
    expect(player.cosmeticPet).toBeNull();
    world.disconnect(player.id);
    const resumed = world.join({ sink: new MemorySink(), name: 'Owner', sessionToken: token });
    if ('error' in resumed) throw new Error(resumed.error);
    for (let index = 0; index < 25; index += 1) world.tick();
    expect(resumed.player.cosmeticPet).toBeNull();
    expect(world.gameplay.mobs.entities.some((mob) => isCosmeticPetKind(mob.kind))).toBe(false);
    world.disconnect(resumed.player.id);
    await world.stop();
    worlds.splice(0, worlds.length);
    const restarted = await boot(dataDir);
    const again = restarted.world.join({ sink: new MemorySink(), name: 'Owner', sessionToken: token });
    if ('error' in again) throw new Error(again.error);
    expect(again.player.cosmeticPet).toBeNull();
    expect(restarted.world.gameplay.mobs.entities.some((mob) => isCosmeticPetKind(mob.kind))).toBe(false);
    pad(restarted.world, 20, 20);
    again.player.controller.teleport([20.5, 80, 20.5]);
    restarted.world.permissions.op(again.player.id);
    restarted.world.handleChat(again.player, '/spawnpet creeper');
    expect(restarted.world.gameplay.mobs.entities.some((mob) => mob.kind === 'pet_creeper')).toBe(true);
    restarted.world.handleChat(again.player, '/spawnpet off');
    restarted.world.handleChat(again.player, '/spawnpet off');
    for (let index = 0; index < 25; index += 1) restarted.world.tick();
    expect(again.player.cosmeticPet).toBeNull();
    expect(restarted.world.gameplay.mobs.entities.some((mob) => isCosmeticPetKind(mob.kind))).toBe(false);
    restarted.world.handleChat(again.player, '/spawnpet bee');
    expect(restarted.world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee')).toHaveLength(1);
  }, 60_000);

  it('restores one pet after reconnect and server restart, and ignores a bad save', async () => {
    const { world, dataDir } = await boot();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Owner' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    const token = player.sessionToken;
    pad(world, 24, 24);
    player.controller.teleport([24.5, 80, 24.5]);
    world.permissions.op(player.id);
    world.handleChat(player, '/spawnpet bee');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee')).toHaveLength(1);
    world.disconnect(player.id);
    expect(world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind))).toHaveLength(0);
    const resumed = world.join({ sink: new MemorySink(), name: 'Owner', sessionToken: token });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.cosmeticPet).toBe('bee');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee' && mob.ownerId === resumed.player.id)).toHaveLength(1);
    world.disconnect(resumed.player.id);
    await world.stop();
    worlds.splice(0, worlds.length);

    const restarted = await boot(dataDir);
    const again = restarted.world.join({ sink: new MemorySink(), name: 'Owner', sessionToken: token });
    if ('error' in again) throw new Error(again.error);
    expect(again.player.cosmeticPet).toBe('bee');
    expect(restarted.world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee')).toHaveLength(1);
    expect(restarted.world.gameplay.mobs.serialize().some((entry) => isCosmeticPetKind(entry.kind))).toBe(false);
    restarted.world.disconnect(again.player.id);
    await restarted.world.stop();
    worlds.splice(0, worlds.length);

    const playersPath = join(dataDir, 'anarchy', 'players.json');
    const saved = JSON.parse(await readFile(playersPath, 'utf8')) as { players: Record<string, { cosmeticPet?: string }> };
    const row = Object.values(saved.players)[0];
    if (!row) throw new Error('missing player row');
    row.cosmeticPet = 'dragon';
    await writeFile(playersPath, JSON.stringify(saved));
    const invalid = await boot(dataDir);
    const bad = invalid.world.join({ sink: new MemorySink(), name: 'Owner', sessionToken: token });
    if ('error' in bad) throw new Error(bad.error);
    expect(bad.player.cosmeticPet).toBeNull();
    expect(invalid.world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind))).toHaveLength(0);
  }, 60_000);

  it('snaps the pet on teleport and respawn and keeps two owners apart', async () => {
    const { world } = await boot();
    const ownerSink = new MemorySink();
    const ownerJoin = world.join({ sink: ownerSink, name: 'Owner' });
    const guestJoin = world.join({ sink: new MemorySink(), name: 'Guest' });
    if ('error' in ownerJoin || 'error' in guestJoin) throw new Error('join failed');
    pad(world, 20, 20);
    pad(world, 48, 20);
    ownerJoin.player.controller.teleport([20.5, 80, 20.5]);
    guestJoin.player.controller.teleport([23.5, 80, 20.5]);
    world.permissions.op(ownerJoin.player.id);
    world.permissions.op(guestJoin.player.id);
    world.handleChat(ownerJoin.player, '/spawnpet bee');
    world.handleChat(guestJoin.player, '/spawnpet creeper');
    expect(world.gameplay.mobs.entities.filter((mob) => isCosmeticPetKind(mob.kind))).toHaveLength(2);
    world.handleChat(ownerJoin.player, '/tp 48 80 20');
    const bee = world.gameplay.mobs.entities.find((mob) => mob.kind === 'pet_bee')!;
    expect(Math.hypot(bee.position.x - 48, bee.position.z - 20)).toBeLessThan(4);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_creeper')).toHaveLength(1);
    ownerJoin.player.gamemode = 'survival';
    ownerJoin.player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
    expect(ownerJoin.player.survival.dead).toBe(true);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee')).toHaveLength(1);
    expect(world.respawn(ownerJoin.player)).toBe(true);
    const after = world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee');
    expect(after).toHaveLength(1);
    expect(Math.hypot(
      after[0]!.position.x - ownerJoin.player.controller.position.x,
      after[0]!.position.z - ownerJoin.player.controller.position.z,
    )).toBeLessThan(6);
    for (let index = 0; index < 20; index += 1) world.tick();
    expect(world.gameplay.mobs.entities.filter((mob) => mob.ownerId === ownerJoin.player.id && isCosmeticPetKind(mob.kind))).toHaveLength(1);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.ownerId === guestJoin.player.id && mob.kind === 'pet_creeper')).toHaveLength(1);
  }, 40_000);
});
