import { getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey, floorDiv, positiveMod } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
] as const;

const MAX_PROPAGATION_NODES = 8_192;

export interface LightRegion {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export const lightEngineStats = {
  skyRecomputes: 0,
  blockPropagations: 0,
};

export function resetLightEngineStats(): void {
  lightEngineStats.skyRecomputes = 0;
  lightEngineStats.blockPropagations = 0;
}

function loadedChunk(world: VoxelWorld, x: number, z: number): Chunk | undefined {
  return world.chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
}

export function getSkyLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (!chunk.skyReady) ensureChunkSky(world, chunk);
  return chunk.skyLight[ChunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function getBlockLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (!chunk.blockLightReady) seedChunkBlockLight(world, chunk);
  return chunk.blockLight[ChunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function combinedLight(world: VoxelWorld, x: number, y: number, z: number, daylight = 1): number {
  const sky = getSkyLight(world, x, y, z) * Math.max(0, Math.min(1, daylight));
  const block = getBlockLight(world, x, y, z);
  return Math.max(sky, block);
}

/**
 * Minecraft-style 4-tap smooth lighting for one cube-face corner.
 * Averages the cells that meet at the vertex on the exposed side of the face
 * so cave openings interpolate instead of flipping from full sky to 0 on a grid edge.
 */
export function smoothFaceCornerLight(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
): { sky: number; block: number } {
  const startX = nx !== 0 ? x + nx : x + cx - 1;
  const startY = ny !== 0 ? y + ny : y + cy - 1;
  const startZ = nz !== 0 ? z + nz : z + cz - 1;
  const countX = nx !== 0 ? 1 : 2;
  const countY = ny !== 0 ? 1 : 2;
  const countZ = nz !== 0 ? 1 : 2;
  let sky = 0;
  let block = 0;
  let samples = 0;
  for (let iz = 0; iz < countZ; iz += 1) {
    for (let iy = 0; iy < countY; iy += 1) {
      for (let ix = 0; ix < countX; ix += 1) {
        sky += getSkyLight(world, startX + ix, startY + iy, startZ + iz);
        block += getBlockLight(world, startX + ix, startY + iy, startZ + iz);
        samples += 1;
      }
    }
  }
  const inv = 1 / Math.max(1, samples);
  return { sky: sky * inv, block: block * inv };
}

/** Packed 0–15 sky/block sample. If the cell is unlit, uses the brightest neighbor air. */
export function sampleVoxelLightLevels(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): { sky: number; block: number } {
  let sky = getSkyLight(world, x, y, z);
  let block = getBlockLight(world, x, y, z);
  if (sky > 0 || block > 0) return { sky, block };
  for (const [dx, dy, dz] of NEIGHBOURS) {
    sky = Math.max(sky, getSkyLight(world, x + dx, y + dy, z + dz));
    block = Math.max(block, getBlockLight(world, x + dx, y + dy, z + dz));
  }
  return { sky, block };
}

function ChunkIndex(x: number, y: number, z: number): number {
  return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

function setSky(chunk: Chunk, localX: number, y: number, localZ: number, value: number): boolean {
  const index = ChunkIndex(localX, y, localZ);
  if ((chunk.skyLight[index] ?? 0) === value) return false;
  chunk.skyLight[index] = value;
  return true;
}

function setBlockLightValue(chunk: Chunk, localX: number, y: number, localZ: number, value: number): boolean {
  const index = ChunkIndex(localX, y, localZ);
  if ((chunk.blockLight[index] ?? 0) === value) return false;
  chunk.blockLight[index] = value;
  return true;
}

export function ensureChunkSky(world: VoxelWorld, chunk: Chunk): void {
  if (chunk.skyReady) return;
  recomputeChunkSky(world, chunk);
}

export function recomputeChunkSky(world: VoxelWorld, chunk: Chunk): void {
  lightEngineStats.skyRecomputes += 1;
  chunk.skyReady = true;
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      let sky = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
        const definition = getBlockDefinition(chunk.get(x, y, z));
        if (definition.occludesFaces) {
          setSky(chunk, x, y, z, 0);
          sky = 0;
          continue;
        }
        setSky(chunk, x, y, z, sky);
        if (definition.liquid || definition.renderLayer === 'cutout') {
          sky = Math.max(0, sky - 1);
        }
      }
    }
  }
  spreadSkyHorizontal(world, chunk);
  chunk.skyReady = true;
}

function spreadSkyHorizontal(world: VoxelWorld, chunk: Chunk): void {
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const definition = getBlockDefinition(chunk.get(x, y, z));
          if (definition.occludesFaces) continue;
          const index = ChunkIndex(x, y, z);
          let sky = chunk.skyLight[index] ?? 0;
          for (const [dx, dy, dz] of NEIGHBOURS) {
            const neighbor = sampleSky(world, originX + x + dx, y + dy, originZ + z + dz);
            sky = Math.max(sky, neighbor - 1);
          }
          if (sky > (chunk.skyLight[index] ?? 0)) {
            chunk.skyLight[index] = sky;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

function sampleSky(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  return chunk.skyLight[ChunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function relightAround(world: VoxelWorld, x: number, y: number, z: number, radius = 14, recomputeSky = true): void {
  relightRegion(world, {
    minX: x - radius,
    minY: y - radius,
    minZ: z - radius,
    maxX: x + radius,
    maxY: y + radius,
    maxZ: z + radius,
  }, recomputeSky, true);
}

/**
 * Relights a bounding region. Sky uses column updates + local spread instead of
 * a full 6-pass recompute of every overlapping chunk. Block light still floods
 * the AABB. Light writes do not mark geometry dirty — callers remesh the
 * mutation chunk and emission-affected neighbors explicitly.
 */
export function relightRegion(
  world: VoxelWorld,
  region: LightRegion,
  recomputeSky = true,
  propagateBlock = true,
): void {
  const minX = Math.floor(region.minX);
  const maxX = Math.floor(region.maxX);
  const minY = Math.max(0, Math.floor(region.minY));
  const maxY = Math.min(WORLD_HEIGHT - 1, Math.floor(region.maxY));
  const minZ = Math.floor(region.minZ);
  const maxZ = Math.floor(region.maxZ);

  if (recomputeSky) {
    updateSkyInRegion(world, minX, maxX, minZ, maxZ);
  }
  if (propagateBlock && maxY >= minY) {
    propagateBlockLight(world, minX, minY, minZ, maxX, maxY, maxZ);
    lightEngineStats.blockPropagations += 1;
  }
}

function recomputeSkyColumn(world: VoxelWorld, x: number, z: number): void {
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return;
  const localX = positiveMod(x, CHUNK_SIZE);
  const localZ = positiveMod(z, CHUNK_SIZE);
  let sky = 15;
  for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    const definition = getBlockDefinition(chunk.get(localX, y, localZ));
    if (definition.occludesFaces) {
      setSky(chunk, localX, y, localZ, 0);
      sky = 0;
      continue;
    }
    setSky(chunk, localX, y, localZ, sky);
    if (definition.liquid || definition.renderLayer === 'cutout') {
      sky = Math.max(0, sky - 1);
    }
  }
}

function updateSkyInRegion(world: VoxelWorld, minX: number, maxX: number, minZ: number, maxZ: number): void {
  const touched = new Set<string>();
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const chunk = loadedChunk(world, x, z);
      if (!chunk) continue;
      if (!chunk.skyReady) {
        recomputeChunkSky(world, chunk);
        continue;
      }
      recomputeSkyColumn(world, x, z);
      touched.add(chunkKey(chunk.x, chunk.z));
    }
  }
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const chunk = loadedChunk(world, x, z);
        if (!chunk) continue;
        const localX = positiveMod(x, CHUNK_SIZE);
        const localZ = positiveMod(z, CHUNK_SIZE);
        const originX = chunk.x * CHUNK_SIZE;
        const originZ = chunk.z * CHUNK_SIZE;
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          const definition = getBlockDefinition(chunk.get(localX, y, localZ));
          if (definition.occludesFaces) continue;
          const index = ChunkIndex(localX, y, localZ);
          let sky = chunk.skyLight[index] ?? 0;
          for (const [dx, dy, dz] of NEIGHBOURS) {
            const neighbor = sampleSky(world, originX + localX + dx, y + dy, originZ + localZ + dz);
            sky = Math.max(sky, neighbor - 1);
          }
          if (sky > (chunk.skyLight[index] ?? 0)) {
            chunk.skyLight[index] = sky;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  lightEngineStats.skyRecomputes += touched.size;
}

export function seedChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  chunk.blockLight.fill(0);
  chunk.blockLightReady = true;
  const sources: Array<readonly [number, number, number, number]> = [];
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const emission = world.blockEmissionAt(originX + x, y, originZ + z);
        if (emission <= 0) continue;
        setBlockLightValue(chunk, x, y, z, emission);
        sources.push([originX + x, y, originZ + z, emission]);
      }
    }
  }
  if (sources.length > 0) {
    floodBlockLight(world, sources);
  }
  chunk.blockLightReady = true;
}

