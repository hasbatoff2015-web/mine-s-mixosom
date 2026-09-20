import { BlockId } from '../blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../core/constants';
import type { Chunk } from './Chunk';
import type { Biome, ColumnInfo, TerrainGenerator } from './Generator';
import { hashCoords, random01 } from './noise';

export const PUMPKIN_DECORATION_SALT = 81427;
export const MELON_DECORATION_SALT = 91541;
export const GOURD_PATCH_CELL = 32;
const PATCH_REACH = 6;
const WATER_SAMPLE_RADIUS = 10;
const WATER_SAMPLE_STEP = 4;

export type GourdKind = 'pumpkin' | 'melon';

export interface GourdPatch {
  readonly kind: GourdKind;
  readonly cx: number;
  readonly cz: number;
  readonly count: number;
  readonly seeds: readonly number[];
}

const SOIL = new Set<BlockId>([BlockId.GrassBlock, BlockId.Dirt]);

function cellCoord(value: number): number {
  return Math.floor(value / GOURD_PATCH_CELL);
}

function humidPlains(column: ColumnInfo): boolean {
  return column.biome === 'plains' && column.climate < 0.02;
}

function nearDeterministicWater(generator: TerrainGenerator, x: number, z: number): boolean {
  for (let dz = -WATER_SAMPLE_RADIUS; dz <= WATER_SAMPLE_RADIUS; dz += WATER_SAMPLE_STEP) {
    for (let dx = -WATER_SAMPLE_RADIUS; dx <= WATER_SAMPLE_RADIUS; dx += WATER_SAMPLE_STEP) {
      const column = generator.columnAt(x + dx, z + dz);
      if (column.waterBiome !== 'none' || column.height < SEA_LEVEL) return true;
    }
  }
  return false;
}

function pumpkinChance(biome: Biome): number {
  if (biome === 'plains') return 0.52;
  if (biome === 'forest') return 0.16;
  return 0;
}

function melonChance(column: ColumnInfo, nearWater: boolean): number {
  if (column.biome === 'desert' || column.biome === 'snowy_plains') return 0;
  if (column.height <= SEA_LEVEL || column.waterBiome !== 'none') return 0;
  let chance = 0;
  if (column.biome === 'forest') chance = 0.34;
  else if (humidPlains(column)) chance = 0.20;
  else if (column.biome === 'plains' && nearWater) chance = 0.14;
  if (chance > 0 && nearWater) chance += 0.10;
  return chance;
}

function fruitCount(roll: number): number {
  if (roll < 0.08) return 4;
  if (roll < 0.42) return 1;
  if (roll < 0.82) return 2;
  return 3;
}

export function planGourdPatch(
  generator: TerrainGenerator,
  salt: number,
  kind: GourdKind,
  cellX: number,
  cellZ: number,
): GourdPatch | undefined {
  const spawnRoll = random01(generator.numericSeed + salt, cellX, 1, cellZ);
  const jitterX = random01(generator.numericSeed + salt, cellX, 2, cellZ);
  const jitterZ = random01(generator.numericSeed + salt, cellX, 3, cellZ);
  const countRoll = random01(generator.numericSeed + salt, cellX, 4, cellZ);
  const cx = cellX * GOURD_PATCH_CELL + 2 + Math.floor(jitterX * (GOURD_PATCH_CELL - 4));
  const cz = cellZ * GOURD_PATCH_CELL + 2 + Math.floor(jitterZ * (GOURD_PATCH_CELL - 4));
  const column = generator.columnAt(cx, cz);
  if (column.height <= SEA_LEVEL || column.waterBiome !== 'none') return undefined;
  const chance = kind === 'pumpkin'
    ? pumpkinChance(column.biome)
    : melonChance(column, nearDeterministicWater(generator, cx, cz));
  if (chance <= 0 || spawnRoll >= chance) return undefined;
  const count = fruitCount(countRoll);
  const seeds: number[] = [];
  for (let i = 0; i < count; i += 1) {
    seeds.push(hashCoords(generator.numericSeed + salt, cellX, 20 + i, cellZ));
  }
  return { kind, cx, cz, count, seeds };
}

function fruitOffsets(seed: number, index: number): { dx: number; dz: number } {
  const angle = random01(seed, index, 8, 1) * Math.PI * 2;
  const radius = random01(seed, index, 9, 2) * 3.1;
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dz: Math.round(Math.sin(angle) * radius),
  };
}

function canPlaceFruit(chunk: Chunk, generator: TerrainGenerator, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) return false;
  const worldX = chunk.x * CHUNK_SIZE + x;
  const worldZ = chunk.z * CHUNK_SIZE + z;
  const column = generator.columnAt(worldX, worldZ);
  if (column.height <= SEA_LEVEL || column.waterBiome !== 'none') return false;
  if (column.biome === 'desert' || column.biome === 'snowy_plains') return false;
  const surface = chunk.get(x, column.height, z) as BlockId;
  if (!SOIL.has(surface)) return false;
  const above = chunk.get(x, column.height + 1, z) as BlockId;
  if (above !== BlockId.Air) return false;
  return true;
}

function placePatch(chunk: Chunk, generator: TerrainGenerator, patch: GourdPatch): void {
  const block = patch.kind === 'pumpkin' ? BlockId.Pumpkin : BlockId.Melon;
  const worldX = chunk.x * CHUNK_SIZE;
  const worldZ = chunk.z * CHUNK_SIZE;
  const occupied = new Set<string>();
  for (let i = 0; i < patch.count; i += 1) {
    const offset = fruitOffsets(patch.seeds[i] ?? 0, i);
    const fx = patch.cx + offset.dx;
    const fz = patch.cz + offset.dz;
    if (fx < worldX || fz < worldZ || fx >= worldX + CHUNK_SIZE || fz >= worldZ + CHUNK_SIZE) continue;
    const lx = fx - worldX;
    const lz = fz - worldZ;
    const key = `${lx},${lz}`;
    if (occupied.has(key)) continue;
    if (!canPlaceFruit(chunk, generator, lx, lz)) continue;
    const height = generator.columnAt(fx, fz).height;
    chunk.set(lx, height + 1, lz, block);
    occupied.add(key);
  }
}

/**
 * World-space pumpkin/melon patches. Separate salts from tree/plant/cane RNG.
 */
export function decorateWildGourds(chunk: Chunk, generator: TerrainGenerator): void {
  const worldX = chunk.x * CHUNK_SIZE;
  const worldZ = chunk.z * CHUNK_SIZE;
  const minCellX = cellCoord(worldX - PATCH_REACH);
  const maxCellX = cellCoord(worldX + CHUNK_SIZE - 1 + PATCH_REACH);
  const minCellZ = cellCoord(worldZ - PATCH_REACH);
  const maxCellZ = cellCoord(worldZ + CHUNK_SIZE - 1 + PATCH_REACH);
  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const pumpkin = planGourdPatch(generator, PUMPKIN_DECORATION_SALT, 'pumpkin', cellX, cellZ);
      if (pumpkin) placePatch(chunk, generator, pumpkin);
      const melon = planGourdPatch(generator, MELON_DECORATION_SALT, 'melon', cellX, cellZ);
      if (melon) placePatch(chunk, generator, melon);
    }
  }
}
