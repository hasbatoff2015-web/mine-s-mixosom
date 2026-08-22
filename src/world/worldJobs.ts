import { CHUNK_SIZE, chunkKey, clamp, floorDiv, TARGET_FRAME_MS, WORLD_JOB_BUDGET_MS } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

export interface ChunkJobRef {
  readonly chunk: Chunk;
  readonly distanceSq: number;
}

export function adaptiveJobBudgetMs(
  alreadyConsumedMs: number,
  targetFrameMs = TARGET_FRAME_MS,
  maxBudgetMs = WORLD_JOB_BUDGET_MS,
  minBudgetMs = 0.35,
): number {
  const headroom = targetFrameMs - alreadyConsumedMs - 2;
  if (headroom <= 0) return 0;
  return clamp(Math.min(maxBudgetMs, headroom), 0, maxBudgetMs) || (headroom > minBudgetMs ? minBudgetMs : 0);
}

export function neighborMeshOffsets(localX: number, localZ: number): Array<readonly [number, number]> {
  const offsets: Array<readonly [number, number]> = [];
  if (localX === 0) offsets.push([-1, 0]);
  if (localX === CHUNK_SIZE - 1) offsets.push([1, 0]);
  if (localZ === 0) offsets.push([0, -1]);
  if (localZ === CHUNK_SIZE - 1) offsets.push([0, 1]);
  return offsets;
}

export function sortedLoadedChunksByDistance(
  world: VoxelWorld,
  blockX: number,
  blockZ: number,
  predicate: (chunk: Chunk) => boolean,
): ChunkJobRef[] {
  const centerX = floorDiv(blockX, CHUNK_SIZE);
  const centerZ = floorDiv(blockZ, CHUNK_SIZE);
  const jobs: ChunkJobRef[] = [];
  for (const chunk of world.chunks.values()) {
    if (!predicate(chunk)) continue;
    const dx = chunk.x - centerX;
    const dz = chunk.z - centerZ;
    jobs.push({ chunk, distanceSq: dx * dx + dz * dz });
  }
  jobs.sort((a, b) => a.distanceSq - b.distanceSq);
  return jobs;
}

export function missingChunkCoords(
  world: VoxelWorld,
  blockX: number,
  blockZ: number,
  radius: number,
): Array<{ x: number; z: number; distanceSq: number }> {
  const centerX = floorDiv(blockX, CHUNK_SIZE);
  const centerZ = floorDiv(blockZ, CHUNK_SIZE);
  const missing: Array<{ x: number; z: number; distanceSq: number }> = [];
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx;
      const z = centerZ + dz;
      if (world.chunks.has(chunkKey(x, z))) continue;
      missing.push({ x, z, distanceSq: dx * dx + dz * dz });
    }
  }
  missing.sort((a, b) => a.distanceSq - b.distanceSq);
  return missing;
}

export function initialAreaReady(
  world: VoxelWorld,
  hasMesh: (key: string) => boolean,
  blockX: number,
  blockZ: number,
  radius: number,
): boolean {
  const progress = countInitialAreaProgress(world, hasMesh, blockX, blockZ, radius);
  return progress.generated === progress.total
    && progress.lit === progress.total
    && progress.meshed === progress.total;
}

export function countInitialAreaProgress(
  world: VoxelWorld,
  hasMesh: (key: string) => boolean,
  blockX: number,
  blockZ: number,
  radius: number,
): { generated: number; lit: number; meshed: number; total: number } {
  const centerX = floorDiv(blockX, CHUNK_SIZE);
  const centerZ = floorDiv(blockZ, CHUNK_SIZE);
  const span = Math.max(0, Math.floor(radius)) * 2 + 1;
  let generated = 0;
  let lit = 0;
  let meshed = 0;
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const key = chunkKey(centerX + dx, centerZ + dz);
      const chunk = world.chunks.get(key);
      if (!chunk) continue;
      generated += 1;
      if (chunk.skyReady && chunk.blockLightReady) lit += 1;
      if (hasMesh(key) && !chunk.dirty) meshed += 1;
    }
  }
  return { generated, lit, meshed, total: span * span };
}
