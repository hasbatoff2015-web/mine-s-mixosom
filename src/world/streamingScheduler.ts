/**
 * Streaming scheduler policy: generate/mesh fairness, lighting flood skip,
 * wanted-set cleanup, and cheap distance/age/ahead priority.
 * Does not change light quality, sky model, or ms budgets.
 */

import { CHUNK_SIZE, TARGET_FRAME_MS, chunkKey, floorDiv } from '../core/constants';
import type { Chunk } from './Chunk';
import { LIGHT_FLOOD_ADD_EMITTER, LIGHT_FLOOD_REGION, lightingFloodOwner } from './LightEngine';
import type { VoxelWorld } from './World';
import { chebyshevChunkDistance, lightContextReady, MESH_LIGHT_NEIGHBORS } from './worldJobs';

/** Nearby unlit work that unlocks a wanted mesh is urgent. */
export const URGENT_LIGHT_CHEBYSHEV = 2;

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

export interface LightJob {
  readonly chunk: Chunk;
  readonly chebyshev: number;
  readonly distanceSq: number;
  readonly unlocksNearWanted: boolean;
  readonly score: number;
}

export interface MeshLightDepStep {
  readonly cx: number;
  readonly cz: number;
  readonly dir?: string;
  readonly state: 'missing' | 'unlit' | 'lit-waiting-context' | 'ready';
}

export interface MeshLightDepChain {
  readonly steps: MeshLightDepStep[];
  readonly cycle: boolean;
  readonly leafReadyToLight: boolean;
  readonly leafMissing: boolean;
}

/** Flood mutex: other unlit chunks wait, but they must not stop the ready owner. */
export function isLightJobBlockedByFlood(floodOwner: string, jobKey: string): boolean {
  return floodOwner !== ''
    && floodOwner !== LIGHT_FLOOD_REGION
    && floodOwner !== LIGHT_FLOOD_ADD_EMITTER
    && floodOwner !== jobKey;
}

/**
 * Sky/block lighting of a generated chunk does not wait for neighbors to be lit.
 * Neighbor lit state is a mesh-context requirement only.
 */
export function lightingComputationRequiresNeighborLight(): boolean {
  return false;
}

export function lightJobSortScore(
  cx: number,
  cz: number,
  originCx: number,
  originCz: number,
  generateRadius: number,
  unlocksNearWanted: boolean,
): number {
  const chebyshev = chebyshevChunkDistance(cx, cz, originCx, originCz);
  const dx = cx - originCx;
  const dz = cz - originCz;
  const distSq = dx * dx + dz * dz;
  const outside = chebyshev > generateRadius ? 1 : 0;
  const unlock = unlocksNearWanted ? 0 : 1;
  const ring = chebyshev === 0 ? 0 : chebyshev === 1 ? 1 : chebyshev <= URGENT_LIGHT_CHEBYSHEV ? 2 : chebyshev <= generateRadius - 1 ? 3 : 4;
  return outside * 10_000_000 + unlock * 1_000_000 + ring * 10_000 + distSq;
}

/**
 * Keys that unlock nearby wanted mesh: all eight unlit/missing neighbors of
 * chebyshev ≤ 2 wanted chunks, plus those near chunks themselves if unlit.
 */
export function lightingUnlockNeighborKeys(
  world: VoxelWorld,
  originCx: number,
  originCz: number,
  meshRadius: number,
  generateRadius: number,
): Set<string> {
  const keys = new Set<string>();
  const near = Math.min(URGENT_LIGHT_CHEBYSHEV, meshRadius);
  for (let dz = -near; dz <= near; dz += 1) {
    for (let dx = -near; dx <= near; dx += 1) {
      const cx = originCx + dx;
      const cz = originCz + dz;
      const key = chunkKey(cx, cz);
      const chunk = world.chunks.get(key);
      if (!chunk) {
        keys.add(key);
        continue;
      }
      if (!chunk.lightingReady) {
        keys.add(key);
        continue;
      }
      if (lightContextReady(world, chunk, originCx, originCz, generateRadius)) continue;
      for (const dir of MESH_LIGHT_NEIGHBORS) {
        const nx = cx + dir.dx;
        const nz = cz + dir.dz;
        if (chebyshevChunkDistance(nx, nz, originCx, originCz) > generateRadius) continue;
        const neighbor = world.chunks.get(chunkKey(nx, nz));
        if (!neighbor?.lightingReady) keys.add(chunkKey(nx, nz));
      }
    }
  }
  return keys;
}

export function collectUnlitLightJobs(
  world: VoxelWorld,
  originX: number,
  originZ: number,
  generateRadius: number,
  unlockKeys?: ReadonlySet<string>,
): LightJob[] {
  const originCx = floorDiv(originX, CHUNK_SIZE);
  const originCz = floorDiv(originZ, CHUNK_SIZE);
  const unlock = unlockKeys ?? lightingUnlockNeighborKeys(world, originCx, originCz, world.meshRadius, generateRadius);
  const floodOwner = lightingFloodOwner(world);
  const jobs: LightJob[] = [];
  for (const chunk of world.chunks.values()) {
    if (chunk.lightingReady) continue;
    const chebyshev = chebyshevChunkDistance(chunk.x, chunk.z, originCx, originCz);
    if (chebyshev > generateRadius) continue;
    const dx = chunk.x - originCx;
    const dz = chunk.z - originCz;
    const unlocksNearWanted = unlock.has(chunkKey(chunk.x, chunk.z));
    jobs.push({
      chunk,
      chebyshev,
      distanceSq: dx * dx + dz * dz,
      unlocksNearWanted,
      score: lightJobSortScore(chunk.x, chunk.z, originCx, originCz, generateRadius, unlocksNearWanted),
    });
  }
  jobs.sort((a, b) => {
    const aOwner = floodOwner !== '' && floodOwner === chunkKey(a.chunk.x, a.chunk.z) ? 0 : 1;
    const bOwner = floodOwner !== '' && floodOwner === chunkKey(b.chunk.x, b.chunk.z) ? 0 : 1;
    if (aOwner !== bOwner) return aOwner - bOwner;
    return a.score - b.score;
  });
  return jobs;
}

