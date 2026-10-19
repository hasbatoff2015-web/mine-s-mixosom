import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, torchBlockEmission } from '../src/blocks';
import { CHUNK_SIZE, blockKey, floorDiv } from '../src/core/constants';
import { createItemStack } from '../src/inventory';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { processDeferredLighting } from '../src/world/LightingAdapter';
import { VoxelWorld, furnaceRecordsFromLit } from '../src/world/World';
import { parseServerMessage } from '../shared/protocol';
import { loadServerConfig } from '../server/config';
import { WorldInstance } from '../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import { restoreSnapshot } from '../server/services/worldEvents';

const X = 8;
const Y = 40;
const Z = 8;

function clearRoom(world: VoxelWorld): void {
  for (let x = 6; x <= 10; x += 1) {
    for (let y = 38; y <= 42; y += 1) {
      for (let z = 6; z <= 10; z += 1) world.setBlock(x, y, z, BlockId.Air);
    }
  }
}

function recordingAtlas(): { atlas: TextureAtlas; keys: string[] } {
  const keys: string[] = [];
  const atlas = {
    tile(key: string) {
      keys.push(key);
      return { u0: 0, v0: 0, u1: 1, v1: 1 };
    },
  } as unknown as TextureAtlas;
  return { atlas, keys };
}

function meshFurnaceKeys(world: VoxelWorld): string[] {
  const { atlas, keys } = recordingAtlas();
  const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(world.getChunk(0, 0)!, world);
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
  return keys.filter((key) => key.includes('furnace'));
}

function drainClientLight(world: VoxelWorld): void {
  world.setViewCenter(X, Z, 4);
  for (let i = 0; i < 48; i += 1) {
    processDeferredLighting(world, 25, X, Z);
    if (world.pendingLightJobs === 0) break;
  }
}

function placeFurnace(world: VoxelWorld): void {
  clearRoom(world);
  world.setBlock(X, Y, Z, BlockId.Furnace);
  world.setBlockState(X, Y, Z, { facing: 'south' });
}

function lightFuel(world: VoxelWorld): void {
  const furnace = world.getFurnace(X, Y, Z);
  furnace.slots[0] = createItemStack('iron_ore');
  furnace.slots[1] = createItemStack('coal');
  furnace.burnTime = 0;
  furnace.burnTotal = 0;
  furnace.cookTime = 0;
}

function joinClient(server: VoxelWorld): VoxelWorld {
  const client = new VoxelWorld(server.seed);
  client.deferredLighting = true;
  client.restore({
    timeOfDay: server.timeOfDay,
    modifications: server.serializeModifications(),
    chests: {},
    furnaces: furnaceRecordsFromLit(server.networkFurnaceLit()),
    blockStates: server.serializeBlockStates(),
  });
  return client;
}

/** Same order as the online `chunk_data` handler. */
function applyChunkData(client: VoxelWorld, server: VoxelWorld): void {
  client.getChunk(0, 0, true);
  client.replaceChunkFurnaceLit(0, 0, server.networkFurnaceLit(0, 0));
}

function litMessages(payloads: readonly unknown[]): Array<{ type: string; burning: boolean; x: number; y: number; z: number }> {
  return payloads.filter((payload) => (payload as { type?: string }).type === 'furnace_lit') as Array<{
    type: string; burning: boolean; x: number; y: number; z: number;
  }>;
}

