import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { formatEditLightLine } from '../src/core/devProfiler';
import {
  LIGHT_FLOOD_REGION,
  chunkNeedsCommittedMeshLight,
  lightingBlockOverrideCount,
  lightingFloodOwner,
  lightingMemoryUsage,
  lightFrameStats,
  readMeshBlockLight,
} from '../src/world/LightEngine';
import { EDIT_LIGHT_MAX_WAIT_MS, EDIT_LIGHT_QUEUE_LIMIT, VoxelWorld } from '../src/world/World';

/**
 * Frozen clock: one cap-slice per frame, then `now` jumps by a whole frame.
 * A sky/block region in this shaft is dozens of slices, and the oldest job
 * also waits for the flood already running. The measured peak is 75 frames
 * at 60 FPS and 57 frames at 30 FPS. Slack is two overdue intervals, not an
 * exact timestamp. Priced at `WORLD_LIGHT_BUDGET_MS` per slice that peak is
 * on the order of `EDIT_LIGHT_MAX_WAIT_MS` (a few hundred ms), which is what
 * the slice-budget assert checks. The 16–19 ms figure is the real CPU
 * benchmark. A quiet hold for the whole stream fails both asserts.
 */
function streamPendingAgeLimitMs(frameMs: number): number {
  const observedFrames = frameMs > 20 ? 57 : 75;
  return observedFrames * frameMs + EDIT_LIGHT_MAX_WAIT_MS * 2;
}

function sliceBudgetAgeMs(maxAge: number, frameMs: number): number {
  return (maxAge / frameMs) * WORLD_LIGHT_BUDGET_MS;
}

/**
 * Removed scheduler: once 8 edits had landed, skip region floods until 80 ms
 * passed with no further edit. A 20 TPS stream refreshes that timestamp every
 * 50 ms, so the hold never expires. The live scheduler must not do this.
 */
function legacyQuietHold(blocks: number, sinceLastEditMs: number): boolean {
  return blocks >= 8 && sinceLastEditMs < 80;
}

const options = { deferLighting: true, scheduleNeighbors: false, skipSupport: true } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function settle(world: VoxelWorld, x = 8, z = 8): void {
  for (let step = 0; step < 8000; step += 1) {
    if (world.pendingLightJobs === 0 && lightingFloodOwner(world) === '') return;
    world.processLighting(WORLD_LIGHT_BUDGET_MS, x, z);
  }
  throw new Error(`lighting did not settle pending=${world.pendingLightJobs} owner=${lightingFloodOwner(world)}`);
}

function preparePlatform(seed: string): { world: VoxelWorld; cells: Array<{ x: number; y: number; z: number }> } {
  const world = new VoxelWorld(seed);
  world.ensureChunks(8, 8, 1);
  const air = [];
  for (let x = 0; x <= 16; x += 1) {
    for (let z = 0; z <= 16; z += 1) {
      for (let y = 30; y <= 80; y += 1) air.push({ x, y, z, block: BlockId.Air });
    }
  }
  world.applyBlockBatch(air, { scheduleNeighbors: false, skipSupport: true });
  const cells = [];
  const stones = [];
  for (let x = 2; x <= 13; x += 1) {
    for (let z = 2; z <= 13; z += 1) {
      cells.push({ x, y: 42, z });
      stones.push({ x, y: 42, z, block: BlockId.Stone });
    }
  }
  world.applyBlockBatch(stones, { scheduleNeighbors: false, skipSupport: true });
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  return { world, cells };
}

