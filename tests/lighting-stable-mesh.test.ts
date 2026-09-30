import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_LIGHT_BUDGET_MS, chunkKey } from '../src/core/constants';
import { EmitterCensusScanner } from '../src/debug/emitterCensus';
import { createLightingQaScene, lightingQaRoofHole, type LightingQaScene } from '../src/dev/lightingQaScenes';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import { Chunk } from '../src/world/Chunk';
import {
  lightingFloodOwner,
  lightingMemoryUsage,
  lightFrameStats,
  peekLightTouched,
  processChunkLighting,
} from '../src/world/LightEngine';
import { applyNetworkBlockChanges } from '../src/world/networkBlockUpdates';
import { VoxelWorld } from '../src/world/World';
import { lightContextReady } from '../src/world/worldJobs';

const atlas = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

const VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

function settle(world: VoxelWorld): void {
  for (let i = 0; i < 8000; i += 1) {
    if (world.pendingLightJobs === 0 && lightingFloodOwner(world) === '') return;
    world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
  }
  throw new Error(`lighting did not settle pending=${world.pendingLightJobs} owner=${lightingFloodOwner(world)}`);
}

function litScene(kind: LightingQaScene = 'closed'): VoxelWorld {
  const world = createLightingQaScene(kind);
  world.deferredLighting = true;
  world.setViewCenter(8, 8, 4);
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  world.flushLighting();
  for (const chunk of world.chunks.values()) {
    chunk.dirty = false;
    chunk.clearMeshDirtyRange();
    chunk.meshedLightVersion = chunk.lightVersion;
  }
  return world;
}

function blockCopies(world: VoxelWorld): Map<string, Uint8Array> {
  const copies = new Map<string, Uint8Array>();
  for (const [key, chunk] of world.chunks) copies.set(key, chunk.blockLight.slice());
  return copies;
}

function skyCopies(world: VoxelWorld): Map<string, Uint8Array> {
  const copies = new Map<string, Uint8Array>();
  for (const [key, chunk] of world.chunks) {
    const sky = new Uint8Array(chunk.skyLight.length);
    for (let index = 0; index < sky.length; index += 1) sky[index] = chunk.skyLightAtIndex(index);
    copies.set(key, sky);
  }
  return copies;
}

function cellOf(chunk: Chunk, index: number): { x: number; y: number; z: number } {
  const columns = CHUNK_SIZE * CHUNK_SIZE;
  const y = Math.floor(index / columns);
  const local = index % columns;
  return {
    x: chunk.x * CHUNK_SIZE + (local % CHUNK_SIZE),
    y,
    z: chunk.z * CHUNK_SIZE + Math.floor(local / CHUNK_SIZE),
  };
}

function findBlockDiff(world: VoxelWorld, copies: Map<string, Uint8Array>): { chunk: Chunk; index: number; before: number } | undefined {
  for (const [key, before] of copies) {
    const chunk = world.chunks.get(key);
    if (!chunk) continue;
    const raw = chunk.blockLight;
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] !== before[index]) return { chunk, index, before: before[index]! };
    }
  }
  return undefined;
}

function findSkyDiff(world: VoxelWorld, copies: Map<string, Uint8Array>): { chunk: Chunk; index: number; before: number } | undefined {
  for (const [key, before] of copies) {
    const chunk = world.chunks.get(key);
    if (!chunk) continue;
    for (let index = 0; index < before.length; index += 1) {
      const current = chunk.skyLightAtIndex(index);
      if (current !== before[index]) return { chunk, index, before: before[index]! };
    }
  }
  return undefined;
}

function jobOpen(world: VoxelWorld): boolean {
  return world.pendingLightJobs > 0 || lightingFloodOwner(world) !== '';
}

/** Run budgeted slices until `pred` is true while the job is still open. */
function yieldUntil(world: VoxelWorld, pred: () => boolean): void {
  for (let i = 0; i < 500; i += 1) {
    if (pred() && jobOpen(world)) return;
    if (!jobOpen(world)) break;
    world.processLighting(0.05, 8, 8);
  }
  if (pred() && jobOpen(world)) return;
  throw new Error('lighting job finished before the partial-flood predicate');
}

function meshBlock(world: VoxelWorld, chunk: Chunk, x: number, y: number, z: number): number {
  const mesher = new ChunkMesher(atlas);
  mesher.build(chunk, world, { minY: Math.max(0, y - 1), maxY: Math.min(WORLD_HEIGHT - 1, y + 1) });
  return (mesher.meshLightCell(x, y, z) >>> 4) & 15;
}

