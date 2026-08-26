import { CHUNK_SIZE, LIGHTING_HALO_CHUNKS, chunkKey, clamp, floorDiv, TARGET_FRAME_MS, WORLD_JOB_BUDGET_MS } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

export interface ChunkJobRef {
  readonly chunk: Chunk;
  readonly distanceSq: number;
}

export interface InitialAreaProgress {
  readonly generated: number;
  readonly lit: number;
  readonly meshed: number;
  readonly generateTotal: number;
  readonly litTotal: number;
  readonly meshTotal: number;
  readonly total: number;
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

/** Fluid corners are shared with the diagonal neighbor at chunk corners. */
export function neighborFluidMeshOffsets(localX: number, localZ: number): Array<readonly [number, number]> {
  const offsets = neighborMeshOffsets(localX, localZ);
  if (localX === 0 && localZ === 0) offsets.push([-1, -1]);
  if (localX === 0 && localZ === CHUNK_SIZE - 1) offsets.push([-1, 1]);
  if (localX === CHUNK_SIZE - 1 && localZ === 0) offsets.push([1, -1]);
  if (localX === CHUNK_SIZE - 1 && localZ === CHUNK_SIZE - 1) offsets.push([1, 1]);
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
  unlockKeys?: ReadonlySet<string>,
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
  missing.sort((a, b) => {
    const ua = unlockKeys?.has(chunkKey(a.x, a.z)) ? 0 : 1;
    const ub = unlockKeys?.has(chunkKey(b.x, b.z)) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return a.distanceSq - b.distanceSq;
  });
  return missing;
}

export function lightingHaloRadius(meshRadius: number): number {
  return Math.max(0, Math.floor(meshRadius)) + LIGHTING_HALO_CHUNKS;
}

export function chebyshevChunkDistance(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

/** Neighbors inside the generation halo must exist and be lit before a chunk may mesh. */
export function lightContextReady(
  world: VoxelWorld,
  chunk: Chunk,
  centerChunkX: number,
  centerChunkZ: number,
  generationRadius: number,
): boolean {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const [dx, dz] of dirs) {
    const neighborX = chunk.x + dx;
    const neighborZ = chunk.z + dz;
    if (chebyshevChunkDistance(neighborX, neighborZ, centerChunkX, centerChunkZ) > generationRadius) continue;
    const neighbor = world.chunks.get(chunkKey(neighborX, neighborZ));
    if (!neighbor?.lightingReady) return false;
  }
  return true;
}

export function chunkVisuallyLit(chunk: Chunk, hasMesh: boolean): boolean {
  if (!hasMesh || chunk.dirty || !chunk.lightingReady) return false;
  if (chunk.meshedLightVersion < 0) return true;
  return chunk.meshedLightVersion === chunk.lightVersion;
}

export function initialAreaReady(
  world: VoxelWorld,
  hasMesh: (key: string) => boolean,
  blockX: number,
  blockZ: number,
  meshRadius: number,
  generateRadius = meshRadius,
): boolean {
  const progress = countInitialAreaProgress(world, hasMesh, blockX, blockZ, meshRadius, generateRadius);
  return progress.generated === progress.generateTotal
    && progress.lit === progress.litTotal
    && progress.meshed === progress.meshTotal;
}

export function countInitialAreaProgress(
  world: VoxelWorld,
  hasMesh: (key: string) => boolean,
  blockX: number,
  blockZ: number,
  meshRadius: number,
  generateRadius = meshRadius,
): InitialAreaProgress {
  const centerX = floorDiv(blockX, CHUNK_SIZE);
  const centerZ = floorDiv(blockZ, CHUNK_SIZE);
  const genR = Math.max(0, Math.floor(generateRadius));
  const meshR = Math.max(0, Math.floor(meshRadius));
  const generateTotal = (genR * 2 + 1) * (genR * 2 + 1);
  const meshTotal = (meshR * 2 + 1) * (meshR * 2 + 1);
  let generated = 0;
  let lit = 0;
  let meshed = 0;
  for (let dz = -genR; dz <= genR; dz += 1) {
    for (let dx = -genR; dx <= genR; dx += 1) {
      const key = chunkKey(centerX + dx, centerZ + dz);
      const chunk = world.chunks.get(key);
      if (!chunk) continue;
      generated += 1;
      if (chunk.lightingReady) lit += 1;
      if (chebyshevChunkDistance(chunk.x, chunk.z, centerX, centerZ) <= meshR && chunkVisuallyLit(chunk, hasMesh(key))) {
        meshed += 1;
      }
    }
  }
  return {
    generated,
    lit,
    meshed,
    generateTotal,
    litTotal: generateTotal,
    meshTotal,
    total: generateTotal,
  };
}
