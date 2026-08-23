/**
 * CPU-only streaming stepper for scheduler tests and DEV benchmarks.
 * Mirrors PLAYING job policy without GPU/Three.js mesh upload.
 */

import {
  CHUNK_SIZE,
  CREATIVE_FLY_SPEED,
  CREATIVE_SPRINT_FLY_SPEED,
  TARGET_FRAME_MS,
  WALK_SPEED,
  WORLD_JOB_BUDGET_MS,
  WORLD_LIGHT_BUDGET_MS,
  floorDiv,
} from '../core/constants';
import { lightingHaloRadius, missingChunkCoords } from './worldJobs';
import {
  collectReadyMeshJobs,
  completeCpuMesh,
  discardObsoletePendingMesh,
  meshWaitMs,
  pendingMeshInRadius,
  planMeshFrame,
  takeReadyMeshJobs,
  type MeshFramePlan,
} from './streamingScheduler';
import type { VoxelWorld } from './World';

export type MeshFairnessPolicy = 'legacy-skip-on-gen' | 'fair';

export interface StreamingSimFrameResult {
  generated: number;
  meshed: number;
  skipMesh: boolean;
  starvationAvoided: boolean;
  oldestReadyAgeMs: number;
  ready: number;
  urgent: number;
  pendingMesh: number;
  pendingMeshInRadius: number;
  obsoleteMesh: number;
  missingWanted: number;
  playerMissing: boolean;
}

export interface StreamingSimTotals {
  frames: number;
  generated: number;
  meshed: number;
  maxReadyMeshAgeMs: number;
  maxLitToMeshFrames: number;
  maxPlayerMissingFrames: number;
  peakObsoleteMesh: number;
  peakPendingMesh: number;
  peakPendingMeshInRadius: number;
  starvationAvoided: number;
  meshSkippedFrames: number;
  completedVisible: number;
  litToMeshWaitsMs: number[];
  playerChunkMissMs: number;
}

export function obsoletePendingMeshCount(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
): number {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  let count = 0;
  for (const key of world.pendingMesh) {
    const comma = key.indexOf(',');
    const cx = Number(key.slice(0, comma));
    const cz = Number(key.slice(comma + 1));
    const chunk = world.chunks.get(key);
    const wanted = chunk !== undefined
      && Math.max(Math.abs(cx - originCx), Math.abs(cz - originCz)) <= meshRadius;
    if (!wanted) count += 1;
  }
  return count;
}

export function missingWantedCount(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
  visible: ReadonlySet<string>,
): number {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  let missing = 0;
  for (let dz = -meshRadius; dz <= meshRadius; dz += 1) {
    for (let dx = -meshRadius; dx <= meshRadius; dx += 1) {
      const key = `${originCx + dx},${originCz + dz}`;
      if (!visible.has(key)) missing += 1;
    }
  }
  return missing;
}

export function planLegacyMeshFrame(options: {
  readonly loading: boolean;
  readonly generatedThisFrame: boolean;
  readonly readyJobs: readonly { waitMs: number }[];
  readonly defaultMeshLimit: number;
}): MeshFramePlan {
  const ready = options.readyJobs.length;
  const oldestReadyAgeMs = options.readyJobs.reduce((max, job) => Math.max(max, job.waitMs), 0);
  if (options.loading) {
    return {
      skipMesh: false,
      meshLimit: options.defaultMeshLimit,
      starvationAvoided: false,
      ready,
      urgent: 0,
      oldestReadyAgeMs,
    };
  }
  if (options.generatedThisFrame || ready === 0) {
    return {
      skipMesh: true,
      meshLimit: 0,
      starvationAvoided: false,
      ready,
      urgent: 0,
      oldestReadyAgeMs,
    };
  }
  return {
    skipMesh: false,
    meshLimit: options.defaultMeshLimit,
    starvationAvoided: false,
    ready,
    urgent: 0,
    oldestReadyAgeMs,
  };
}

