/**
 * Streaming scheduler policy: fairness between generate and mesh,
 * wanted-set cleanup, and cheap distance/age/ahead priority.
 * Does not change lighting, budgets, or mesh algorithm.
 */

import { CHUNK_SIZE, TARGET_FRAME_MS, chunkKey, floorDiv } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';
import { chebyshevChunkDistance, lightContextReady } from './worldJobs';

/** Nearby ready mesh waiting this long is treated as urgent. */
export const URGENT_MESH_WAIT_MS = 150;
/** Chebyshev ring that is always urgent while ready. */
export const URGENT_MESH_CHEBYSHEV = 2;
/** At most this many consecutive PLAYING generate frames may skip every mesh job. */
export const MAX_GEN_FRAMES_WITHOUT_MESH = 1;

export interface ReadyMeshJob {
  readonly chunk: Chunk;
  readonly chebyshev: number;
  readonly waitMs: number;
  readonly urgent: boolean;
}

export interface MeshFramePlan {
  readonly skipMesh: boolean;
  readonly meshLimit: number;
  readonly starvationAvoided: boolean;
  readonly ready: number;
  readonly urgent: number;
  readonly oldestReadyAgeMs: number;
}

export function parseChunkKey(key: string): { cx: number; cz: number } {
  const comma = key.indexOf(',');
  return { cx: Number(key.slice(0, comma)), cz: Number(key.slice(comma + 1)) };
}

export function isUrgentReadyMesh(chebyshev: number, waitMs: number): boolean {
  return chebyshev <= URGENT_MESH_CHEBYSHEV || waitMs >= URGENT_MESH_WAIT_MS;
}

export function meshWaitMs(chunk: Chunk, now: number): number {
  if (!chunk.readyToMeshAt) return 0;
  return Math.max(0, now - chunk.readyToMeshAt);
}

/**
 * Lower score is scheduled first: player ring, then age, then movement-ahead, then distanceSq.
 * Recomputed from the current player chunk — not insert-order.
 */
export function meshJobSortScore(
  cx: number,
  cz: number,
  originCx: number,
  originCz: number,
  dirX: number,
  dirZ: number,
  waitMs: number,
): number {
  const dx = cx - originCx;
  const dz = cz - originCz;
  const chebyshev = Math.max(Math.abs(dx), Math.abs(dz));
  const distSq = dx * dx + dz * dz;
  const ring = chebyshev === 0 ? 0 : chebyshev === 1 ? 1 : chebyshev <= 2 ? 2 : 3;
  const length = Math.hypot(dirX, dirZ);
  const ndx = length > 1e-6 ? dirX / length : 0;
  const ndz = length > 1e-6 ? dirZ / length : 0;
  const ahead = length > 1e-6 && dx * ndx + dz * ndz > 0.15 ? 0 : 1;
  const aged = waitMs >= URGENT_MESH_WAIT_MS ? 0 : 1;
  return ring * 1_000_000 + aged * 100_000 + ahead * 10_000 + distSq;
}

export function canAffordUrgentMesh(
  frameElapsedMs: number,
  chebyshev: number,
  waitMs: number,
  targetFrameMs = TARGET_FRAME_MS,
): boolean {
  if (chebyshev <= 1 || waitMs >= URGENT_MESH_WAIT_MS) return true;
  return frameElapsedMs < targetFrameMs - 6;
}

export function planMeshFrame(options: {
  readonly loading: boolean;
  readonly generatedThisFrame: boolean;
  readonly consecutiveGenWithoutMesh: number;
  readonly readyJobs: readonly ReadyMeshJob[];
  readonly defaultMeshLimit: number;
  readonly frameElapsedMs: number;
}): MeshFramePlan {
  const ready = options.readyJobs.length;
  const urgentJobs = options.readyJobs.filter((job) => job.urgent);
  const urgent = urgentJobs.length;
  const oldestReadyAgeMs = options.readyJobs.reduce((max, job) => Math.max(max, job.waitMs), 0);
  if (options.loading) {
    return {
      skipMesh: false,
      meshLimit: options.defaultMeshLimit,
      starvationAvoided: false,
      ready,
      urgent,
      oldestReadyAgeMs,
    };
  }
  if (ready === 0) {
    return {
      skipMesh: true,
      meshLimit: 0,
      starvationAvoided: false,
      ready,
      urgent,
      oldestReadyAgeMs,
    };
  }
  if (!options.generatedThisFrame) {
    return {
      skipMesh: false,
      meshLimit: options.defaultMeshLimit,
      starvationAvoided: false,
      ready,
      urgent,
      oldestReadyAgeMs,
    };
  }
  const nearest = options.readyJobs[0];
  const afford = nearest
    ? canAffordUrgentMesh(options.frameElapsedMs, nearest.chebyshev, nearest.waitMs)
    : false;
  const forceFairness = options.consecutiveGenWithoutMesh >= MAX_GEN_FRAMES_WITHOUT_MESH;
  const runUrgent = urgent > 0 && afford;
  if (runUrgent || forceFairness) {
    return {
      skipMesh: false,
      meshLimit: 1,
      starvationAvoided: true,
      ready,
      urgent,
      oldestReadyAgeMs,
    };
  }
  return {
    skipMesh: true,
    meshLimit: 0,
    starvationAvoided: false,
    ready,
    urgent,
    oldestReadyAgeMs,
  };
}