describe('edit light queue', () => {
  it('documents that the removed 80 ms quiet hold blocks a 20 TPS stream', () => {
    expect(legacyQuietHold(8, 50)).toBe(true);
    expect(legacyQuietHold(8, 80)).toBe(false);
    expect(legacyQuietHold(7, 10)).toBe(false);
    let blocked = false;
    for (let t = 0; t <= 1000; t += 50) blocked = legacyQuietHold(8 + t / 50, 50);
    expect(blocked).toBe(true);
  });

  it('coalesces overlapping edits and keeps distant edits apart', () => {
    const world = new VoxelWorld('queue-shape');
    for (let i = 0; i < 100; i += 1) {
      world.queueLight({
        minX: (i % 5) - 14, maxX: (i % 5) + 14, minY: 30, maxY: 50, minZ: -14, maxZ: 14,
      }, true, true);
    }
    expect(world.editLightQueueLength).toBe(1);
    expect(world.editLightMerges).toBe(99);
    expect(world.editLightEnqueued).toBe(1);

    const distant = new VoxelWorld('queue-distant');
    distant.queueLight({ minX: 0, maxX: 28, minY: 30, maxY: 60, minZ: 0, maxZ: 28 }, true, true);
    distant.queueLight({ minX: 160, maxX: 188, minY: 30, maxY: 60, minZ: 0, maxZ: 28 }, true, true);
    expect(distant.editLightQueueLength).toBe(2);
    const [near, far] = distant.editLightRegions();
    expect(near!.maxX).toBeLessThan(far!.minX);

    const capped = new VoxelWorld('queue-cap');
    for (let i = 0; i < 40; i += 1) {
      const x = i * 80;
      capped.queueLight({ minX: x, maxX: x, minY: 40, maxY: 40, minZ: 0, maxZ: 0 }, false, true);
    }
    expect(capped.editLightQueueLength).toBeLessThanOrEqual(EDIT_LIGHT_QUEUE_LIMIT);
    expect(capped.editLightQueueLength).toBe(EDIT_LIGHT_QUEUE_LIMIT);
    expect(capped.editLightEnqueued + capped.editLightMerges).toBe(40);
  });

  it('keeps mesh light on the last commit while a new edit arrives mid-flood', () => {
    const { world } = preparePlatform('queue-stable');
    world.setBlock(8, 40, 8, BlockId.Glowstone);
    const lit = readMeshBlockLight(world, 9, 40, 8);
    expect(lit).toBeGreaterThan(8);
    world.deferredLighting = true;
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    world.applyBlockBatch([{ x: 8, y: 40, z: 8, block: BlockId.Air }], options);
    world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
    expect(world.editLightCommits).toBe(0);
    expect(lightingFloodOwner(world)).toBe(LIGHT_FLOOD_REGION);
    expect(readMeshBlockLight(world, 9, 40, 8)).toBe(lit);
    world.applyBlockBatch([{ x: 9, y: 40, z: 8, block: BlockId.Stone }], options);
    expect(lightingBlockOverrideCount(world)).toBeGreaterThan(0);
    expect(world.editLightRestarts).toBe(0);
    expect(readMeshBlockLight(world, 9, 40, 8)).toBe(lit);
    for (let step = 0; step < 400 && (world.pendingLightJobs > 0 || lightingFloodOwner(world) !== ''); step += 1) {
      now += 16;
      world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
    }
    expect(world.pendingLightJobs).toBe(0);
    expect(lightingFloodOwner(world)).toBe('');
    expect(lightingBlockOverrideCount(world)).toBe(0);
    expect(chunkNeedsCommittedMeshLight(world, world.getChunk(0, 0)!)).toBe(false);
    expect(readMeshBlockLight(world, 9, 40, 8)).toBeLessThan(lit);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
  });

  it('commits during a 20 TPS edit stream at 60 FPS and at 30 FPS', () => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    const reference = preparePlatform('queue-stream');
    const streamed = preparePlatform('queue-stream');
    const count = 80;
    for (let i = 0; i < count; i += 1) {
      const cell = reference.cells[i]!;
      reference.world.applyBlockBatch([{ ...cell, block: BlockId.Air }], {
        scheduleNeighbors: false, skipSupport: true,
      });
    }
    streamed.world.deferredLighting = true;
    let now = 20_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const run = (frameMs: number, frames: number) => {
      let applied = 0;
      let commitsDuring = 0;
      let maxQueue = 0;
      let maxAge = 0;
      let columns = 0;
      let nodes = 0;
      const started = streamed.world.editLightCommits;
      for (let frame = 0; frame < frames && applied < count; frame += 1) {
        now += frameMs;
        if (applied * 50 <= frame * frameMs) {
          const cell = streamed.cells[applied]!;
          streamed.world.applyBlockBatch([{ ...cell, block: BlockId.Air }], options);
          applied += 1;
        }
        const before = streamed.world.editLightCommits;
        streamed.world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
        columns += lightFrameStats.columns;
        nodes += lightFrameStats.nodes;
        if (applied < count) commitsDuring += streamed.world.editLightCommits - before;
        maxQueue = Math.max(maxQueue, streamed.world.editLightQueueLength);
        maxAge = Math.max(maxAge, streamed.world.editLightOldestAgeMs(now));
      }
      return {
        applied,
        commitsDuring,
        maxQueue,
        maxAge,
        columns,
        nodes,
        commits: streamed.world.editLightCommits - started,
      };
    };
    const at60 = run(1000 / 60, Math.ceil(5000 / (1000 / 60)));
    expect(at60.applied).toBe(count);
    expect(at60.commitsDuring).toBeGreaterThan(1);
    expect(at60.maxQueue).toBeLessThanOrEqual(6);
    expect(at60.maxAge).toBeLessThan(streamPendingAgeLimitMs(1000 / 60));
    expect(sliceBudgetAgeMs(at60.maxAge, 1000 / 60)).toBeLessThan(EDIT_LIGHT_MAX_WAIT_MS * 2);
    expect(at60.columns + at60.nodes).toBeGreaterThan(0);
    for (let step = 0; step < 8000 && (streamed.world.pendingLightJobs > 0 || lightingFloodOwner(streamed.world) !== ''); step += 1) {
      now += 16;
      streamed.world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
    }
    expect(streamed.world.pendingLightJobs).toBe(0);
    expect(streamed.world.editLightRestarts).toBe(0);
    expect(lightingMemoryUsage(streamed.world).snapshotBytes).toBe(0);
    expect(lightingMemoryUsage(streamed.world).peakSnapshotBytes).toBeGreaterThan(0);
    const naive = streamed.world.chunks.size * 16 * 16 * 256 * 2;
    expect(lightingMemoryUsage(streamed.world).peakSnapshotBytes).toBeLessThan(naive);
    for (let i = 0; i < count; i += 1) {
      const cell = reference.cells[i]!;
      expect(streamed.world.getBlock(cell.x, cell.y, cell.z)).toBe(BlockId.Air);
      expect(streamed.world.blockLightAt(cell.x, cell.y + 1, cell.z)).toBe(reference.world.blockLightAt(cell.x, cell.y + 1, cell.z));
      expect(streamed.world.skyLightAt(cell.x, cell.y + 1, cell.z)).toBe(reference.world.skyLightAt(cell.x, cell.y + 1, cell.z));
    }
    const line = formatEditLightLine(streamed.world.editLightSnapshot(now));
    expect(line).toContain('EDITQ 0');
    expect(line).toContain('commits');
    expect(line).toContain('restart 0');
  });

  it('still commits while edits arrive at 30 FPS', () => {
    const streamed = preparePlatform('queue-stream-30');
    streamed.world.deferredLighting = true;
    const count = 40;
    let now = 30_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let applied = 0;
    let commitsDuring = 0;
    let maxQueue = 0;
    let maxAge = 0;
    const frames = Math.ceil(4000 / (1000 / 30));
    for (let frame = 0; frame < frames && applied < count; frame += 1) {
      now += 1000 / 30;
      if (applied * 50 <= frame * (1000 / 30)) {
        const cell = streamed.cells[applied]!;
        streamed.world.applyBlockBatch([{ ...cell, block: BlockId.Air }], options);
        applied += 1;
      }
      const before = streamed.world.editLightCommits;
      streamed.world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8);
      if (applied < count) commitsDuring += streamed.world.editLightCommits - before;
      maxQueue = Math.max(maxQueue, streamed.world.editLightQueueLength);
      maxAge = Math.max(maxAge, streamed.world.editLightOldestAgeMs(now));
    }
    expect(applied).toBe(count);
    expect(commitsDuring).toBeGreaterThan(0);
    expect(maxQueue).toBeLessThanOrEqual(6);
    expect(maxAge).toBeLessThan(streamPendingAgeLimitMs(1000 / 30));
    expect(sliceBudgetAgeMs(maxAge, 1000 / 30)).toBeLessThan(EDIT_LIGHT_MAX_WAIT_MS * 2);
    expect(streamed.world.editLightRestarts).toBe(0);
  });

  it('propagates a deferred source across cardinal and diagonal chunk borders', () => {
    const world = new VoxelWorld('queue-border');
    world.ensureChunks(8, 8, 1);
    world.ensureChunks(24, 8, 1);
    world.ensureChunks(8, 24, 1);
    world.ensureChunks(24, 24, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    world.applyBlockBatch([
      { x: 14, y: 70, z: 8, block: BlockId.Air },
      { x: 15, y: 70, z: 8, block: BlockId.Air },
      { x: 16, y: 70, z: 8, block: BlockId.Air },
      { x: 15, y: 71, z: 8, block: BlockId.Air },
      { x: 16, y: 71, z: 8, block: BlockId.Air },
      { x: 15, y: 70, z: 14, block: BlockId.Air },
      { x: 15, y: 70, z: 15, block: BlockId.Air },
      { x: 15, y: 70, z: 16, block: BlockId.Air },
      { x: 16, y: 70, z: 15, block: BlockId.Air },
      { x: 16, y: 70, z: 16, block: BlockId.Air },
    ], { scheduleNeighbors: false, skipSupport: true });
    world.deferredLighting = true;
    world.applyBlockBatch([{ x: 15, y: 70, z: 8, block: BlockId.Torch }], options);
    settle(world);
    expect(world.blockLightAt(16, 70, 8)).toBeGreaterThan(0);
    world.applyBlockBatch([{ x: 15, y: 70, z: 15, block: BlockId.Glowstone }], options);
    settle(world, 24, 24);
    expect(world.blockLightAt(16, 70, 16)).toBeGreaterThan(0);
    world.applyBlockBatch([
      { x: 15, y: 70, z: 8, block: BlockId.Air },
      { x: 15, y: 70, z: 15, block: BlockId.Air },
    ], options);
    settle(world);
    expect(world.blockLightAt(16, 70, 8)).toBe(0);
    expect(world.blockLightAt(16, 70, 16)).toBe(0);
  });

  it('does not relight every loaded chunk for edits inside one chunk', () => {
    const world = new VoxelWorld('queue-local-chunks');
    world.setViewCenter(8, 8, 3);
    world.ensureChunks(8, 8, 3);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    expect(world.chunks.size).toBeGreaterThan(9);
    const open = [];
    for (let x = 0; x <= 16; x += 1) {
      for (let z = 0; z <= 16; z += 1) {
        for (let y = 40; y <= 70; y += 1) open.push({ x, y, z, block: BlockId.Air });
      }
    }
    world.applyBlockBatch(open, { scheduleNeighbors: false, skipSupport: true });
    const floor = [];
    for (let x = 4; x <= 13; x += 1) {
      for (let z = 4; z <= 13; z += 1) floor.push({ x, y: 42, z, block: BlockId.Stone });
    }
    world.applyBlockBatch(floor, { scheduleNeighbors: false, skipSupport: true });
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    const versions = new Map([...world.chunks].map(([key, chunk]) => [key, chunk.lightVersion]));
    world.deferredLighting = true;
    for (let i = 0; i < 100; i += 1) {
      const x = 4 + (i % 10);
      const z = 4 + Math.floor(i / 10);
      world.applyBlockBatch([{ x, y: 42, z, block: BlockId.Air }], options);
    }
    expect(world.editLightQueueLength).toBe(1);
    expect(world.editLightEnqueued).toBe(1);
    settle(world);
    let changed = 0;
    for (const [key, chunk] of world.chunks) {
      if (chunk.lightVersion !== versions.get(key)) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(25);
    expect(changed).toBeLessThan(world.chunks.size);
  });

  it('leaves immediate server lighting off the deferred queue', () => {
    const world = new VoxelWorld('queue-immediate');
    world.ensureChunks(8, 8, 0);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    expect(world.setBlock(8, 60, 8, BlockId.Glowstone)).toBe(true);
    expect(world.editLightQueueLength).toBe(0);
    expect(world.blockLightAt(8, 60, 8)).toBe(15);
    expect(world.deferredLighting).toBe(false);
  });
});
