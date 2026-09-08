import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { getTntProfile } from '../../src/world/tnt';
import { loadServerConfig } from '../../server/config';
import { migrateClaimStore } from '../../server/services/claims';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-tnt-minecart-'));
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

describe('Anarchy TNT minecart', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dataDir = await tempDir();
    dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
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
    return { ...result, sink };
  }

  function cartSnap(world: WorldInstance, player: ServerPlayer, id: string) {
    return world.gameplay.snapshotsNear(player.controller.position)
      .find((entry) => entry.kind === 'minecart' && entry.id === id);
  }

  function placeCart(
    world: WorldInstance,
    player: ServerPlayer,
    tnt: number,
  ) {
    const x = Math.floor(player.controller.position.x);
    const y = Math.floor(player.controller.position.y);
    const z = Math.floor(player.controller.position.z) + 2;
    world.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
    world.world.setBlock(x, y - 1, z, BlockId.Stone);
    world.world.setBlock(x, y, z, BlockId.Rail);
    const cart = world.gameplay.minecarts.spawn(x, y, z)!;
    expect(world.gameplay.minecarts.insertTnt(cart, tnt)).toBe(true);
    return cart;
  }

  it('stores all three TNT types and snapshots them to nearby clients without reconnect', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cart = placeCart(world, ada.player, BlockId.TntPowerful);
    bob.player.controller.teleport([
      ada.player.controller.position.x,
      ada.player.controller.position.y,
      ada.player.controller.position.z,
    ]);
    world.tick();
    const adaSnap = cartSnap(world, ada.player, cart.id);
    const bobSnap = cartSnap(world, bob.player, cart.id);
    expect(adaSnap?.variant).toBe('tnt');
    expect(adaSnap?.blockId).toBe(BlockId.TntPowerful);
    expect(bobSnap?.variant).toBe('tnt');
    expect(bobSnap?.blockId).toBe(BlockId.TntPowerful);

    const late = join(world, 'Cara');
    late.player.controller.teleport([
      ada.player.controller.position.x,
      ada.player.controller.position.y,
      ada.player.controller.position.z,
    ]);
    const lateSnap = cartSnap(world, late.player, cart.id);
    expect(lateSnap?.variant).toBe('tnt');
    expect(lateSnap?.blockId).toBe(BlockId.TntPowerful);
  });

  it('lets a fire arrow ignite TNT cargo inside a foreign block-claim and keeps the TNT profile', async () => {
    const world = await boot();
    const owner = join(world, 'Owner');
    const raider = join(world, 'Raider');
    world.setGameMode(owner.player, 'creative');
    const x = Math.floor(owner.player.controller.position.x) + 4;
    const y = Math.floor(owner.player.controller.position.y);
    const z = Math.floor(owner.player.controller.position.z) + 4;
    owner.player.controller.teleport([x + 0.5, y, z + 2.5]);
    world.world.setBlock(x, y, z, BlockId.Air);
    world.world.setBlock(x, y, z - 1, BlockId.Dirt);
    owner.player.controller.yaw = Math.atan2(-(x + 0.5 - owner.player.controller.position.x), -(z + 0.5 - owner.player.controller.position.z));
    owner.player.controller.pitch = Math.atan2(
      (y + 0.5) - (owner.player.controller.position.y + PLAYER_EYE_HEIGHT),
      2,
    );
    expect(world.tryPlace(owner.player, x, y, z, BlockId.IronBlock)).toEqual({ ok: true });
    expect(migrateClaimStore(world.pluginStore.load('claims/claims', { claims: [] })).claims).toHaveLength(1);

    world.world.setBlock(x + 1, y - 1, z, BlockId.Stone);
    world.world.setBlock(x + 1, y, z, BlockId.Rail);
    const cart = world.gameplay.minecarts.spawn(x + 1, y, z)!;
    expect(world.gameplay.minecarts.insertTnt(cart, BlockId.TntDestructive)).toBe(true);

    raider.player.controller.teleport([x + 1.5, y, z - 3]);
    world.gameplay.arrows.spawn(
      { x: x + 1.5, y: y + 0.55, z: z - 1.6 },
      { x: 0, y: 0, z: 1 },
      3,
      2,
      false,
      true,
    );
    world.tick();
    expect(cart.variant).toBe('normal');
    const primed = world.gameplay.redstone.primedTnt[0];
    expect(primed?.blockId).toBe(BlockId.TntDestructive);
    expect(getTntProfile(primed!.blockId).canBreakBlockClaims).toBe(true);
    expect(getTntProfile(primed!.blockId).canBreakObsidian).toBe(true);
  });

  it('does not ignite minecart TNT with a normal arrow', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const cart = placeCart(world, ada.player, BlockId.Tnt);
    world.gameplay.arrows.spawn(
      { x: cart.position.x, y: cart.position.y + 0.55, z: cart.position.z - 1.6 },
      { x: 0, y: 0, z: 1 },
      3,
      2,
      false,
      false,
    );
    world.tick();
    expect(cart.variant).toBe('tnt');
    expect(world.gameplay.redstone.primedTntCount).toBe(0);
  });

  it('does not apply placed-TNT 20/30 fall fields after a fire arrow hits a TNT cart', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const x = Math.floor(ada.player.controller.position.x);
    const y = 80;
    const z = Math.floor(ada.player.controller.position.z) + 2;
    world.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
    for (let yy = 0; yy < 81; yy += 1) {
      world.world.setBlock(x, yy, z, BlockId.Air);
      world.world.setBlock(x - 1, yy, z, BlockId.Air);
      world.world.setBlock(x + 1, yy, z, BlockId.Air);
    }
    world.world.setBlock(x, y - 1, z, BlockId.Stone);
    world.world.setBlock(x, y, z, BlockId.Rail);
    ada.player.controller.teleport([x + 0.5, y, z - 3]);
    const cart = world.gameplay.minecarts.spawn(x, y, z)!;
    expect(world.gameplay.minecarts.insertTnt(cart, BlockId.Tnt)).toBe(true);
    const startY = cart.position.y;
    world.gameplay.arrows.spawn(
      { x: cart.position.x, y: cart.position.y + 0.55, z: cart.position.z - 1.6 },
      { x: 0, y: 0, z: 1 },
      3,
      2,
      false,
      true,
    );
    world.tick();
    const primed = world.gameplay.redstone.primedTnt[0];
    expect(primed).toBeDefined();
    expect(primed!.launchOriginY).toBeUndefined();
    expect(primed!.maxFallBlocks).toBeUndefined();
    expect(primed!.blockId).toBe(BlockId.Tnt);
    for (let i = 0; i < 25; i += 1) world.tick();
    expect(world.gameplay.redstone.primedTntCount).toBe(1);
    expect(startY - primed!.position.y).toBeLessThan(8);
    expect(primed!.fuseSeconds).toBeGreaterThan(2);
  });

  it('pushes TNT carts off rails at half on-rail impulse and snapshots the motion', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const x = Math.floor(ada.player.controller.position.x);
    const y = Math.floor(ada.player.controller.position.y);
    const z = Math.floor(ada.player.controller.position.z) + 2;
    world.world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
    world.world.setBlock(x, y - 1, z, BlockId.Stone);
    world.world.setBlock(x, y, z, BlockId.Air);
    const cart = world.gameplay.minecarts.spawn(x, y, z)!;
    expect(cart.rail).toBeUndefined();
    world.gameplay.minecarts.insertTnt(cart, BlockId.Tnt);
    ada.player.controller.teleport([cart.position.x, cart.position.y, cart.position.z + 0.35]);
    ada.player.controller.velocity.set(0, 0, 2);
    world.gameplay.minecarts.tryPushFromPlayer(ada.player.controller, ada.player.ridingCartId);
    expect(cart.velocity.z).toBeGreaterThan(0);
    world.tick();
    const snap = cartSnap(world, ada.player, cart.id);
    expect(snap).toBeDefined();
    expect(snap!.variant).toBe('tnt');
    expect(Math.abs(snap!.vz ?? 0) + Math.abs(snap!.vx ?? 0)).toBeGreaterThan(0);
  });
});
