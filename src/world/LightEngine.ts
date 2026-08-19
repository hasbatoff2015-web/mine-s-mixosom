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

function loadedChunk(world: VoxelWorld, x: number, z: number): Chunk | undefined {
  return world.chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
}

export function getSkyLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  return chunk.skyLight[ChunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function getBlockLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  return chunk.blockLight[ChunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function combinedLight(world: VoxelWorld, x: number, y: number, z: number, daylight = 1): number {
  const sky = getSkyLight(world, x, y, z) * Math.max(0, Math.min(1, daylight));
  const block = getBlockLight(world, x, y, z);
  return Math.max(sky, block);
}

function ChunkIndex(x: number, y: number, z: number): number {
  return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

function setSky(chunk: Chunk, localX: number, y: number, localZ: number, value: number): void {
  chunk.skyLight[ChunkIndex(localX, y, localZ)] = value;
}

function setBlockLightValue(chunk: Chunk, localX: number, y: number, localZ: number, value: number): void {
  chunk.blockLight[ChunkIndex(localX, y, localZ)] = value;
}

export function ensureChunkSky(world: VoxelWorld, chunk: Chunk): void {
  if (chunk.skyReady) return;
  recomputeChunkSky(world, chunk);
}

export function recomputeChunkSky(world: VoxelWorld, chunk: Chunk): void {
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
  return getSkyLight(world, x, y, z);
}

export function relightAround(world: VoxelWorld, x: number, y: number, z: number, radius = 14, recomputeSky = true): void {
  const minX = x - radius;
  const maxX = x + radius;
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(WORLD_HEIGHT - 1, y + radius);
  const minZ = z - radius;
  const maxZ = z + radius;

  if (recomputeSky) {
    const minChunkX = floorDiv(minX, CHUNK_SIZE);
    const maxChunkX = floorDiv(maxX, CHUNK_SIZE);
    const minChunkZ = floorDiv(minZ, CHUNK_SIZE);
    const maxChunkZ = floorDiv(maxZ, CHUNK_SIZE);
    for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
      for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
        const chunk = loadedChunk(world, cx * CHUNK_SIZE, cz * CHUNK_SIZE);
        if (!chunk) continue;
        recomputeChunkSky(world, chunk);
        world.markBlockDirty(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
      }
    }
  }
  propagateBlockLight(world, minX, minY, minZ, maxX, maxY, maxZ);
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
        const emission = getBlockDefinition(chunk.get(x, y, z)).emission ?? 0;
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
        const emission = getBlockDefinition(chunk.get(localX, y, localZ)).emission ?? 0;
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
      chunk.dirty = true;
      queue.push([nx, ny, nz, next]);
    }
  }
}
