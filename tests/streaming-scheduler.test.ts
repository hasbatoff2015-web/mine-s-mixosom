import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/core/constants';
import { VoxelWorld } from '../src/world/World';
import {
  collectReadyMeshJobs,
  completeCpuMesh,
  discardObsoletePendingMesh,
  isUrgentReadyMesh,
  meshJobSortScore,
  pendingMeshInRadius,
  planMeshFrame,
  takeReadyMeshJobs,
  URGENT_MESH_WAIT_MS,
} from '../src/world/streamingScheduler';
import {
  planLegacyMeshFrame,
  stepStreamingFrame,
} from '../src/world/streamingSim';
import { shouldWarnReadyMeshWait } from '../src/debug/chunkStreamingInspector';

function litWorld(seed: string, x: number, z: number, radius: number): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.ensureChunks(x, z, radius);
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  return world;
}

describe('streaming scheduler fairness', () => {
  it('does not let continuous generation starve a nearby ready mesh job', () => {
    const ready = [{
      chunk: { x: 0, z: 0 } as never,
      chebyshev: 1,
      waitMs: 16,
      urgent: true,
    }];
    let streak = 0;
    let meshFrames = 0;
    let legacyMeshFrames = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      const fair = planMeshFrame({
        loading: false,
        generatedThisFrame: true,
        consecutiveGenWithoutMesh: streak,
        readyJobs: ready,
        defaultMeshLimit: 2,
        frameElapsedMs: 1,
      });
      const legacy = planLegacyMeshFrame({
        loading: false,
        generatedThisFrame: true,
        readyJobs: ready,
        defaultMeshLimit: 2,
      });
      if (!fair.skipMesh) meshFrames += 1;
      if (!legacy.skipMesh) legacyMeshFrames += 1;
      streak = fair.skipMesh ? streak + 1 : 0;
    }
    expect(legacyMeshFrames).toBe(0);
    expect(meshFrames).toBeGreaterThanOrEqual(6);
    expect(meshFrames).toBeLessThanOrEqual(12);
  });

  it('LOADING_WORLD still meshes on a generation frame', () => {
    const plan = planMeshFrame({
      loading: true,
      generatedThisFrame: true,
      consecutiveGenWithoutMesh: 99,
      readyJobs: [{ chunk: { x: 0, z: 0 } as never, chebyshev: 0, waitMs: 0, urgent: true }],
      defaultMeshLimit: 4,
      frameElapsedMs: 20,
    });
    expect(plan.skipMesh).toBe(false);
    expect(plan.meshLimit).toBe(4);
  });

  it('promotes a ready mesh that waited past the urgent threshold', () => {
    expect(isUrgentReadyMesh(8, URGENT_MESH_WAIT_MS)).toBe(true);
    const plan = planMeshFrame({
      loading: false,
      generatedThisFrame: true,
      consecutiveGenWithoutMesh: 0,
      readyJobs: [{ chunk: { x: 8, z: 0 } as never, chebyshev: 8, waitMs: 180, urgent: true }],
      defaultMeshLimit: 2,
      frameElapsedMs: 20,
    });
    expect(plan.skipMesh).toBe(false);
    expect(plan.meshLimit).toBe(1);
    expect(plan.starvationAvoided).toBe(true);
  });
});