/**
 * An in-progress flood on a distant halo chunk must not keep the mutex while
 * a nearby wanted mesh is waiting on an unlit neighbor.
 */
export function shouldPreemptDistantLightingFlood(
  floodOwner: string,
  originCx: number,
  originCz: number,
  unlockKeys: ReadonlySet<string>,
  criticalUnlitCount: number,
): boolean {
  if (criticalUnlitCount <= 0) return false;
  if (floodOwner === '' || floodOwner === LIGHT_FLOOD_REGION || floodOwner === LIGHT_FLOOD_ADD_EMITTER) return false;
  if (unlockKeys.has(floodOwner)) return false;
  const { cx, cz } = parseChunkKey(floodOwner);
  return chebyshevChunkDistance(cx, cz, originCx, originCz) > URGENT_LIGHT_CHEBYSHEV;
}

/** Skip blocked flood waiters; take ready jobs. Never stops at a blocked head. */
export function takeReadyLightJobs<T extends { key: string }>(
  ordered: readonly T[],
  floodOwner: string,
  limit: number,
): { taken: T[]; skippedBlocked: number; attempted: number } {
  const taken: T[] = [];
  let skippedBlocked = 0;
  let attempted = 0;
  for (const job of ordered) {
    if (taken.length >= limit) break;
    attempted += 1;
    if (isLightJobBlockedByFlood(floodOwner, job.key)) {
      skippedBlocked += 1;
      continue;
    }
    taken.push(job);
  }
  return { taken, skippedBlocked, attempted };
}

export function criticalUnlitKeys(
  world: VoxelWorld,
  originCx: number,
  originCz: number,
  meshRadius: number,
  generateRadius: number,
): string[] {
  const unlock = lightingUnlockNeighborKeys(world, originCx, originCz, meshRadius, generateRadius);
  const critical: string[] = [];
  for (const key of unlock) {
    const chunk = world.chunks.get(key);
    if (chunk && !chunk.lightingReady) critical.push(key);
  }
  return critical;
}

/**
 * Mesh-context wait chain. Lighting computation itself is a leaf (no neighbor wait),
 * so a valid graph cannot cycle: unlit/missing nodes have no outgoing edges.
 */
export function walkMeshLightDependencyChain(
  world: VoxelWorld,
  cx: number,
  cz: number,
  originCx: number,
  originCz: number,
  generateRadius: number,
  maxSteps = 8,
): MeshLightDepChain {
  const steps: MeshLightDepStep[] = [];
  const seen = new Set<string>();
  let curX = cx;
  let curZ = cz;
  let dir: string | undefined;
  for (let i = 0; i < maxSteps; i += 1) {
    const key = chunkKey(curX, curZ);
    if (seen.has(key)) {
      steps.push({ cx: curX, cz: curZ, dir, state: 'lit-waiting-context' });
      return { steps, cycle: true, leafReadyToLight: false, leafMissing: false };
    }
    seen.add(key);
    const chunk = world.chunks.get(key);
    if (!chunk) {
      steps.push({ cx: curX, cz: curZ, dir, state: 'missing' });
      return { steps, cycle: false, leafReadyToLight: false, leafMissing: true };
    }
    if (!chunk.lightingReady) {
      steps.push({ cx: curX, cz: curZ, dir, state: 'unlit' });
      return { steps, cycle: false, leafReadyToLight: true, leafMissing: false };
    }
    if (lightContextReady(world, chunk, originCx, originCz, generateRadius)) {
      steps.push({ cx: curX, cz: curZ, dir, state: 'ready' });
      return { steps, cycle: false, leafReadyToLight: false, leafMissing: false };
    }
    steps.push({ cx: curX, cz: curZ, dir, state: 'lit-waiting-context' });
    let next: { cx: number; cz: number; dir: string } | null = null;
    for (const card of MESH_LIGHT_NEIGHBORS) {
      const nx = curX + card.dx;
      const nz = curZ + card.dz;
      if (chebyshevChunkDistance(nx, nz, originCx, originCz) > generateRadius) continue;
      const neighbor = world.chunks.get(chunkKey(nx, nz));
      if (!neighbor?.lightingReady) {
        next = { cx: nx, cz: nz, dir: card.dir };
        break;
      }
    }
    if (!next) {
      return { steps, cycle: false, leafReadyToLight: false, leafMissing: false };
    }
    curX = next.cx;
    curZ = next.cz;
    dir = next.dir;
  }
  return { steps, cycle: false, leafReadyToLight: false, leafMissing: false };
}

export function formatMeshLightDependencyChain(chain: MeshLightDepChain): string[] {
  if (chain.steps.length === 0) return [];
  const lines = chain.steps.map((step, index) => {
    const arrow = index === 0 ? '' : `→ ${step.dir ?? '?'} `;
    return `${arrow}(${step.cx},${step.cz}) ${step.state}`;
  });
  if (chain.cycle) lines.push('CYCLE DETECTED');
  else if (chain.leafReadyToLight) lines.push('leaf READY to light');
  else if (chain.leafMissing) lines.push('leaf MISSING (needs generation)');
  return lines;
}