export function ensureChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  if (chunk.blockLightReady) return;
  seedChunkBlockLight(world, chunk);
}

function propagateBlockLight(
  world: VoxelWorld,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): void {
  const sources: Array<readonly [number, number, number, number]> = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const chunk = loadedChunk(world, x, z);
        if (!chunk) continue;
        const localX = positiveMod(x, CHUNK_SIZE);
        const localZ = positiveMod(z, CHUNK_SIZE);
        const emission = world.blockEmissionAt(x, y, z);
        setBlockLightValue(chunk, localX, y, localZ, emission);
        if (emission > 0) sources.push([x, y, z, emission]);
      }
    }
  }
  floodBlockLight(world, sources);
}

function floodBlockLight(
  world: VoxelWorld,
  seeds: ReadonlyArray<readonly [number, number, number, number]>,
): void {
  const queue: Array<readonly [number, number, number, number]> = [...seeds];
  let head = 0;
  while (head < queue.length && head < MAX_PROPAGATION_NODES) {
    const [x, y, z, light] = queue[head]!;
    head += 1;
    if (light <= 1) continue;
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const chunk = loadedChunk(world, nx, nz);
      if (!chunk) continue;
      const localX = positiveMod(nx, CHUNK_SIZE);
      const localZ = positiveMod(nz, CHUNK_SIZE);
      const definition = getBlockDefinition(chunk.get(localX, ny, localZ));
      if (definition.occludesFaces && (definition.emission ?? 0) <= 0) continue;
      const next = light - 1;
      const index = ChunkIndex(localX, ny, localZ);
      if (next <= (chunk.blockLight[index] ?? 0)) continue;
      chunk.blockLight[index] = next;
      queue.push([nx, ny, nz, next]);
    }
  }
}