describe('multiplayer furnace world lit state', () => {
  it('parses furnace_lit without slots and keeps furnace_sync as the GUI packet', () => {
    expect(parseServerMessage({
      type: 'furnace_lit',
      x: X, y: Y, z: Z, burning: true,
      slots: [{ itemId: 'coal', count: 1 }],
    })).toEqual({ type: 'furnace_lit', x: X, y: Y, z: Z, burning: true });
    expect(parseServerMessage({ type: 'furnace_lit', x: X, y: Y, z: Z, burning: false }))
      .toEqual({ type: 'furnace_lit', x: X, y: Y, z: Z, burning: false });
    expect(parseServerMessage({ type: 'furnace_lit', x: X, y: Y })).toEqual({ error: 'furnace_lit invalid' });
    const chunk = parseServerMessage({
      type: 'chunk_data',
      cx: 0, cz: 0,
      modifications: { '1': 2 },
      furnacesLit: [
        { x: X, y: Y, z: Z, burning: true, slots: [{ itemId: 'coal', count: 64 }] },
        { x: 1, y: 2, z: 3, burning: false },
      ],
    });
    expect(chunk).toMatchObject({
      type: 'chunk_data',
      furnacesLit: [{ x: X, y: Y, z: Z, burning: true }],
    });
  });

  it('idle → burning → idle updates the mesh and does not remesh a steady burn', () => {
    const server = new VoxelWorld('furnace-edge');
    placeFurnace(server);
    lightFuel(server);
    const edges: boolean[] = [];
    server.onFurnaceLitChanged = (change) => edges.push(change.burning);
    server.tick();
    expect(edges).toEqual([true]);
    expect(server.isFurnaceBurning(X, Y, Z)).toBe(true);
    server.tick();
    server.tick();
    expect(edges).toEqual([true]);
    server.getFurnace(X, Y, Z).burnTime = 1;
    server.tick();
    expect(server.isFurnaceBurning(X, Y, Z)).toBe(false);
    expect(edges).toEqual([true, false]);

    const client = new VoxelWorld('furnace-edge-client');
    client.deferredLighting = true;
    placeFurnace(client);
    client.getChunk(0, 0, true);
    drainClientLight(client);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front');
    expect(meshFurnaceKeys(client)).not.toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(0);
    const unlitAbove = client.blockLightAt(X, Y + 1, Z);

    expect(client.applyFurnaceLit(X, Y, Z, true)).toBe(true);
    drainClientLight(client);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(14);
    expect(client.blockLightAt(X, Y, Z)).toBe(14);
    expect(client.blockLightAt(X, Y + 1, Z)).toBeGreaterThan(unlitAbove);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.burnTime).toBe(1);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.slots).toEqual([null, null, null]);

    const chunk = client.getChunk(0, 0)!;
    chunk.dirty = false;
    expect(client.applyFurnaceLit(X, Y, Z, true)).toBe(false);
    expect(chunk.dirty).toBe(false);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.burnTime).toBe(1);

    expect(client.applyFurnaceLit(X, Y, Z, false)).toBe(true);
    drainClientLight(client);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front');
    expect(meshFurnaceKeys(client)).not.toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(0);
    expect(client.blockLightAt(X, Y, Z)).toBe(0);
    expect(client.blockLightAt(X, Y + 1, Z)).toBe(unlitAbove);
    expect(torchBlockEmission()).toBe(14);
  });

  it('late join meshes a furnace that is already burning, without a GUI', () => {
    const server = new VoxelWorld('furnace-late-join');
    placeFurnace(server);
    lightFuel(server);
    server.tick();
    expect(server.networkFurnaceLit()).toEqual([{ x: X, y: Y, z: Z, burning: true }]);
    expect(Object.keys(server.networkFurnaceLit()[0]!).sort()).toEqual(['burning', 'x', 'y', 'z']);

    const client = joinClient(server);
    applyChunkData(client, server);
    drainClientLight(client);
    for (let i = 0; i < 5; i += 1) server.tick();
    drainClientLight(client);

    expect(client.isFurnaceBurning(X, Y, Z)).toBe(true);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.burnTime).toBe(1);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.slots).toEqual([null, null, null]);
    expect(server.furnaces.get(blockKey(X, Y, Z))!.burnTime).toBeLessThan(1_600);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(14);
    expect(client.blockLightAt(X, Y, Z)).toBe(14);
    expect(client.blockLightAt(X, Y + 1, Z)).toBeGreaterThan(0);
  });

  it('reloads a burning furnace as lit and a stopped furnace as unlit', () => {
    const server = new VoxelWorld('furnace-reload');
    placeFurnace(server);
    lightFuel(server);
    server.tick();
    const client = joinClient(server);
    applyChunkData(client, server);
    drainClientLight(client);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front_on');

    const cold = new VoxelWorld(server.seed);
    cold.deferredLighting = true;
    cold.restore({
      timeOfDay: server.timeOfDay,
      modifications: server.serializeModifications(),
      chests: {},
      furnaces: {},
      blockStates: server.serializeBlockStates(),
    });
    cold.getChunk(0, 0, true);
    drainClientLight(cold);
    const unlitAbove = cold.blockLightAt(X, Y + 1, Z);

    client.pruneChunks(X + CHUNK_SIZE * 40, Z, 2);
    client.furnaces.delete(blockKey(X, Y, Z));
    expect(server.networkFurnaceLit(0, 0)).toEqual([{ x: X, y: Y, z: Z, burning: true }]);
    applyChunkData(client, server);
    drainClientLight(client);
    expect(client.isFurnaceBurning(X, Y, Z)).toBe(true);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front_on');
    expect(client.blockLightAt(X, Y, Z)).toBe(14);

    server.getFurnace(X, Y, Z).burnTime = 1;
    server.tick();
    expect(server.networkFurnaceLit(0, 0)).toEqual([]);
    client.pruneChunks(X + CHUNK_SIZE * 40, Z, 2);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.burnTime).toBe(1);
    applyChunkData(client, server);
    drainClientLight(client);
    expect(client.isFurnaceBurning(X, Y, Z)).toBe(false);
    expect(client.furnaces.get(blockKey(X, Y, Z))?.burnTime ?? 0).toBe(0);
    const keys = meshFurnaceKeys(client);
    expect(keys).toContain('block/furnace_front');
    expect(keys).not.toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(0);
    expect(client.blockLightAt(X, Y, Z)).toBe(0);
    expect(client.blockLightAt(X, Y + 1, Z)).toBe(unlitAbove);
  });

  it('replaces a stale client burnTime when the server furnace is idle', () => {
    const server = new VoxelWorld('furnace-stale');
    placeFurnace(server);
    const client = new VoxelWorld(server.seed);
    client.deferredLighting = true;
    client.restore({
      timeOfDay: server.timeOfDay,
      modifications: server.serializeModifications(),
      chests: {},
      furnaces: {},
      blockStates: server.serializeBlockStates(),
    });
    client.getChunk(0, 0, true);
    client.applyFurnaceLit(X, Y, Z, true);
    drainClientLight(client);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front_on');
    client.pruneChunks(X + CHUNK_SIZE * 40, Z, 2);
    applyChunkData(client, server);
    drainClientLight(client);
    expect(client.isFurnaceBurning(X, Y, Z)).toBe(false);
    expect(meshFurnaceKeys(client)).toContain('block/furnace_front');
    expect(meshFurnaceKeys(client)).not.toContain('block/furnace_front_on');
    expect(client.blockEmissionAt(X, Y, Z)).toBe(0);
    expect(client.blockLightAt(X, Y, Z)).toBe(0);
  });

  it('notifies when a snapshot or a break changes burnTime outside tickFurnaces', () => {
    const world = new VoxelWorld('furnace-external');
    placeFurnace(world);
    const edges: boolean[] = [];
    world.onFurnaceLitChanged = (change) => edges.push(change.burning);
    restoreSnapshot(world, [{
      x: X, y: Y, z: Z, blockId: BlockId.Furnace,
      furnace: {
        slots: [null, null, null],
        burnTime: 40,
        burnTotal: 40,
        cookTime: 0,
      },
    }]);
    expect(edges).toEqual([true]);
    expect(world.isFurnaceBurning(X, Y, Z)).toBe(true);

    const wasBurning = (world.furnaces.get(blockKey(X, Y, Z))?.burnTime ?? 0) > 0;
    world.furnaces.delete(blockKey(X, Y, Z));
    world.syncFurnaceBurnBit(X, Y, Z, wasBurning);
    expect(edges).toEqual([true, false]);
    expect(world.isFurnaceBurning(X, Y, Z)).toBe(false);
  });
});

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

