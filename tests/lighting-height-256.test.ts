import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey } from '../src/core/constants';
import { Game } from '../src/core/Game';
import { Inventory } from '../src/inventory';
import { createLightingQaScene, lightingQaOpening, lightingQaRoofHole, lightingQaSkyLine } from '../src/dev/lightingQaScenes';
import { ChunkMesher, disposeMeshedChunk } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { SaveService } from '../src/save/SaveService';
import type { SerializedWorldState } from '../src/save/types';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { disposeWorldLighting, getDirectSkyLight, lightingFloodOwner, lightingMemoryUsage, lightEngineStats, resetLightEngineStats } from '../src/world/LightEngine';
import { lightContextReady } from '../src/world/worldJobs';
import { importVoxelsIntoWorld, createAnarchySummary } from '../src/world/import';

const atlas = { texture: new THREE.Texture(), tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as TextureAtlas;
function emptyWorld(radius = 1): VoxelWorld {
  const world = new VoxelWorld('light-height-256');
  world.deferredLighting = true;
  world.setViewCenter(8, 8, Math.max(0, radius - 1));
  for (let z = -radius; z <= radius; z += 1) for (let x = -radius; x <= radius; x += 1) {
    const chunk = new Chunk(x, z);
    chunk.generated = true;
    world.chunks.set(chunkKey(x, z), chunk);
  }
  return world;
}
function settle(world: VoxelWorld): void {
  let frames = 0;
  do {
    world.processLighting(2, 8, 8);
    if (++frames > 5000) throw new Error('Height256 lighting did not settle');
  } while (world.pendingLightJobs || lightingFloodOwner(world));
}
function highRoom(kind: 'room' | 'closed' | 'hole' = 'room', floor = 192): VoxelWorld {
  const world = createLightingQaScene(kind, VoxelWorld, Chunk, floor);
  world.deferredLighting = true;
  return world;
}

describe('height256 lighting integration', () => {
  it('releases disposed world buffers without clearing another world diagnostics', () => {
    const first = emptyWorld();
    const second = emptyWorld();
    settle(first);
    settle(second);
    disposeWorldLighting(first);
    expect(lightingMemoryUsage(first).queueBytes).toBe(0);
    expect(lightingMemoryUsage(second).queueBytes).toBe(131072);
    expect(lightingFloodOwner()).toBe('');
    disposeWorldLighting(second);
    expect(lightingMemoryUsage(second).queueBytes).toBe(0);
    expect(lightingMemoryUsage(second).flagsBytes).toBe(0);
  });

  it('leaves empty upper sky implicit and samples it in the actual mesher', () => {
    const world = emptyWorld();
    const chunk = world.getChunk(0, 0)!;
    chunk.set(8, 84, 8, BlockId.Stone);
    settle(world);
    expect(chunk.occupancyTop).toBe(84);
    expect(chunk.skyLight[Chunk.index(8, 200, 8)]).toBe(0);
    expect(world.skyLightAt(8, 200, 8)).toBe(15);
    expect(getDirectSkyLight(world, 8, 200, 8)).toBe(15);
    const mesh = new ChunkMesher(atlas).build(chunk, world);
    const normal = mesh.opaque.getAttribute('normal');
    const sky = mesh.opaque.getAttribute('skyLight');
    let tops = 0;
    for (let i = 0; i < normal.count; i += 1) if (normal.getY(i) > 0.9) {
      expect(sky.getX(i)).toBe(1);
      tops += 1;
    }
    expect(tops).toBe(4);
    disposeMeshedChunk(mesh);
  });

  it('has no direct sky under a Y200 roof but admits lateral sky through its side', () => {
    const world = highRoom();
    settle(world);
    expect(getDirectSkyLight(world, 8, 196, 16)).toBe(0);
    expect(world.skyLightAt(0, 196, 16)).toBe(15);
    expect(lightingQaSkyLine(world, 192).slice(0, 4)).toEqual([13, 12, 11, 10]);
    expect(world.skyLightAt(26, 196, 16)).toBe(0);
    world.applyBlockBatch(lightingQaOpening(false, 192));
    settle(world);
    expect(lightingQaSkyLine(world, 192).every((value) => value === 0)).toBe(true);
    world.applyBlockBatch(lightingQaOpening(true, 192));
    settle(world);
    expect(world.skyLightAt(3, 196, 16)).toBe(13);
  });

  it('keeps materialized column extents stable when transparent geometry raises occupancy', () => {
    const world = emptyWorld();
    settle(world);
    const chunk = world.getChunk(0, 0)!;
    const version = chunk.lightVersion;
    world.setBlock(8, 255, 8, BlockId.Glass);
    expect(chunk.occupancyTop).toBe(255);
    expect(world.pendingLightJobs).toBe(0);
    expect(chunk.skyStoredHeights[8 * CHUNK_SIZE + 8]).toBe(1);
    expect(chunk.skyLightAtIndex(Chunk.index(8, 254, 8))).toBe(15);
    expect(world.skyLightAt(8, 255, 8)).toBe(15);
    expect(chunk.lightVersion).toBe(version);

    // Recompute only the opposite corner; untouched columns must retain implicit sky.
    world.queueLight({ minX: 0, maxX: 0, minY: 0, maxY: 255, minZ: 0, maxZ: 0 }, true, false);
    settle(world);
    expect(chunk.skyStoredHeights[0]).toBe(256);
    expect(chunk.skyStoredHeights[8 * CHUNK_SIZE + 8]).toBe(1);
    expect(world.skyLightAt(8, 254, 8)).toBe(15);
    expect(chunk.lightVersion).toBe(version);
  });

  it('opens and closes a local roof hole at Y220 without ghost sky', () => {
    const world = highRoom('closed', 212);
    settle(world);
    world.applyBlockBatch(lightingQaRoofHole(true, 212));
    settle(world);
    expect(world.skyLightAt(7, 216, 16)).toBe(15);
    expect(world.skyLightAt(8, 216, 16)).toBe(14);
    expect(world.skyLightAt(27, 216, 16)).toBe(0);
    world.applyBlockBatch(lightingQaRoofHole(false, 212));
    settle(world);
    expect(world.skyLightAt(7, 216, 16)).toBe(0);
  });

  it.each([BlockId.Glowstone, BlockId.Lantern])('adds/removes high emitter %s including spill into lower-occupancy chunks', (block) => {
    const world = emptyWorld();
    settle(world);
    world.setBlock(15, 230, 15, block);
    settle(world);
    expect(world.blockLightAt(15, 230, 15)).toBe(15);
    expect(world.blockLightAt(16, 230, 15)).toBe(14);
    expect(world.blockLightAt(16, 230, 16)).toBe(13);
    const neighbor = world.getChunk(1, 0)!;
    expect(neighbor.occupancyTop).toBe(0);
    expect(neighbor.blockLightTop).toBeGreaterThan(230);
    world.setBlock(15, 230, 15, BlockId.Air);
    settle(world);
    expect(world.blockLightAt(16, 230, 15)).toBe(0);
    expect(world.blockLightAt(16, 238, 15)).toBe(0);
    expect(world.getChunk(0, 0)!.occupancyTop).toBe(230);
    expect(world.skyLightAt(15, 230, 15)).toBe(15);
  });

  it.each([0, 84, 95, 96, 128, 200, 254, 255])('lights supported world Y=%s without a legacy height ceiling', (y) => {
    const world = emptyWorld();
    world.getChunk(0, 0)!.set(15, y, 8, BlockId.Glowstone);
    settle(world);
    expect(world.blockLightAt(15, y, 8)).toBe(15);
    expect(world.blockLightAt(16, y, 8)).toBe(14);
    expect(world.skyLightAt(16, y, 8)).toBe(15);
    expect(world.setBlock(8, WORLD_HEIGHT, 8, BlockId.Glowstone)).toBe(false);
    expect(world.setBlock(8, -1, 8, BlockId.Glowstone)).toBe(false);
  });

  it('bakes identical nonzero high-Y diagonal vertices in either build order', () => {
    const samples: number[][] = [];
    for (const reverse of [false, true]) {
      const world = emptyWorld();
      for (const [x, z] of [[15, 15], [16, 15], [15, 16], [16, 16]]) {
        world.getChunk(Math.floor(x! / 16), Math.floor(z! / 16))!.set(x! % 16, 200, z! % 16, BlockId.Stone);
      }
      const chunks = [...world.chunks.values()];
      if (reverse) chunks.reverse();
      for (const chunk of chunks) world.ensureChunkLighting(chunk);
      expect(lightContextReady(world, world.getChunk(0, 0)!, 0, 0, 1)).toBe(true);
      const mesh = new ChunkMesher(atlas).build(world.getChunk(0, 0)!, world);
      const p = mesh.opaque.getAttribute('position');
      const n = mesh.opaque.getAttribute('normal');
      const sky = mesh.opaque.getAttribute('skyLight');
      const values: number[] = [];
      for (let i = 0; i < p.count; i += 1) if (p.getX(i) === 16 && p.getZ(i) === 16 && n.getY(i) > 0.9) values.push(sky.getX(i));
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((value) => value === 1)).toBe(true);
      samples.push(values);
      disposeMeshedChunk(mesh);
    }
    expect(samples[0]).toEqual(samples[1]);
  });

  it('imports a high roof after implicit sky was used, then schedules stable lateral light', () => {
    const world = emptyWorld();
    settle(world);
    expect(world.skyLightAt(8, 200, 8)).toBe(15);
    resetLightEngineStats();
    const roof = [];
    for (let x = 1; x <= 14; x += 1) for (let z = 1; z <= 14; z += 1) roof.push({ x, y: 200, z, block: BlockId.Stone });
    importVoxelsIntoWorld(world, roof);
    expect(lightEngineStats.skyRecomputes).toBe(0);
    expect(lightEngineStats.blockPropagations).toBe(0);
    expect(world.getChunk(0, 0)!.occupancyTop).toBe(200);
    expect(world.getChunk(1, 1)!.skyLateralReady).toBe(false);
    expect(lightContextReady(world, world.getChunk(0, 0)!, 0, 0, 1)).toBe(false);
    settle(world);
    expect(getDirectSkyLight(world, 8, 199, 8)).toBe(0);
    expect(world.skyLightAt(8, 200, 8)).toBe(0);
    expect(world.skyLightAt(8, 199, 8)).toBeGreaterThan(0);
    expect(world.skyLightAt(16, 199, 8)).toBe(15);
    expect(lightContextReady(world, world.getChunk(0, 0)!, 0, 0, 1)).toBe(true);
  });

  it('removes imported border emission without seeding stale unready neighbor arrays', () => {
    const world = emptyWorld();
    importVoxelsIntoWorld(world, [{ x: 15, y: 200, z: 15, block: BlockId.Glowstone }]);
    settle(world);
    expect(world.blockLightAt(16, 200, 16)).toBe(13);
    importVoxelsIntoWorld(world, [{ x: 15, y: 200, z: 15, block: BlockId.Air }]);
    settle(world);
    expect(world.blockLightAt(15, 200, 15)).toBe(0);
    expect(world.blockLightAt(16, 200, 16)).toBe(0);
  });

  it('restarts an in-flight job after import and preserves queued emission work', () => {
    const world = emptyWorld();
    settle(world);
    world.setBlock(15, 200, 15, BlockId.Lantern);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    try { world.processLighting(2, 8, 8); } finally { clock.mockRestore(); }
    importVoxelsIntoWorld(world, [{ x: 8, y: 220, z: 8, block: BlockId.Stone }]);
    settle(world);
    expect(world.blockLightAt(16, 200, 16)).toBe(13);
    expect(world.skyLightAt(8, 220, 8)).toBe(0);
    expect(getDirectSkyLight(world, 8, 219, 8)).toBe(0);
  });

  it('snapshots only changed pages, uses bit flags, releases completed-job references and avoids no-op remesh', () => {
    const world = emptyWorld();
    world.getChunk(0, 0)!.set(8, 200, 8, BlockId.Lantern);
    settle(world);
    const chunk = world.getChunk(0, 0)!;
    const version = chunk.lightVersion;
    world.queueLight({ minX: 9, maxX: 9, minY: 200, maxY: 200, minZ: 8, maxZ: 8 }, false, true);
    settle(world);
    const memory = lightingMemoryUsage(world);
    expect(memory.peakSnapshotBytes).toBe(4096);
    expect(memory.peakFlagsBytes).toBeLessThanOrEqual(9 * CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT / 8);
    expect(memory.snapshotBytes).toBe(0);
    expect(memory.entries).toBe(0);
    expect(memory.queueBytes).toBe(32768 * 4);
    expect(chunk.lightVersion).toBe(version);
  });
});

