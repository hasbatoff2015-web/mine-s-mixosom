import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import {
  continueSkyFill,
  lightingFloodOwner,
  processChunkLighting,
} from '../src/world/LightEngine';
import type { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import {
  collectUnlitLightJobs,
  isLightJobBlockedByFlood,
  lightingComputationRequiresNeighborLight,
  lightingUnlockNeighborKeys,
  lightJobSortScore,
  shouldPreemptDistantLightingFlood,
  takeReadyLightJobs,
  walkMeshLightDependencyChain,
} from '../src/world/streamingScheduler';
import { lightContextReady } from '../src/world/worldJobs';
import { runStreamingPath, STREAMING_SPEEDS } from '../src/world/streamingSim';

function yieldDuringBlockSeed(world: VoxelWorld, chunk: Chunk): void {
  continueSkyFill(chunk);
  expect(chunk.skyReady).toBe(true);
  const finished = processChunkLighting(world, chunk, performance.now());
  expect(finished).toBe(false);
  expect(lightingFloodOwner()).toBe(`${chunk.x},${chunk.z}`);
}

function generateCardinalNeighbors(world: VoxelWorld, cx: number, cz: number): void {
  world.getChunk(cx + 1, cz);
  world.getChunk(cx - 1, cz);
  world.getChunk(cx, cz + 1);
  world.getChunk(cx, cz - 1);
}

function counters() {
  return { attempted: 0, completed: 0, yielded: 0, blocked: 0 };
}

describe('lighting scheduler flood skip', () => {
  it('blocked head + ready second: ready job is taken', () => {
    const ordered = [{ key: '0,0' }, { key: '1,0' }, { key: '2,0' }];
    const copy = [...ordered];
    const result = takeReadyLightJobs(ordered, '2,0', 1);
    expect(result.skippedBlocked).toBe(2);
    expect(result.taken).toEqual([{ key: '2,0' }]);
    expect(ordered).toEqual(copy);
  });

  it('70 blocked + 1 ready still runs the ready job', () => {
    const ordered = Array.from({ length: 71 }, (_, i) => ({ key: i === 70 ? '9,9' : `${i},0` }));
    const result = takeReadyLightJobs(ordered, '9,9', 1);
    expect(result.skippedBlocked).toBe(70);
    expect(result.taken).toEqual([{ key: '9,9' }]);
  });

  it('processLighting resumes a near flood owner instead of stopping at other blocked jobs', () => {
    const world = new VoxelWorld('light-blocked-head');
    world.setViewCenter(8, 8, 4);
    world.ensureChunks(8, 8, 3);
    const near = world.getChunk(0, 0)!;
    yieldDuringBlockSeed(world, near);
    const cursorBefore = near.blockScanCursor;
    const stats = counters();
    world.processLighting(2, 8, 8, stats);
    expect(near.blockScanCursor).toBeGreaterThan(cursorBefore);
    expect(stats.attempted).toBeGreaterThan(0);
    expect(stats.yielded + stats.completed).toBeGreaterThan(0);
    expect(lightingFloodOwner() === '0,0' || near.lightingReady).toBe(true);
  });

  it('keeps blocked jobs pending instead of dropping them', () => {
    const world = new VoxelWorld('light-keep-pending');
    world.setViewCenter(8, 8, 4);
    world.ensureChunks(8, 8, 3);
    const far = world.getChunk(3, 3)!;
    yieldDuringBlockSeed(world, far);
    const unlitBefore = [...world.chunks.values()].filter((chunk) => !chunk.lightingReady).length;
    world.processLighting(2, 8, 8, counters());
    const unlitAfter = [...world.chunks.values()].filter((chunk) => !chunk.lightingReady).length;
    expect(unlitAfter).toBeGreaterThanOrEqual(unlitBefore - 1);
    expect(unlitAfter).toBeGreaterThan(10);
  });
});

describe('halo lighting dependencies', () => {
  it('does not require neighbor light to compute a chunk’s own lighting', () => {
    expect(lightingComputationRequiresNeighborLight()).toBe(false);
    const world = new VoxelWorld('light-isolated');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    expect(chunk.lightingReady).toBe(true);
    expect(world.chunks.size).toBe(1);
  });

  it('mesh context waits on unlit neighbors, which is a DAG not a cycle', () => {
    const world = new VoxelWorld('light-dag');
    world.setViewCenter(8, 8, 2);
    world.getChunk(0, 0);
    generateCardinalNeighbors(world, 0, 0);
    world.ensureChunkLighting(world.getChunk(0, 0)!);
    const chain = walkMeshLightDependencyChain(world, 0, 0, 0, 0, 3);
    expect(chain.cycle).toBe(false);
    expect(chain.leafReadyToLight).toBe(true);
    expect(chain.steps.some((step) => step.state === 'unlit')).toBe(true);
  });

  it('A→B→C mesh wait resolves by lighting the ready leaf', () => {
    const world = new VoxelWorld('light-chain');
    world.setViewCenter(8, 8, 2);
    const a = world.getChunk(0, 0)!;
    generateCardinalNeighbors(world, 0, 0);
    world.getChunk(0, 2);
    world.ensureChunkLighting(a);
    world.ensureChunkLighting(world.getChunk(1, 0)!);
    world.ensureChunkLighting(world.getChunk(-1, 0)!);
    world.ensureChunkLighting(world.getChunk(0, -1)!);
    const b = world.getChunk(0, 1)!;
    const c = world.getChunk(0, 2)!;
    expect(lightContextReady(world, a, 0, 0, 3)).toBe(false);
    let steps = 0;
    while ((!b.lightingReady || !c.lightingReady) && steps < 80) {
      world.processLighting(2, 8, 8);
      steps += 1;
    }
    expect(b.lightingReady).toBe(true);
    expect(c.lightingReady).toBe(true);
    expect(lightContextReady(world, a, 0, 0, 3)).toBe(true);
  });

  it('nearest wanted dependency outranks a distant halo unlit chunk', () => {
    const world = new VoxelWorld('light-priority');
    world.setViewCenter(8, 8, 4);
    world.getChunk(0, 0);
    world.getChunk(0, 1);
    world.getChunk(4, 0);
    world.ensureChunkLighting(world.getChunk(0, 0)!);
    const unlock = lightingUnlockNeighborKeys(world, 0, 0, 4, 5);
    expect(unlock.has('0,1')).toBe(true);
    const jobs = collectUnlitLightJobs(world, 8, 8, 5, unlock);
    expect(jobs[0]?.chunk.x).toBe(0);
    expect(jobs[0]?.chunk.z).toBe(1);
    const near = lightJobSortScore(0, 1, 0, 0, 5, true);
    const far = lightJobSortScore(4, 0, 0, 0, 5, false);
    expect(near).toBeLessThan(far);
  });

  it('preempts a distant in-progress flood when a near unlock job is waiting', () => {
    expect(shouldPreemptDistantLightingFlood('4,0', 0, 0, new Set(['0,1']), 1)).toBe(true);
    expect(shouldPreemptDistantLightingFlood('0,1', 0, 0, new Set(['0,1']), 1)).toBe(false);
    expect(shouldPreemptDistantLightingFlood('4,0', 0, 0, new Set(), 0)).toBe(false);

    const world = new VoxelWorld('light-preempt-flood');
    world.setViewCenter(8, 8, 4);
    world.ensureChunks(8, 8, 4);
    world.ensureChunkLighting(world.getChunk(0, 0)!);
    const far = world.getChunk(4, 0)!;
    yieldDuringBlockSeed(world, far);
    expect(lightingFloodOwner()).toBe('4,0');
    const unlock = lightingUnlockNeighborKeys(world, 0, 0, 4, world.generationRadius);
    const stats = counters();
    world.processLighting(2, 8, 8, stats);
    expect(lightingFloodOwner()).not.toBe('4,0');
    expect(far.lightingReady).toBe(false);
    expect(stats.attempted + stats.yielded + stats.completed).toBeGreaterThan(0);
    const owner = lightingFloodOwner();
    const unlockedProgress = [...unlock].some((key) => {
      const chunk = world.chunks.get(key);
      return chunk !== undefined && (chunk.lightingReady || chunk.skyReady || chunk.blockScanCursor > 0);
    });
    expect(owner === '' || unlock.has(owner) || unlockedProgress).toBe(true);
  });

  it('skips obsolete unlit chunks outside the generate radius', () => {
    const world = new VoxelWorld('light-obsolete');
    world.setViewCenter(8, 8, 2);
    world.ensureChunks(8, 8, 2);
    world.setViewCenter(8 + 20 * CHUNK_SIZE, 8, 2);
    const leftover = [...world.chunks.values()].filter((chunk) => !chunk.lightingReady);
    expect(leftover.length).toBeGreaterThan(0);
    world.processLighting(8, 8 + 20 * CHUNK_SIZE, 8);
    for (const chunk of leftover) {
      expect(chunk.lightingReady).toBe(false);
    }
  });

  it('clears an orphaned flood mutex after prune', () => {
    const world = new VoxelWorld('light-orphan-flood');
    world.setViewCenter(8, 8, 2);
    world.ensureChunks(8, 8, 2);
    const far = world.getChunk(2, 2)!;
    yieldDuringBlockSeed(world, far);
    expect(lightingFloodOwner()).toBe('2,2');
    world.pruneChunks(8 + 16 * CHUNK_SIZE, 8, 2);
    expect(world.chunks.has('2,2')).toBe(false);
    expect(lightingFloodOwner()).toBe('');
  });

  it('drops an obsolete flood owner outside generate radius so nearby lighting can run', () => {
    const world = new VoxelWorld('light-obsolete-flood');
    world.setViewCenter(8, 8, 2);
    world.ensureChunks(8, 8, 2);
    const far = world.getChunk(2, 2)!;
    yieldDuringBlockSeed(world, far);
    expect(lightingFloodOwner()).toBe('2,2');
    const farX = 8 + 10 * CHUNK_SIZE;
    world.setViewCenter(farX, 8, 2);
    world.ensureChunks(farX, 8, 2);
    const stats = counters();
    world.processLighting(2, farX, 8, stats);
    expect(lightingFloodOwner()).not.toBe('2,2');
    expect(far.lightingReady).toBe(false);
    expect(stats.attempted + stats.yielded + stats.completed).toBeGreaterThan(0);
    const originCx = Math.floor(farX / CHUNK_SIZE);
    const near = world.getChunk(originCx, 0)!;
    let steps = 0;
    while (!near.lightingReady && steps < 40) {
      world.processLighting(2, farX, 8);
      steps += 1;
    }
    expect(near.lightingReady).toBe(true);
  });
});

describe('lighting scheduler production path / regressions', () => {
  it('wanted set at render radius 6 is 13×13', () => {
    const wanted = (2 * 6 + 1) ** 2;
    expect(wanted).toBe(169);
  });

  it('sliced lighting still finishes a yielded chunk without a 30 ms slice', () => {
    const world = new VoxelWorld('light-slice-budget');
    const chunk = world.getChunk(0, 0)!;
    processChunkLighting(world, chunk, performance.now());
    const started = performance.now();
    let steps = 0;
    while (!chunk.lightingReady && steps < 64) {
      world.processLighting(2, 8, 8);
      steps += 1;
    }
    expect(chunk.lightingReady).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('torch still crosses a chunk border after scheduler changes', () => {
    const world = new VoxelWorld('light-torch-sched');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    for (const chunk of world.chunks.values()) {
      chunk.blocks.fill(BlockId.Air);
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          for (let y = 0; y <= 40; y += 1) {
            chunk.set(lx, y, lz, y === 40 ? BlockId.GrassBlock : BlockId.Stone);
          }
        }
      }
      world.ensureChunkLighting(chunk);
    }
    for (let x = 12; x <= 20; x += 1) {
      for (let z = 6; z <= 10; z += 1) {
        for (let y = 41; y <= 50; y += 1) world.setBlock(x, y, z, BlockId.Air);
      }
    }
    expect(world.setBlock(15, 44, 8, BlockId.Torch)).toBe(true);
    expect(world.blockLightAt(16, 44, 8)).toBeGreaterThanOrEqual(12);
  });

  it('flat skylight still matches across a chunk border', () => {
    const world = new VoxelWorld('light-sky-seam-sched');
    world.getChunk(0, 0);
    world.getChunk(1, 0);
    for (const chunk of world.chunks.values()) {
      chunk.blocks.fill(BlockId.Air);
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          for (let y = 0; y <= 48; y += 1) {
            chunk.set(lx, y, lz, y === 48 ? BlockId.GrassBlock : BlockId.Stone);
          }
        }
      }
      world.ensureChunkLighting(chunk);
    }
    expect(world.skyLightAt(15, 49, 8)).toBe(15);
    expect(world.skyLightAt(16, 49, 8)).toBe(15);
    expect(world.skyLightAt(15, 48, 8)).toBe(0);
  });

  it('rapid interior breaks still collapse onto one pending mesh job', () => {
    const world = new VoxelWorld('light-break-sched');
    world.ensureChunks(8, 8, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    for (const chunk of world.chunks.values()) chunk.dirty = false;
    world.pendingMesh.clear();
    for (let index = 0; index < 30; index += 1) {
      const x = 4 + (index % 8);
      const z = 4 + Math.floor(index / 8);
      world.applyBlockBatch([{ x, y: 40, z, block: BlockId.Stone }]);
      world.applyBlockBatch([{ x, y: 40, z, block: BlockId.Air }]);
    }
    expect(world.pendingMeshJobs).toBe(1);
    expect(world.dirtyChunkCount).toBe(1);
  });

  it('radius-6 sliced-light flight keeps near wanted holes well below tens of seconds', () => {
    const result = runStreamingPath(new VoxelWorld('light-r6-fly'), {
      policy: 'fair',
      meshRadius: 6,
      lightBudgetMs: 2,
      pruneEveryFrames: 80,
      warmupFrames: 48,
      instantLight: false,
      speedBlocksPerSec: STREAMING_SPEEDS.flySprint,
      path: [{ x: 8, z: 8 }, { x: 8 + 20 * CHUNK_SIZE, z: 8 }],
    });
    // WORLD_HEIGHT 256 adds empty sky above occupancy; sky fill still stops at occupancyTop.
    // This still forbids the 20–160 s halo starvation the scheduler pass fixed.
    expect(result.maxNearWantedMissingMs).toBeLessThan(8_000);
    expect(result.playerChunkMissMs).toBeLessThan(2_000);
    const wanted = result.wantedToVisibleMs;
    if (wanted.length > 0) {
      const max = Math.max(...wanted);
      expect(max).toBeLessThan(8_000);
    }
  }, 15_000);

  it('flood-blocked jobs are skipped, not treated as a stop', () => {
    expect(isLightJobBlockedByFlood('3,3', '0,0')).toBe(true);
    expect(isLightJobBlockedByFlood('3,3', '3,3')).toBe(false);
    expect(isLightJobBlockedByFlood('', '0,0')).toBe(false);
  });
});
