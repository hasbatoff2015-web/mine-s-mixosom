import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { lightingInvalidation } from '../src/world/LightEngine';
import {
  FLUID_SOURCE_LEVEL,
  applyFluidWrites,
  computeFluidUpdate,
  generatedFluidNeedsActivation,
} from '../src/world/fluids';
import { runStreamingPath, STREAMING_SPEEDS } from '../src/world/streamingSim';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function loadFlat(world: VoxelWorld, floorY = 40, chunks = 1): void {
  for (let cz = -chunks; cz <= chunks; cz += 1) {
    for (let cx = -chunks; cx <= chunks; cx += 1) world.getChunk(cx, cz);
  }
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
  }
}

function tickWorld(world: VoxelWorld, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) world.tick();
}

function settleWrites(world: VoxelWorld, extraTicks: number): number {
  let writes = 0;
  for (let index = 0; index < extraTicks; index += 1) {
    world.tick();
    writes += world.fluidWrites;
  }
  return writes;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[index]!;
}

describe('fluid lighting signature and queue', () => {
  it('skips relight for water level-only changes', () => {
    const world = new VoxelWorld('fluid-water-level-light');
    loadFlat(world, 30);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    world.setBlock(8, 31, 8, BlockId.Water);
    const queued = world.lightQueueMarks;
    const pending = world.pendingLightJobs;
    world.setBlockState(8, 31, 8, { fluidLevel: 4, fluidFalling: false });
    expect(world.lightQueueMarks).toBe(queued);
    expect(world.pendingLightJobs).toBe(pending);
    expect(world.pendingMesh.size).toBeGreaterThan(0);
  });

  it('skips relight for lava level-only changes', () => {
    const world = new VoxelWorld('fluid-lava-level-light');
    loadFlat(world, 30);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    world.setBlock(8, 31, 8, BlockId.Lava);
    const queued = world.lightQueueMarks;
    world.setBlockState(8, 31, 8, { fluidLevel: 4, fluidFalling: false });
    expect(world.lightQueueMarks).toBe(queued);
    expect(lightingInvalidation(BlockId.Lava, BlockId.Lava)).toBe('none');
  });

  it('classifies air↔water as local sky and air↔lava as add-emitter', () => {
    expect(lightingInvalidation(BlockId.Air, BlockId.Water)).toBe('localSky');
    expect(lightingInvalidation(BlockId.Water, BlockId.Air)).toBe('localSky');
    expect(lightingInvalidation(BlockId.Air, BlockId.Lava)).toBe('addEmitter');
    expect(lightingInvalidation(BlockId.Lava, BlockId.Air)).toBe('region');
    expect(lightingInvalidation(BlockId.Lava, BlockId.Obsidian)).toBe('region');
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
  });

  it('does not queue a lighting region for a water flood', () => {
    const world = new VoxelWorld('fluid-water-no-region');
    loadFlat(world, 30);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    const before = world.lightQueueMarks;
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 80);
    expect(world.lightQueueMarks).toBe(before);
    expect(world.getBlock(8 + 7, 31, 8)).toBe(BlockId.Water);
  });

  it('treats identical fluid state as a no-op with no extra invalidation', () => {
    const world = new VoxelWorld('fluid-noop');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    for (const chunk of world.chunks.values()) chunk.dirty = false;
    world.pendingMesh.clear();
    const marks = world.meshDirtyMarks;
    const queued = world.lightQueueMarks;
    expect(world.setBlockState(8, 31, 8, { fluidLevel: FLUID_SOURCE_LEVEL })).toBe(false);
    expect(applyFluidWrites(world, [{ x: 8, y: 31, z: 8, block: BlockId.Water, level: FLUID_SOURCE_LEVEL }])).toBe(0);
    expect(world.meshDirtyMarks).toBe(marks);
    expect(world.lightQueueMarks).toBe(queued);
    expect(world.pendingMesh.size).toBe(0);
  });

  it('dedupes the fluid queue to one pending coordinate', () => {
    const world = new VoxelWorld('fluid-dedupe');
    loadFlat(world, 30);
    world.applyBlockBatch([{ x: 8, y: 31, z: 8, block: BlockId.Water }], { scheduleNeighbors: false, updateLighting: false });
    for (let index = 0; index < 12; index += 1) world.scheduleFluid(8, 31, 8, 2);
    expect(world.fluidQueueSize).toBe(1);
    expect(world.fluidDedupe).toBeGreaterThanOrEqual(11);
  });

  it('coalesces many fluid edits in one chunk onto a single remesh', () => {
    const world = new VoxelWorld('fluid-mesh-coalesce');
    loadFlat(world, 30);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
      world.ensureChunkLighting(chunk);
    }
    world.pendingMesh.clear();
    for (let index = 0; index < 40; index += 1) {
      const x = 2 + (index % 8);
      const z = 2 + Math.floor(index / 8);
      world.setBlock(x, 31, z, BlockId.Water);
      world.setBlockState(x, 31, z, { fluidLevel: 4, fluidFalling: false });
    }
    expect(world.pendingMesh.size).toBe(1);
  });
});