function savedWorld(server: boolean): SerializedWorldState {
  const summary = server ? createAnarchySummary(1) : new SaveService().createSummary('lighting256-test', 'lighting256-save', 'creative');
  return { schemaVersion: 1, summary, timeOfDay: 0, weather: 'clear',
    player: { position: [8.5, 230, 8.5], velocity: [0, 0, 0], yaw: 0, pitch: 0, health: 20,
      hunger: 20, saturation: 5, selectedSlot: 0, inventory: new Inventory().serialize() },
    modifications: { '0,0': { [Chunk.index(8, 255, 8)]: BlockId.Glowstone } },
    chests: {}, furnaces: {}, droppedItems: [],
    ...(server ? { serverWorld: { id: 'anarchy', initialized: true, spawnImported: false, importVersion: 1, spawn: [8.5, 230, 8.5] as const } } : {}),
  };
}

describe('runtime height256 worlds and current save schema', () => {
  it.each(['single-new', 'single-load', 'anarchy-new', 'anarchy-load'])('defers lighting in actual Game path %s', async (path) => {
    const server = path.startsWith('anarchy');
    const saved = savedWorld(server);
    const saves = new SaveService();
    if (path.endsWith('load')) await saves.saveWorld(saved);
    const game = Object.create(Game.prototype) as any;
    Object.assign(game, { worldStore: saves, ui: { showLoading: vi.fn(), toast: vi.fn() },
      startSession: vi.fn(), saveSession: vi.fn(), estimateSpawn: () => [8.5, 70, 8.5], spawnDroppedStack: vi.fn() });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No schematic allowed'));
    try {
      if (server) await game.openAnarchyWorld();
      else if (path.endsWith('load')) await game.loadWorld(saved.summary.id);
      else await game.createWorld('lighting256-test', 'lighting256-save', 'creative');
      expect(game.startSession).toHaveBeenCalledOnce();
      const [summary, world, , restored, options] = game.startSession.mock.calls[0];
      expect(world.deferredLighting).toBe(true);
      if (path.endsWith('load')) {
        expect(restored.modifications).toEqual(saved.modifications);
        expect(world.getBlock(8, 255, 8)).toBe(BlockId.Glowstone);
        expect(world.getChunk(0, 0).occupancyTop).toBe(255);
        expect(world.getChunk(0, 0).skyReady).toBe(false);
      }
      if (server) {
        expect(summary.id).toBe('anarchy');
        if (path.endsWith('load')) {
          expect(options.serverWorld.spawn).toEqual(saved.serverWorld!.spawn);
          expect(options.serverWorld.importVersion).toBe(1);
          expect(options.serverWorld.spawnImported).toBe(false);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