function meshSky(world: VoxelWorld, chunk: Chunk, x: number, y: number, z: number): number {
  const mesher = new ChunkMesher(atlas);
  mesher.build(chunk, world, { minY: Math.max(0, y - 1), maxY: Math.min(WORLD_HEIGHT - 1, y + 1) });
  return mesher.meshLightCell(x, y, z) & 15;
}

describe('stable mesh light during a sliced flood', () => {
  it('keeps the global light budget and does not allocate a second full light buffer', () => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    const world = litScene();
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    expect(chunk.skyLight.byteLength).toBe(VOLUME);
    expect(chunk.blockLight.byteLength).toBe(VOLUME);
    expect(Object.hasOwn(chunk, 'committedSkyLight')).toBe(false);
    expect(Object.hasOwn(chunk, 'committedBlockLight')).toBe(false);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
  });

  it('bakes the previous block light when an emitter removal yields mid-flood', () => {
    const world = litScene();
    world.applyBlockBatch([{ x: 10, y: 42, z: 12, block: BlockId.Lantern }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    settle(world);
    const source = world.chunks.get(chunkKey(0, 0))!;
    const renderer = new WorldRenderer(world, atlas);
    renderer.rebuild(source);
    const version = source.lightVersion;
    expect(world.blockLightAt(10, 42, 12)).toBe(15);
    const copies = blockCopies(world);
    const applied = applyNetworkBlockChanges(world, [{ x: 10, y: 42, z: 12, blockId: BlockId.Air }]);
    expect(world.getBlock(10, 42, 12)).toBe(BlockId.Air);
    expect(applied.meshKeys.length).toBeGreaterThan(0);
    yieldUntil(world, () => findBlockDiff(world, copies) !== undefined);
    const diff = findBlockDiff(world, copies)!;
    const cell = cellOf(diff.chunk, diff.index);
    expect(world.blockLightAt(cell.x, cell.y, cell.z)).toBe(diff.chunk.blockLight[diff.index]);
    expect(world.blockLightAt(cell.x, cell.y, cell.z)).not.toBe(diff.before);
    expect(world.readMeshBlockLight(cell.x, cell.y, cell.z)).toBe(diff.before);
    expect(meshBlock(world, diff.chunk, cell.x, cell.y, cell.z)).toBe(diff.before);
    expect(source.lightVersion).toBe(version);
    const memory = lightingMemoryUsage(world);
    expect(memory.snapshotBytes).toBeGreaterThan(0);
    expect(memory.snapshotBytes).toBeLessThan(world.chunks.size * VOLUME * 2);

    const rebuilt = renderer.rebuildDirty(3, 8, 10, 12, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set(applied.meshKeys),
    });
    expect(rebuilt).toBeGreaterThan(0);
    expect(world.getBlock(10, 42, 12)).toBe(BlockId.Air);
    expect(source.dirty).toBe(false);
    expect(lightContextReady(world, source, 0, 0, 4)).toBe(false);
    expect(world.readMeshBlockLight(cell.x, cell.y, cell.z)).toBe(diff.before);

    settle(world);
    expect(world.blockLightAt(10, 42, 12)).toBe(0);
    expect(world.readMeshBlockLight(10, 42, 12)).toBe(0);
    expect(meshBlock(world, source, 10, 42, 12)).toBe(0);
    expect(source.lightVersion).toBe(version + 1);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    expect(peekLightTouched(world).size).toBe(0);
    expect(world.pendingLightJobs).toBe(0);
  });

  it('does not bake a partial sky field while a roof edit is still flooding', () => {
    const closed = litScene('closed');
    const closedChunk = closed.chunks.get(chunkKey(0, 0))!;
    const closedVersion = closedChunk.lightVersion;
    const beforeOpen = skyCopies(closed);
    closed.applyBlockBatch(lightingQaRoofHole(true), {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    yieldUntil(closed, () => findSkyDiff(closed, beforeOpen) !== undefined);
    const opened = findSkyDiff(closed, beforeOpen)!;
    const openCell = cellOf(opened.chunk, opened.index);
    expect(closed.skyLightAt(openCell.x, openCell.y, openCell.z)).not.toBe(opened.before);
    expect(closed.readMeshSkyLight(openCell.x, openCell.y, openCell.z)).toBe(opened.before);
    expect(meshSky(closed, opened.chunk, openCell.x, openCell.y, openCell.z)).toBe(opened.before);
    expect(closedChunk.lightVersion).toBe(closedVersion);
    settle(closed);
    expect(closed.readMeshSkyLight(openCell.x, openCell.y, openCell.z)).toBe(closed.skyLightAt(openCell.x, openCell.y, openCell.z));
    expect(closed.skyLightAt(openCell.x, openCell.y, openCell.z)).not.toBe(opened.before);
    expect(lightingMemoryUsage(closed).snapshotBytes).toBe(0);

    const hole = litScene('hole');
    const beforeClose = skyCopies(hole);
    hole.applyBlockBatch(lightingQaRoofHole(false), {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    yieldUntil(hole, () => findSkyDiff(hole, beforeClose) !== undefined);
    const closedDiff = findSkyDiff(hole, beforeClose)!;
    const closeCell = cellOf(closedDiff.chunk, closedDiff.index);
    expect(hole.skyLightAt(closeCell.x, closeCell.y, closeCell.z)).not.toBe(closedDiff.before);
    expect(hole.readMeshSkyLight(closeCell.x, closeCell.y, closeCell.z)).toBe(closedDiff.before);
    expect(meshSky(hole, closedDiff.chunk, closeCell.x, closeCell.y, closeCell.z)).toBe(closedDiff.before);
    settle(hole);
    expect(hole.readMeshSkyLight(closeCell.x, closeCell.y, closeCell.z)).toBe(hole.skyLightAt(closeCell.x, closeCell.y, closeCell.z));
    expect(hole.skyLightAt(closeCell.x, closeCell.y, closeCell.z)).not.toBe(closedDiff.before);
  });

  it('keeps committed light on a cardinal border and a diagonal corner', () => {
    const world = litScene();
    world.applyBlockBatch([{ x: 15, y: 42, z: 8, block: BlockId.Glowstone }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    settle(world);
    const borderStable = world.blockLightAt(16, 42, 8);
    const sourceStable = world.blockLightAt(15, 42, 8);
    expect(borderStable).toBeGreaterThan(0);
    expect(sourceStable).toBe(15);
    world.applyBlockBatch([{ x: 15, y: 42, z: 8, block: BlockId.Air }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    yieldUntil(world, () => world.blockLightAt(16, 42, 8) !== borderStable);
    expect(world.blockLightAt(16, 42, 8)).not.toBe(borderStable);
    expect(world.readMeshBlockLight(16, 42, 8)).toBe(borderStable);
    expect(world.readMeshBlockLight(15, 42, 8)).toBe(sourceStable);
    const east = world.chunks.get(chunkKey(1, 0))!;
    expect(meshBlock(world, east, 16, 42, 8)).toBe(borderStable);
    expect(meshBlock(world, east, 15, 42, 8)).toBe(sourceStable);
    settle(world);

    world.applyBlockBatch([{ x: 15, y: 44, z: 15, block: BlockId.Lantern }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    settle(world);
    const cornerStable = world.blockLightAt(16, 44, 16);
    const cornerSource = world.blockLightAt(15, 44, 15);
    expect(cornerStable).toBeGreaterThan(0);
    expect(cornerSource).toBe(15);
    world.applyBlockBatch([{ x: 15, y: 44, z: 15, block: BlockId.Air }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    yieldUntil(world, () => world.blockLightAt(16, 44, 16) !== cornerStable);
    expect(world.readMeshBlockLight(16, 44, 16)).toBe(cornerStable);
    expect(world.readMeshBlockLight(15, 44, 15)).toBe(cornerSource);
    const diagonal = world.chunks.get(chunkKey(1, 1))!;
    expect(meshBlock(world, diagonal, 15, 44, 15)).toBe(cornerSource);
    expect(meshBlock(world, diagonal, 16, 44, 16)).toBe(cornerStable);
    settle(world);
    expect(world.readMeshBlockLight(16, 44, 16)).toBe(world.blockLightAt(16, 44, 16));
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
  });

  it('shows new geometry immediately and keeps the previous light while an emitter is added', () => {
    const world = litScene();
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    const renderer = new WorldRenderer(world, atlas);
    renderer.rebuild(chunk);
    const version = chunk.lightVersion;
    expect(world.blockLightAt(11, 42, 13)).toBe(0);
    world.applyBlockBatch([{ x: 11, y: 42, z: 13, block: BlockId.Glowstone }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    const copies = blockCopies(world);
    yieldUntil(world, () => findBlockDiff(world, copies) !== undefined);
    const diff = findBlockDiff(world, copies)!;
    const cell = cellOf(diff.chunk, diff.index);
    expect(diff.before).toBeLessThan(world.blockLightAt(cell.x, cell.y, cell.z));
    expect(world.readMeshBlockLight(cell.x, cell.y, cell.z)).toBe(diff.before);
    expect(meshBlock(world, diff.chunk, cell.x, cell.y, cell.z)).toBe(diff.before);
    expect(chunk.lightVersion).toBe(version);
    expect(world.getBlock(11, 42, 13)).toBe(BlockId.Glowstone);
    const rebuilt = renderer.rebuildDirty(3, 8, 11, 13, {
      requireNeighborLight: false,
      allowPendingLighting: true,
      preferKeys: new Set([chunkKey(0, 0)]),
    });
    expect(rebuilt).toBeGreaterThan(0);
    expect(chunk.dirty).toBe(false);
    settle(world);
    expect(world.blockLightAt(11, 42, 13)).toBe(15);
    expect(world.readMeshBlockLight(11, 42, 13)).toBe(15);
    expect(chunk.lightVersion).toBe(version + 1);
  });

  it('does not churn lightVersion across a restarted edit burst', async () => {
    const world = litScene();
    world.applyBlockBatch([{ x: 10, y: 42, z: 12, block: BlockId.Glowstone }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    settle(world);
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    const far = world.chunks.get(chunkKey(2, 2))!;
    const version = chunk.lightVersion;
    const farVersion = far.lightVersion;
    const stable = world.blockLightAt(10, 42, 12);
    expect(stable).toBe(15);
    const copies = blockCopies(world);
    world.applyBlockBatch([{ x: 10, y: 42, z: 12, block: BlockId.Air }], {
      deferLighting: true, scheduleNeighbors: false, skipSupport: true,
    });
    yieldUntil(world, () => world.blockLightAt(10, 42, 12) !== stable);
    expect(chunk.lightVersion).toBe(version);
    expect(world.readMeshBlockLight(10, 42, 12)).toBe(stable);
    const burst = [];
    for (let i = 0; i < 30; i += 1) {
      burst.push({
        x: 6 + (i % 5),
        y: 42,
        z: 8 + (i % 4),
        block: i % 2 === 0 ? BlockId.Stone : BlockId.Air,
      });
    }
    world.applyBlockBatch(burst, { deferLighting: true, scheduleNeighbors: false, skipSupport: true });
    expect(world.pendingLightJobs).toBeLessThanOrEqual(2);
    expect(chunk.lightVersion).toBe(version);
    expect(world.readMeshBlockLight(10, 42, 12)).toBe(stable);
    expect(world.blockLightAt(10, 42, 12)).not.toBe(stable);
    world.processLighting(0.05, 8, 8);
    expect(chunk.lightVersion).toBe(version);
    expect(findBlockDiff(world, copies)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 120));
    settle(world);
    expect(chunk.lightVersion - version).toBeLessThanOrEqual(1);
    expect(chunk.lightVersion).toBeGreaterThan(version);
    expect(far.lightVersion).toBe(farVersion);
    expect(world.blockLightAt(10, 42, 12)).toBe(0);
    expect(world.readMeshBlockLight(10, 42, 12)).toBe(world.blockLightAt(10, 42, 12));
    expect(world.pendingLightJobs).toBe(0);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    expect(peekLightTouched(world).size).toBe(0);
  });

  it('relights high columns without baking the partial field', () => {
    const world = litScene();
    const cells: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
    for (const base of [198, 228]) {
      for (let x = 6; x <= 12; x += 1) {
        for (let z = 6; z <= 12; z += 1) {
          cells.push({ x, y: base, z, block: BlockId.Stone });
          cells.push({ x, y: base + 5, z, block: BlockId.Stone });
          if (x === 6 || x === 12 || z === 6 || z === 12) {
            for (let y = base + 1; y < base + 5; y += 1) cells.push({ x, y, z, block: BlockId.Stone });
          }
        }
      }
      cells.push({ x: 9, y: base + 2, z: 9, block: BlockId.Lantern });
    }
    world.applyBlockBatch(cells, { deferLighting: true, scheduleNeighbors: false, skipSupport: true });
    settle(world);
    for (const y of [200, 230]) {
      expect(world.blockLightAt(9, y, 9)).toBe(15);
      const version = world.chunks.get(chunkKey(0, 0))!.lightVersion;
      const copies = blockCopies(world);
      world.applyBlockBatch([{ x: 9, y, z: 9, block: BlockId.Air }], {
        deferLighting: true, scheduleNeighbors: false, skipSupport: true,
      });
      yieldUntil(world, () => world.blockLightAt(9, y, 9) !== 15);
      expect(world.blockLightAt(9, y, 9)).not.toBe(15);
      expect(world.readMeshBlockLight(9, y, 9)).toBe(15);
      expect(meshBlock(world, world.chunks.get(chunkKey(0, 0))!, 9, y, 9)).toBe(15);
      expect(world.chunks.get(chunkKey(0, 0))!.lightVersion).toBe(version);
      expect(findBlockDiff(world, copies)).toBeTruthy();
      settle(world);
      expect(world.blockLightAt(9, y, 9)).toBe(0);
      expect(world.readMeshBlockLight(9, y, 9)).toBe(0);
      expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    }
  });

  it('does not bump lightVersion for a no-op region relight', () => {
    const world = litScene();
    const versions = [...world.chunks.values()].map((chunk) => [chunkKey(chunk.x, chunk.z), chunk.lightVersion] as const);
    world.queueLight({ minX: 8, maxX: 9, minY: 41, maxY: 43, minZ: 8, maxZ: 9 }, true, true, 'other');
    settle(world);
    for (const [key, version] of versions) {
      expect(world.chunks.get(key)!.lightVersion).toBe(version);
    }
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    expect(peekLightTouched(world).size).toBe(0);
  });

  it('still refuses to mesh an initial unlit chunk', () => {
    const world = new VoxelWorld('unlit-gate');
    world.deferredLighting = true;
    const chunk = new Chunk(0, 0);
    chunk.generated = true;
    chunk.dirty = true;
    world.chunks.set(chunkKey(0, 0), chunk);
    world.setViewCenter(0, 0, 2);
    const yielded = processChunkLighting(world, chunk, performance.now());
    expect(yielded).toBe(false);
    expect(chunk.lightingReady).toBe(false);
    expect(world.readMeshBlockLight(1, 4, 1)).toBe(world.blockLightAt(1, 4, 1));
    expect(world.readMeshSkyLight(1, 4, 1)).toBe(chunk.skyLightAtIndex(Chunk.index(1, 4, 1)));
    const renderer = new WorldRenderer(world, atlas);
    expect(renderer.rebuildDirty(2, 20, 0, 0, {
      requireNeighborLight: false,
      allowPendingLighting: true,
    })).toBe(0);
    expect(chunk.meshedLightVersion).toBe(-1);
    expect(lightContextReady(world, chunk, 0, 0, 2)).toBe(false);
  });

  it('does no lighting work while idle after a cluster of emitters has settled', () => {
    const world = litScene();
    const spots = [];
    for (let i = 0; i < 16; i += 1) {
      spots.push({
        x: 4 + (i % 4) * 3,
        y: 41,
        z: 6 + Math.floor(i / 4) * 3,
        block: i % 3 === 0 ? BlockId.Torch : i % 3 === 1 ? BlockId.Lantern : BlockId.Glowstone,
      });
    }
    world.applyBlockBatch(spots, { deferLighting: true, scheduleNeighbors: false, skipSupport: true });
    settle(world);
    expect(world.blockLightAt(4, 41, 6)).toBeGreaterThan(0);
    for (let frame = 0; frame < 8; frame += 1) {
      world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
      expect(lightFrameStats.nodes).toBe(0);
      expect(lightFrameStats.columns).toBe(0);
      expect(lightingFloodOwner(world)).toBe('');
    }
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    const mesher = new ChunkMesher(atlas);
    mesher.build(chunk, world, { minY: 40, maxY: 44 });
    expect(mesher.meshLightCell(4, 41, 6) >>> 4).toBe(world.blockLightAt(4, 41, 6));
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
  });

  it('counts loaded emitters a chunk at a time', () => {
    const world = litScene();
    world.applyBlockBatch([
      { x: 8, y: 41, z: 8, block: BlockId.Torch },
      { x: 10, y: 41, z: 8, block: BlockId.Lantern },
      { x: 12, y: 41, z: 8, block: BlockId.Glowstone },
      { x: 14, y: 41, z: 8, block: BlockId.RedstoneTorch },
    ], { deferLighting: true, scheduleNeighbors: false, skipSupport: true });
    settle(world);
    const scanner = new EmitterCensusScanner();
    const first = scanner.advance(world, 1);
    expect(first.passComplete).toBe(false);
    expect(first.torch).toBe(0);
    let census = first;
    for (let i = 0; i < world.chunks.size + 2 && !census.passComplete; i += 1) {
      census = scanner.advance(world, 1);
    }
    expect(census.passComplete).toBe(true);
    expect(census.torch).toBe(1);
    expect(census.lantern).toBe(1);
    expect(census.glowstone).toBe(1);
    expect(census.redstoneTorch).toBe(1);
    expect(census.total).toBe(4);
    expect(census.scannedChunks).toBe(world.chunks.size);
  });
});