export function stepStreamingFrame(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
  visible: Set<string>,
  options: {
    policy: MeshFairnessPolicy;
    now: number;
    consecutiveGenWithoutMesh: number;
    dirX?: number;
    dirZ?: number;
    generateLimit?: number;
    lightBudgetMs?: number;
    loading?: boolean;
    instantLight?: boolean;
    readySince?: Map<string, number>;
  },
): StreamingSimFrameResult & { consecutiveGenWithoutMesh: number } {
  const generateRadius = lightingHaloRadius(meshRadius);
  world.setViewCenter(originX, originZ, meshRadius);
  const loading = options.loading === true;
  const generateLimit = options.generateLimit ?? (loading ? 8 : 1);
  const missing = missingChunkCoords(world, originX, originZ, generateRadius);
  let generated = 0;
  for (const coord of missing) {
    if (generated >= generateLimit) break;
    world.getChunk(coord.x, coord.z);
    generated += 1;
  }
  if (options.instantLight) {
    for (const chunk of world.chunks.values()) {
      if (!chunk.lightingReady) world.ensureChunkLighting(chunk);
    }
  } else {
    world.processLighting(options.lightBudgetMs ?? WORLD_LIGHT_BUDGET_MS, originX, originZ);
  }
  const readySince = options.readySince;
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  if (readySince) {
    for (const chunk of world.chunks.values()) {
      if (!chunk.lightingReady || (!chunk.dirty && !chunk.lightMeshStale)) continue;
      if (Math.max(Math.abs(chunk.x - originCx), Math.abs(chunk.z - originCz)) > meshRadius) continue;
      const key = `${chunk.x},${chunk.z}`;
      if (!readySince.has(key)) readySince.set(key, options.now);
      chunk.readyToMeshAt = readySince.get(key)!;
    }
  } else {
    for (const chunk of world.chunks.values()) {
      if (chunk.readyToMeshAt > 1e10) chunk.readyToMeshAt = options.now;
    }
  }
  discardObsoletePendingMesh(world, originX, originZ, meshRadius);

  const dirX = options.dirX ?? 0;
  const dirZ = options.dirZ ?? 0;
  const readyJobs = collectReadyMeshJobs(world, originX, originZ, meshRadius, options.now, dirX, dirZ);
  const defaultMeshLimit = loading ? 4 : 2;
  const plan = options.policy === 'legacy-skip-on-gen'
    ? planLegacyMeshFrame({
      loading,
      generatedThisFrame: generated > 0,
      readyJobs,
      defaultMeshLimit,
    })
    : planMeshFrame({
      loading,
      generatedThisFrame: generated > 0,
      consecutiveGenWithoutMesh: options.consecutiveGenWithoutMesh,
      readyJobs,
      defaultMeshLimit,
      frameElapsedMs: 1,
    });

  let meshed = 0;
  let streak = options.consecutiveGenWithoutMesh;
  if (!plan.skipMesh && plan.meshLimit > 0) {
    const { taken } = takeReadyMeshJobs(readyJobs, () => false, plan.meshLimit);
    for (const job of taken) {
      completeCpuMesh(world, job.chunk);
      visible.add(`${job.chunk.x},${job.chunk.z}`);
      options.readySince?.delete(`${job.chunk.x},${job.chunk.z}`);
      meshed += 1;
    }
  }
  if (!loading && generated > 0 && meshed === 0) streak += 1;
  else streak = 0;

  const playerKey = `${originCx},${originCz}`;
  return {
    generated,
    meshed,
    skipMesh: plan.skipMesh,
    starvationAvoided: plan.starvationAvoided,
    oldestReadyAgeMs: plan.oldestReadyAgeMs,
    ready: plan.ready,
    urgent: plan.urgent,
    pendingMesh: world.pendingMesh.size,
    pendingMeshInRadius: pendingMeshInRadius(world, originX, originZ, meshRadius),
    obsoleteMesh: obsoletePendingMeshCount(world, originX, originZ, meshRadius),
    missingWanted: missingWantedCount(world, originX, originZ, meshRadius, visible),
    playerMissing: !visible.has(playerKey),
    consecutiveGenWithoutMesh: streak,
  };
}