describe('streaming scheduler cleanup and priority', () => {
  it('drops pending mesh bookkeeping outside the wanted mesh radius without deleting chunk data', () => {
    const world = litWorld('obsolete-mesh', 8, 8, 3);
    for (const chunk of world.chunks.values()) chunk.dirty = true;
    world.pendingMesh.clear();
    world.getChunk(12, 0);
    world.markMeshDirty(world.getChunk(12, 0)!);
    expect(world.pendingMesh.has('12,0')).toBe(true);
    const removed = discardObsoletePendingMesh(world, 8, 8, 2);
    expect(removed).toBeGreaterThan(0);
    expect(world.pendingMesh.has('12,0')).toBe(false);
    expect(world.chunks.has('12,0')).toBe(true);
    expect(world.getChunk(12, 0, false)?.dirty).toBe(true);
    expect(pendingMeshInRadius(world, 8, 8, 2)).toBe(world.pendingMesh.size);
    for (const key of world.pendingMesh) {
      const [cx, cz] = key.split(',').map(Number);
      expect(Math.max(Math.abs(cx! - 0), Math.abs(cz! - 0))).toBeLessThanOrEqual(2);
    }
  });

  it('clears pendingMesh keys when pruneChunks unloads a chunk', () => {
    const world = litWorld('prune-pending', 0, 0, 1);
    const far = world.getChunk(8, 0)!;
    world.markMeshDirty(far);
    expect(world.pendingMesh.has('8,0')).toBe(true);
    const removed = world.pruneChunks(0, 0, 1);
    expect(removed).toContain('8,0');
    expect(world.pendingMesh.has('8,0')).toBe(false);
    expect(world.chunks.has('8,0')).toBe(false);
  });

  it('keeps meshQueue / pendingMesh / in-radius counts consistent after complete', () => {
    const world = litWorld('queue-consistency', 8, 8, 1);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = false;
      chunk.meshedLightVersion = chunk.lightVersion;
      world.acknowledgeMeshed(chunk);
    }
    const chunk = world.getChunk(0, 0)!;
    world.markMeshDirty(chunk);
    discardObsoletePendingMesh(world, 8, 8, 1);
    expect(world.pendingMeshJobs).toBe(1);
    expect(pendingMeshInRadius(world, 8, 8, 1)).toBe(1);
    completeCpuMesh(world, chunk);
    expect(world.pendingMeshJobs).toBe(0);
    expect(pendingMeshInRadius(world, 8, 8, 1)).toBe(0);
    expect(chunk.dirty).toBe(false);
  });

  it('reprioritizes so a new nearby chunk outranks an old far job after the player crosses', () => {
    const far = meshJobSortScore(8, 0, 0, 0, 1, 0, 0);
    const near = meshJobSortScore(1, 0, 0, 0, 1, 0, 0);
    expect(near).toBeLessThan(far);
    const oldNearFromNewOrigin = meshJobSortScore(0, 0, 8, 0, -1, 0, 400);
    const newPlayer = meshJobSortScore(8, 0, 8, 0, -1, 0, 0);
    expect(newPlayer).toBeLessThan(oldNearFromNewOrigin);
  });

  it('skips a blocked mesh head and still takes the next ready job', () => {
    const jobs = [
      { key: '0,0', blocked: true },
      { key: '1,0', blocked: false },
      { key: '2,0', blocked: false },
    ];
    const result = takeReadyMeshJobs(jobs, (job) => job.blocked, 1);
    expect(result.taken.map((job) => job.key)).toEqual(['1,0']);
    expect(result.skippedBlocked).toBe(1);
    expect(result.attempted).toBe(2);
  });

  it('does not stop the live mesh lane when the first dirty chunk is unlit', () => {
    const world = litWorld('blocked-head', 8, 8, 3);
    world.setViewCenter(8, 8, 2);
    for (const chunk of world.chunks.values()) {
      chunk.dirty = true;
      chunk.skyReady = true;
      chunk.skyLateralReady = true;
      chunk.blockLightReady = true;
      chunk.meshedLightVersion = -1;
    }
    const head = world.getChunk(0, 0)!;
    head.skyReady = false;
    head.blockLightReady = false;
    // The inner 3x3 all read the unlit center, including its diagonals.
    // Ready jobs on the next ring must still run.
    const jobs = collectReadyMeshJobs(world, 8, 8, 2, performance.now());
    expect(jobs.some((job) => job.chunk === head)).toBe(false);
    expect(jobs.length).toBeGreaterThan(0);
    const { taken } = takeReadyMeshJobs(jobs, (job) => !job.chunk.lightingReady, 1);
    expect(taken[0]?.chunk.lightingReady).toBe(true);
    completeCpuMesh(world, taken[0]!.chunk);
    expect(taken[0]!.chunk.dirty).toBe(false);
    expect(head.dirty).toBe(true);
  });
});

describe('streaming sim vs legacy skip-on-gen', () => {
  it('fair policy meshes during continuous generation while legacy never does', () => {
    const fairWorld = new VoxelWorld('sim-fair');
    const legacyWorld = new VoxelWorld('sim-legacy');
    const visibleFair = new Set<string>();
    const visibleLegacy = new Set<string>();
    let fairStreak = 0;
    let legacyStreak = 0;
    let fairMeshed = 0;
    let legacyMeshed = 0;
    let now = 1;
    for (let frame = 0; frame < 40; frame += 1) {
      now += 16.67;
      const originX = 8 + frame * 2;
      const originZ = 8;
      const fair = stepStreamingFrame(fairWorld, originX, originZ, 2, visibleFair, {
        policy: 'fair',
        now,
        consecutiveGenWithoutMesh: fairStreak,
        dirX: 1,
        instantLight: true,
      });
      const legacy = stepStreamingFrame(legacyWorld, originX, originZ, 2, visibleLegacy, {
        policy: 'legacy-skip-on-gen',
        now,
        consecutiveGenWithoutMesh: legacyStreak,
        dirX: 1,
        instantLight: true,
      });
      fairStreak = fair.consecutiveGenWithoutMesh;
      legacyStreak = legacy.consecutiveGenWithoutMesh;
      fairMeshed += fair.meshed;
      legacyMeshed += legacy.meshed;
    }
    expect(legacyMeshed).toBe(0);
    expect(fairMeshed).toBeGreaterThan(10);
    expect(discardObsoletePendingMesh(fairWorld, 8 + 80, 8, 2)).toBeGreaterThanOrEqual(0);
    expect(pendingMeshInRadius(fairWorld, 8 + 80, 8, 2)).toBe(fairWorld.pendingMesh.size);
  });
});

describe('ready mesh wait warning', () => {
  it('fires above 500 ms and not below', () => {
    expect(shouldWarnReadyMeshWait(499, false)).toBe(false);
    expect(shouldWarnReadyMeshWait(500, false)).toBe(true);
    expect(shouldWarnReadyMeshWait(800, true)).toBe(false);
  });
});