describe('fluid equilibrium and distant pause', () => {
  it('settles water then stays at zero writes for 1000 extra ticks', () => {
    const world = new VoxelWorld('fluid-water-eq');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 250);
    const late = settleWrites(world, 1000);
    expect(late).toBe(0);
    expect(world.fluidWrites).toBe(0);
    expect(world.fluidLightDirtyChunks).toBe(0);
    expect(world.fluidMeshDirtyChunks).toBe(0);
  });

  it('settles lava then stays at zero writes for 1000 extra ticks', () => {
    const world = new VoxelWorld('fluid-lava-eq');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 500);
    const late = settleWrites(world, 1000);
    expect(late).toBe(0);
    expect(world.fluidWrites).toBe(0);
  });

  it('settles five water and five lava sources then idles', () => {
    const world = new VoxelWorld('fluid-soak');
    loadFlat(world, 30, 2);
    const spots = [
      [4, 4], [12, 4], [4, 12], [12, 12], [8, 8],
    ] as const;
    for (const [x, z] of spots) {
      world.setBlock(x, 31, z, BlockId.Water);
      world.scheduleFluidAround(x, 31, z, 1);
      world.setBlock(x + 16, 31, z, BlockId.Lava);
      world.scheduleFluidAround(x + 16, 31, z, 1);
    }
    tickWorld(world, 700);
    const late = settleWrites(world, 1000);
    expect(late).toBe(0);
    expect(world.fluidQueueSize).toBe(0);
  });

  it('drains after source removal and then idles', () => {
    const world = new VoxelWorld('fluid-remove-eq');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 160);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Water);
    world.setBlock(8, 31, 8, BlockId.Air);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 200);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Air);
    const late = settleWrites(world, 500);
    expect(late).toBe(0);
  });

  it('pauses distant fluid work and resumes when the player returns', () => {
    const world = new VoxelWorld('fluid-distant');
    loadFlat(world, 30, 2);
    world.setViewCenter(8, 8, 2);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 12);
    world.setViewCenter(8 + 40 * CHUNK_SIZE, 8, 2);
    const queued = world.fluidQueueSize;
    expect(queued).toBeGreaterThan(0);
    tickWorld(world, 20);
    expect(world.fluidPausedDistant).toBeGreaterThan(0);
    expect(world.fluidUpdates).toBe(0);
    expect(world.fluidQueueSize).toBe(queued);
    world.setViewCenter(8, 8, 2);
    tickWorld(world, 8);
    expect(world.fluidPausedDistant).toBe(0);
    expect(world.fluidUpdates + world.fluidWrites + world.fluidQueueSize).toBeGreaterThan(0);
  });

  it('enqueues only exposed generated lava boundaries, not whole ponds', () => {
    const world = new VoxelWorld('lava-lake-audit');
    let lava = 0;
    let exposed = 0;
    for (let cz = -2; cz <= 2; cz += 1) {
      for (let cx = -2; cx <= 2; cx += 1) {
        world.getChunk(cx, cz);
      }
    }
    for (let cz = -2; cz <= 2; cz += 1) {
      for (let cx = -2; cx <= 2; cx += 1) {
        const chunk = world.getChunk(cx, cz)!;
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            for (let y = 1; y <= 12; y += 1) {
              if (chunk.get(x, y, z) !== BlockId.Lava) continue;
              lava += 1;
              if (generatedFluidNeedsActivation(world, cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z)) exposed += 1;
            }
          }
        }
      }
    }
    expect(lava).toBeGreaterThan(0);
    expect(world.fluidQueueSize).toBe(exposed);
    if (lava > 12) expect(world.fluidQueueSize).toBeLessThan(lava);
  });

  it('still mixes water with lava source and flowing lava', () => {
    const world = new VoxelWorld('fluid-mix-still');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.setBlock(7, 31, 8, BlockId.Water);
    const sourceMix = computeFluidUpdate(world, 7, 31, 8);
    expect(sourceMix.some((write) => write.block === BlockId.Obsidian)).toBe(true);
    world.setBlock(10, 31, 8, BlockId.Lava);
    world.setBlockState(10, 31, 8, { fluidLevel: 4, fluidFalling: false });
    world.setBlock(9, 31, 8, BlockId.Water);
    world.scheduleFluid(10, 31, 8, 1);
    tickWorld(world, 8);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Cobblestone);
  });
});