describe('two clients see the same furnace without a GUI', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('sends furnace_lit to both observers and chunk_data to a late joiner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-furnace-lit-'));
    dirs.push(dir);
    const world = new WorldInstance({
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
      dataDir: dir,
      port: 0,
      chunkViewRadius: 1,
      persistIntervalMs: 60_000,
    });
    worlds.push(world);
    await world.initialize();

    const sinkA = new MemorySink();
    const sinkB = new MemorySink();
    const joinedA = world.join({ sink: sinkA, name: 'WatcherA' });
    const joinedB = world.join({ sink: sinkB, name: 'WatcherB' });
    if ('error' in joinedA || 'error' in joinedB) throw new Error('join failed');

    const x = 2;
    const y = Math.floor(joinedA.player.controller.position.y);
    const z = 2;
    world.world.setBlock(x, y, z, BlockId.Furnace);
    const furnace = world.world.getFurnace(x, y, z);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack('coal');
    sinkA.payloads.length = 0;
    sinkB.payloads.length = 0;
    world.tick();

    const litA = litMessages(sinkA.payloads);
    const litB = litMessages(sinkB.payloads);
    expect(litA).toEqual([{ type: 'furnace_lit', x, y, z, burning: true }]);
    expect(litB).toEqual([{ type: 'furnace_lit', x, y, z, burning: true }]);
    expect(JSON.stringify(litA)).not.toContain('itemId');
    expect(sinkA.payloads.some((payload) => (payload as { type?: string }).type === 'furnace_sync')).toBe(false);
    expect(sinkB.payloads.some((payload) => (payload as { type?: string }).type === 'furnace_sync')).toBe(false);
    expect(joinedA.player.window.kind).not.toBe('furnace');
    expect(joinedB.player.window.kind).not.toBe('furnace');

    sinkA.payloads.length = 0;
    sinkB.payloads.length = 0;
    world.tick();
    expect(litMessages(sinkA.payloads)).toEqual([]);
    expect(litMessages(sinkB.payloads)).toEqual([]);

    furnace.burnTime = 1;
    sinkA.payloads.length = 0;
    sinkB.payloads.length = 0;
    world.tick();
    expect(litMessages(sinkA.payloads)).toEqual([{ type: 'furnace_lit', x, y, z, burning: false }]);
    expect(litMessages(sinkB.payloads)).toEqual([{ type: 'furnace_lit', x, y, z, burning: false }]);

    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack('coal');
    furnace.burnTime = 0;
    world.tick();
    expect(world.world.isFurnaceBurning(x, y, z)).toBe(true);
    expect(world.networkFurnaceLit()).toContainEqual({ x, y, z, burning: true });

    const sinkC = new MemorySink();
    const joinedC = world.join({ sink: sinkC, name: 'Late' });
    if ('error' in joinedC) throw new Error(joinedC.error);
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = sinkC.payloads.find((payload) => {
      const message = payload as { type?: string; cx?: number; cz?: number };
      return message?.type === 'chunk_data' && message.cx === cx && message.cz === cz;
    }) as { furnacesLit?: unknown } | undefined;
    expect(chunk?.furnacesLit).toContainEqual({ x, y, z, burning: true });
    expect(JSON.stringify(chunk?.furnacesLit)).not.toContain('slot');
    expect(litMessages(sinkC.payloads).some((message) => message.burning && message.x === x)).toBe(false);
    expect(joinedC.player.window.kind).not.toBe('furnace');

    world.setGameMode(joinedA.player, 'creative');
    sinkA.payloads.length = 0;
    sinkB.payloads.length = 0;
    const broke = world.tryBreak(joinedA.player, x, y, z);
    expect(broke).toEqual({ ok: true });
    world.tick();
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
    expect(litMessages(sinkA.payloads)).toContainEqual({ type: 'furnace_lit', x, y, z, burning: false });
    expect(litMessages(sinkB.payloads)).toContainEqual({ type: 'furnace_lit', x, y, z, burning: false });
  }, 120_000);
});