export function runStreamingPath(
  world: VoxelWorld,
  options: {
    policy: MeshFairnessPolicy;
    meshRadius: number;
    speedBlocksPerSec: number;
    path: Array<{ x: number; z: number }>;
    frameMs?: number;
    lightBudgetMs?: number;
    pruneEveryFrames?: number;
    warmupFrames?: number;
    instantLight?: boolean;
  },
): StreamingSimTotals {
  const frameMs = options.frameMs ?? TARGET_FRAME_MS;
  const meshRadius = options.meshRadius;
  const visible = new Set<string>();
  const litAtFrame = new Map<string, number>();
  const recordedLitToMesh = new Set<string>();
  const readySince = new Map<string, number>();
  const litToMeshWaitsMs: number[] = [];
  let consecutiveGenWithoutMesh = 0;
  let now = 1;
  let generated = 0;
  let meshed = 0;
  let maxReadyMeshAgeMs = 0;
  let maxLitToMeshFrames = 0;
  let playerMissingFrames = 0;
  let maxPlayerMissingFrames = 0;
  let peakObsoleteMesh = 0;
  let peakPendingMesh = 0;
  let peakPendingMeshInRadius = 0;
  let starvationAvoided = 0;
  let meshSkippedFrames = 0;
  let originX = options.path[0]?.x ?? 0;
  let originZ = options.path[0]?.z ?? 0;
  let frames = 0;

  const warmup = options.warmupFrames ?? 24;
  for (let i = 0; i < warmup; i += 1) {
    now += frameMs;
    const step = stepStreamingFrame(world, originX, originZ, meshRadius, visible, {
      policy: options.policy,
      now,
      consecutiveGenWithoutMesh,
      lightBudgetMs: options.lightBudgetMs,
      loading: true,
      generateLimit: 8,
      instantLight: options.instantLight,
      readySince,
    });
    consecutiveGenWithoutMesh = 0;
    generated += step.generated;
    meshed += step.meshed;
    frames += 1;
  }

  const speed = options.speedBlocksPerSec;
  for (let index = 0; index < options.path.length - 1; index += 1) {
    const from = options.path[index]!;
    const to = options.path[index + 1]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.01, speed * (frameMs / 1000))));
    for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
      const t = stepIndex / steps;
      originX = from.x + dx * t;
      originZ = from.z + dz * t;
      now += frameMs;
      const dirX = dx;
      const dirZ = dz;
      const step = stepStreamingFrame(world, originX, originZ, meshRadius, visible, {
        policy: options.policy,
        now,
        consecutiveGenWithoutMesh,
        dirX,
        dirZ,
        lightBudgetMs: options.lightBudgetMs,
        instantLight: options.instantLight,
        readySince,
      });
      consecutiveGenWithoutMesh = step.consecutiveGenWithoutMesh;
      generated += step.generated;
      meshed += step.meshed;
      frames += 1;
      maxReadyMeshAgeMs = Math.max(maxReadyMeshAgeMs, step.oldestReadyAgeMs);
      peakObsoleteMesh = Math.max(peakObsoleteMesh, step.obsoleteMesh);
      peakPendingMesh = Math.max(peakPendingMesh, step.pendingMesh);
      peakPendingMeshInRadius = Math.max(peakPendingMeshInRadius, step.pendingMeshInRadius);
      if (step.starvationAvoided) starvationAvoided += 1;
      if (step.skipMesh && step.ready > 0) meshSkippedFrames += 1;
      if (step.playerMissing) {
        playerMissingFrames += 1;
        maxPlayerMissingFrames = Math.max(maxPlayerMissingFrames, playerMissingFrames);
      } else playerMissingFrames = 0;

      for (const chunk of world.chunks.values()) {
        const key = `${chunk.x},${chunk.z}`;
        const inMesh = Math.max(
          Math.abs(chunk.x - floorDiv(originX, CHUNK_SIZE)),
          Math.abs(chunk.z - floorDiv(originZ, CHUNK_SIZE)),
        ) <= meshRadius;
        if (chunk.lightingReady && inMesh && !litAtFrame.has(key)) litAtFrame.set(key, frames);
        if (visible.has(key) && !recordedLitToMesh.has(key) && litAtFrame.has(key)) {
          const waitFrames = frames - (litAtFrame.get(key) ?? frames);
          litToMeshWaitsMs.push(Math.max(0, waitFrames) * frameMs);
          maxLitToMeshFrames = Math.max(maxLitToMeshFrames, Math.max(0, waitFrames));
          recordedLitToMesh.add(key);
        }
      }

      if (options.pruneEveryFrames && frames % options.pruneEveryFrames === 0) {
        world.pruneChunks(originX, originZ, meshRadius);
        for (const key of [...visible]) {
          if (!world.chunks.has(key)) visible.delete(key);
        }
      }
    }
  }

  return {
    frames,
    generated,
    meshed,
    maxReadyMeshAgeMs,
    maxLitToMeshFrames,
    maxPlayerMissingFrames,
    peakObsoleteMesh,
    peakPendingMesh,
    peakPendingMeshInRadius,
    starvationAvoided,
    meshSkippedFrames,
    completedVisible: recordedLitToMesh.size,
    litToMeshWaitsMs,
    playerChunkMissMs: maxPlayerMissingFrames * frameMs,
  };
}

export function eastThenWestPath(chunksEast: number, chunksWest: number): Array<{ x: number; z: number }> {
  return [
    { x: 8, z: 8 },
    { x: 8 + chunksEast * CHUNK_SIZE, z: 8 },
    { x: 8 + (chunksEast - chunksWest) * CHUNK_SIZE, z: 8 },
  ];
}

export function zigzagPath(legs: number, chunkSpan: number): Array<{ x: number; z: number }> {
  const path: Array<{ x: number; z: number }> = [{ x: 8, z: 8 }];
  for (let i = 0; i < legs; i += 1) {
    const sign = i % 2 === 0 ? 1 : -1;
    path.push({
      x: 8 + chunkSpan * CHUNK_SIZE,
      z: 8 + sign * ((i + 1) % 3) * CHUNK_SIZE,
    });
  }
  return path;
}

export const STREAMING_SPEEDS = {
  walk: WALK_SPEED,
  fly: CREATIVE_FLY_SPEED,
  flySprint: CREATIVE_SPRINT_FLY_SPEED,
};

export const STREAMING_BUDGETS = {
  jobMs: WORLD_JOB_BUDGET_MS,
  lightMs: WORLD_LIGHT_BUDGET_MS,
};

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export function meshWaitHistogram(world: VoxelWorld, originX: number, originZ: number, meshRadius: number, now: number): number[] {
  return collectReadyMeshJobs(world, originX, originZ, meshRadius, now).map((job) => meshWaitMs(job.chunk, now));
}