export function collectReadyMeshJobs(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
  now = performance.now(),
  dirX = 0,
  dirZ = 0,
): ReadyMeshJob[] {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  const jobs: ReadyMeshJob[] = [];
  for (const chunk of world.chunks.values()) {
    if (!chunk.dirty && !chunk.lightMeshStale) continue;
    const chebyshev = chebyshevChunkDistance(chunk.x, chunk.z, originCx, originCz);
    if (chebyshev > meshRadius) continue;
    if (!chunk.lightingReady) continue;
    if (!lightContextReady(world, chunk, originCx, originCz, world.generationRadius)) continue;
    const waitMs = meshWaitMs(chunk, now);
    jobs.push({
      chunk,
      chebyshev,
      waitMs,
      urgent: isUrgentReadyMesh(chebyshev, waitMs),
    });
  }
  jobs.sort((a, b) => {
    const sa = meshJobSortScore(a.chunk.x, a.chunk.z, originCx, originCz, dirX, dirZ, a.waitMs);
    const sb = meshJobSortScore(b.chunk.x, b.chunk.z, originCx, originCz, dirX, dirZ, b.waitMs);
    return sa - sb;
  });
  return jobs;
}

/**
 * Skip blocked heads and keep scanning. A blocked job must not freeze the lane.
 */
export function takeReadyMeshJobs<T>(
  ordered: readonly T[],
  isBlocked: (job: T) => boolean,
  limit: number,
): { taken: T[]; skippedBlocked: number; attempted: number } {
  const taken: T[] = [];
  let skippedBlocked = 0;
  let attempted = 0;
  for (const job of ordered) {
    if (taken.length >= limit) break;
    attempted += 1;
    if (isBlocked(job)) {
      skippedBlocked += 1;
      continue;
    }
    taken.push(job);
  }
  return { taken, skippedBlocked, attempted };
}

/** CPU/test stand-in for WorldRenderer.rebuild: keeps generated data, clears mesh work. */
export function completeCpuMesh(world: VoxelWorld, chunk: Chunk): void {
  chunk.dirty = false;
  chunk.meshedLightVersion = chunk.lightVersion;
  world.acknowledgeMeshed(chunk);
}

/**
 * Drop pending mesh bookkeeping that is no longer in the wanted visible set.
 * Keeps generated chunk data and `dirty` so a later re-entry still remeshes.
 */
export function discardObsoletePendingMesh(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
): number {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  let removed = 0;
  for (const key of [...world.pendingMesh]) {
    const { cx, cz } = parseChunkKey(key);
    const chunk = world.chunks.get(key);
    const wanted = chunk !== undefined && chebyshevChunkDistance(cx, cz, originCx, originCz) <= meshRadius;
    if (wanted) continue;
    world.pendingMesh.delete(key);
    removed += 1;
  }
  for (const chunk of world.chunks.values()) {
    const inRadius = chebyshevChunkDistance(chunk.x, chunk.z, originCx, originCz) <= meshRadius;
    if (!inRadius) continue;
    if (chunk.dirty || chunk.lightMeshStale) {
      world.pendingMesh.add(chunkKey(chunk.x, chunk.z));
    }
  }
  return removed;
}

export function pendingMeshInRadius(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  meshRadius: number,
): number {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  let count = 0;
  for (const key of world.pendingMesh) {
    const { cx, cz } = parseChunkKey(key);
    if (chebyshevChunkDistance(cx, cz, originCx, originCz) <= meshRadius && world.chunks.has(key)) count += 1;
  }
  return count;
}