describe('fluid placement must not starve chunk streaming', () => {
  function flyAfterFluid(seed: string, fluids: 'water' | 'lava' | 'both') {
    const world = new VoxelWorld(seed);
    world.setViewCenter(8, 8, 6);
    world.ensureChunks(8, 8, 2);
    const padY = 72;
    const origin = world.getChunk(0, 0)!;
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        origin.set(x, padY, z, BlockId.Stone);
        origin.set(x, padY + 1, z, BlockId.Air);
      }
    }
    if (fluids === 'water' || fluids === 'both') {
      world.applyBlockBatch([{ x: 8, y: padY + 1, z: 8, block: BlockId.Water }], { scheduleNeighbors: false });
      world.scheduleFluidAround(8, padY + 1, 8, 1);
    }
    if (fluids === 'lava' || fluids === 'both') {
      world.applyBlockBatch([{ x: 10, y: padY + 1, z: 10, block: BlockId.Lava }], { scheduleNeighbors: false });
      world.scheduleFluidAround(10, padY + 1, 10, 1);
    }
    tickWorld(world, fluids === 'lava' ? 40 : 24);
    return runStreamingPath(world, {
      policy: 'fair',
      meshRadius: 6,
      lightBudgetMs: WORLD_LIGHT_BUDGET_MS,
      pruneEveryFrames: 80,
      warmupFrames: 48,
      instantLight: false,
      tickWorld: true,
      speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
      path: [{ x: 8, z: 8 }, { x: 8 + 20 * CHUNK_SIZE, z: 8 }],
    });
  }

  it('keeps water→fly wanted chunks in hundreds of ms, not tens of seconds', () => {
    const result = flyAfterFluid('light-r6-fly', 'water');
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    expect(result.maxNearWantedMissingMs).toBeLessThan(8_000);
    expect(result.playerChunkMissMs).toBeLessThan(2_000);
    if (result.wantedToVisibleMs.length > 0) {
      expect(Math.max(...result.wantedToVisibleMs)).toBeLessThan(8_000);
      expect(percentile(result.wantedToVisibleMs, 95)).toBeLessThan(8_000);
    }
  }, 20_000);

  it('keeps lava→fly streaming off the 16–20 s hole path', () => {
    const result = flyAfterFluid('light-r6-fly', 'lava');
    expect(result.maxNearWantedMissingMs).toBeLessThan(8_000);
    expect(result.playerChunkMissMs).toBeLessThan(2_000);
    if (result.wantedToVisibleMs.length > 0) {
      expect(Math.max(...result.wantedToVisibleMs)).toBeLessThan(8_000);
    }
  }, 20_000);

  it('keeps water+lava→fly streaming acceptable', () => {
    const result = flyAfterFluid('light-r6-fly', 'both');
    expect(result.maxNearWantedMissingMs).toBeLessThan(8_000);
    expect(result.playerChunkMissMs).toBeLessThan(2_000);
    if (result.wantedToVisibleMs.length > 0) {
      expect(Math.max(...result.wantedToVisibleMs)).toBeLessThan(8_000);
    }
  }, 20_000);
});

describe('fluid mesh cost', () => {
  it('does not explode meshing cost on a fluid-heavy chunk', () => {
    const world = new VoxelWorld('fluid-mesh-cost');
    loadFlat(world, 30);
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    const mesher = new ChunkMesher(atlasStub, (x, y, z) => world.getBlockState(x, y, z));
    const dry = mesher.build(chunk, world);
    const dryFaces = dry.faces;
    dry.opaque.dispose();
    dry.cutout.dispose();
    dry.vegetation.dispose();
    dry.translucent.dispose();
    dry.water.dispose();
    dry.fire.dispose();
    for (let z = 2; z <= 13; z += 1) {
      for (let x = 2; x <= 13; x += 1) world.setBlock(x, 31, z, BlockId.Water);
    }
    const wet = mesher.build(chunk, world);
    expect(wet.faces).toBeGreaterThan(dryFaces);
    expect(wet.faces).toBeLessThan(dryFaces + 12 * 12 * 3);
    wet.opaque.dispose();
    wet.cutout.dispose();
    wet.vegetation.dispose();
    wet.translucent.dispose();
    wet.water.dispose();
    wet.fire.dispose();
  });
});
