import { BlockId } from '../blocks';
import { CHUNK_SIZE, SEA_LEVEL, TERRAIN_HEADROOM, WORLD_HEIGHT } from '../core/constants';
import { Chunk } from './Chunk';
import { fbm2D, hashCoords, mulberry32, random01, smoothstep, valueNoise3D } from './noise';

export type Biome = 'plains' | 'forest' | 'desert';

export interface OreRule {
  readonly block: BlockId;
  readonly minY: number;
  readonly maxY: number;
  readonly veins: number;
  readonly size: number;
}

/**
 * Ordinary cave carving stops this many blocks below the local (3×3 min) terrain roof.
 * Intentional 1×1 surface mouths are disabled; underground networks stay intact.
 */
export const CAVE_ROOF_DEPTH = 4;

/**
 * Absolute Y bands after the +15 stack shift. Relative shape matches the old
 * compact-world layout (diamond/redstone near bedrock, coal higher).
 */
export const ORE_RULES: readonly OreRule[] = [
  { block: BlockId.CoalOre, minY: 28, maxY: 61, veins: 12, size: 7 },
  { block: BlockId.IronOre, minY: 8, maxY: 52, veins: 11, size: 6 },
  { block: BlockId.GoldOre, minY: 4, maxY: 32, veins: 4, size: 5 },
  { block: BlockId.RedstoneOre, minY: 3, maxY: 18, veins: 5, size: 5 },
  { block: BlockId.DiamondOre, minY: 3, maxY: 16, veins: 2, size: 4 },
];

export interface ColumnInfo {
  biome: Biome;
  height: number;
  base: number;
  hills: number;
  mountain: number;
}

export interface SpawnColumn {
  readonly x: number;
  readonly z: number;
  readonly biome: Biome;
  readonly height: number;
  readonly mountain: number;
}

/** Lower is better: plains, low mountains, closer to origin. */
export function spawnColumnScore(column: SpawnColumn, originX = 0, originZ = 0): number {
  const biomePenalty = column.biome === 'plains' ? 0 : column.biome === 'forest' ? 18 : 80;
  return biomePenalty + column.mountain * 3.2 + Math.hypot(column.x - originX, column.z - originZ) * 0.04;
}

/**
 * Rank nearby grass columns for a new-world spawn. Uses only column noise,
 * so it does not generate chunks during menu/create.
 */
export function collectSpawnColumns(
  generator: TerrainGenerator,
  originX = 0,
  originZ = 0,
  radius = 192,
  step = 8,
): SpawnColumn[] {
  const columns: SpawnColumn[] = [];
  for (let z = originZ - radius; z <= originZ + radius; z += step) {
    for (let x = originX - radius; x <= originX + radius; x += step) {
      if (!generator.isSafeSpawnColumn(x, z)) continue;
      const column = generator.columnAt(x, z);
      columns.push({
        x,
        z,
        biome: column.biome,
        height: column.height,
        mountain: column.mountain,
      });
    }
  }
  columns.sort((a, b) => spawnColumnScore(a, originX, originZ) - spawnColumnScore(b, originX, originZ));
  return columns;
}

const MIN_SURFACE = 58;
const BASE_HEIGHT = 66;
const MAX_SURFACE = WORLD_HEIGHT - TERRAIN_HEADROOM;

export class TerrainGenerator {
  readonly numericSeed: number;

  constructor(readonly seed: string) {
    this.numericSeed = hashCoords(0x51f15e, ...this.seedParts(seed));
  }

  columnAt(x: number, z: number): ColumnInfo {
    const climate = fbm2D(this.numericSeed + 301, x / 150, z / 150, 3);
    const dryness = fbm2D(this.numericSeed + 733, x / 210, z / 210, 3);
    const biome: Biome = dryness > 0.24 ? 'desert' : climate < -0.14 ? 'forest' : 'plains';
    const broad = fbm2D(this.numericSeed + 17, x / 120, z / 120, 4);
    const detail = fbm2D(this.numericSeed + 47, x / 36, z / 36, 3);
    const biomeDetail = biome === 'desert' ? 0.75 : biome === 'forest' ? 1.05 : 0.9;
    const base = BASE_HEIGHT + broad * 4 + detail * 1.5 * biomeDetail;
    const hillField = fbm2D(this.numericSeed + 91, x / 72, z / 72, 3);
    const hills = Math.max(0, hillField - 0.12) * 8;
    const mountainField = fbm2D(this.numericSeed + 201, x / 260, z / 260, 3);
    const mountainMask = smoothstep(0.16, 0.46, mountainField);
    const mountainAmp = 10 + (fbm2D(this.numericSeed + 277, x / 180, z / 180, 2) + 1) * 5;
    const mountain = mountainMask * mountainAmp;
    const height = Math.max(MIN_SURFACE, Math.min(MAX_SURFACE, Math.floor(base + hills + mountain)));
    return { biome, height, base, hills, mountain };
  }

  generate(chunk: Chunk): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const halo = 1;
    const stride = CHUNK_SIZE + halo * 2;
    const heights = new Int16Array(stride * stride);
    const biomes = new Uint8Array(stride * stride);
    for (let hz = 0; hz < stride; hz += 1) {
      for (let hx = 0; hx < stride; hx += 1) {
        const column = this.columnAt(worldX + hx - halo, worldZ + hz - halo);
        const index = hz * stride + hx;
        heights[index] = column.height;
        biomes[index] = column.biome === 'forest' ? 1 : column.biome === 'desert' ? 2 : 0;
      }
    }

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
        const x = worldX + localX;
        const z = worldZ + localZ;
        const hx = localX + halo;
        const hz = localZ + halo;
        const height = heights[hz * stride + hx]!;
        const biomeCode = biomes[hz * stride + hx]!;
        const desert = biomeCode === 2;
        const columnIndex = localZ * CHUNK_SIZE + localX;
        chunk.surfaceHeights[columnIndex] = height;
        chunk.biomeCodes[columnIndex] = biomeCode;
        let roof = height;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            roof = Math.min(roof, heights[(hz + dz) * stride + hx + dx]!);
          }
        }
        roof -= CAVE_ROOF_DEPTH;
        const floor = this.bedrockHeight(x, z);
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          let block = BlockId.Air;
          if (y <= floor) block = BlockId.Bedrock;
          else if (y < height - (desert ? 4 : 3)) block = BlockId.Stone;
          else if (y < height) block = desert ? BlockId.Sandstone : BlockId.Dirt;
          else if (y === height) block = desert ? BlockId.Sand : BlockId.GrassBlock;
          else if (y <= SEA_LEVEL) block = BlockId.Water;

          if (block !== BlockId.Bedrock && y <= roof && this.isCave(x, y, z, height)) {
            block = BlockId.Air;
          }
          chunk.set(localX, y, localZ, block);
        }
      }
    }

    this.placeLavaLakes(chunk, heights, halo);
    this.generateOres(chunk);
    this.decorate(chunk);
    chunk.generated = true;
    chunk.dirty = true;
  }

  bedrockHeight(x: number, z: number): number {
    return Math.floor(random01(this.numericSeed + 9001, x, 0, z) * 3);
  }

  isCave(x: number, y: number, z: number, surfaceY: number): boolean {
    const floor = this.bedrockHeight(x, z);
    if (y <= floor || y >= surfaceY) return false;
    const main = Math.abs(valueNoise3D(this.numericSeed + 191, x / 52, y / 22, z / 52));
    const slow = valueNoise3D(this.numericSeed + 419, x / 78, y / 26, z / 78);
    if (main < 0.10 + Math.max(0, slow) * 0.02) return true;
    if (slow > 0.12) {
      const branch = Math.abs(valueNoise3D(this.numericSeed + 811, x / 34, y / 18, z / 34));
      if (branch < 0.07) return true;
    }
    return slow > 0.50 && main < 0.18;
  }

  isSafeSpawnColumn(x: number, z: number): boolean {
    const column = this.columnAt(x, z);
    if (column.biome === 'desert' || column.height <= SEA_LEVEL) return false;
    return true;
  }

  lavaLakeMask(x: number, z: number): boolean {
    const field = fbm2D(this.numericSeed + 8128, x / 22, z / 22, 3);
    if (field <= 0.20) return false;
    let neighbors = 0;
    if (fbm2D(this.numericSeed + 8128, (x + 1) / 22, z / 22, 3) > 0.20) neighbors += 1;
    if (fbm2D(this.numericSeed + 8128, (x - 1) / 22, z / 22, 3) > 0.20) neighbors += 1;
    if (fbm2D(this.numericSeed + 8128, x / 22, (z + 1) / 22, 3) > 0.20) neighbors += 1;
    if (fbm2D(this.numericSeed + 8128, x / 22, (z - 1) / 22, 3) > 0.20) neighbors += 1;
    return neighbors >= 2;
  }

  private placeLavaLakes(chunk: Chunk, heights: Int16Array, halo: number): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const stride = CHUNK_SIZE + halo * 2;
    const lakeSurface = 12;
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
        const x = worldX + localX;
        const z = worldZ + localZ;
        if (!this.lavaLakeMask(x, z)) continue;
        const height = heights[(localZ + halo) * stride + (localX + halo)]!;
        const floor = this.bedrockHeight(x, z);
        const top = Math.min(lakeSurface, height - 6);
        for (let y = floor + 1; y <= top; y += 1) {
          const here = chunk.get(localX, y, localZ);
          const below = chunk.get(localX, y - 1, localZ);
          if (here !== BlockId.Air && here !== BlockId.Lava) continue;
          if (below === BlockId.Air || below === BlockId.Water) continue;
          if (!this.isCave(x, y, z, height)) continue;
          chunk.set(localX, y, localZ, BlockId.Lava);
        }
      }
    }
  }

  private generateOres(chunk: Chunk): void {
    const rng = mulberry32(hashCoords(this.numericSeed + 991, chunk.x, 0, chunk.z));
    for (const ore of ORE_RULES) {
      for (let vein = 0; vein < ore.veins; vein += 1) {
        let x = Math.floor(rng() * CHUNK_SIZE);
        let y = ore.minY + Math.floor(rng() * (ore.maxY - ore.minY + 1));
        let z = Math.floor(rng() * CHUNK_SIZE);
        for (let step = 0; step < ore.size; step += 1) {
          if (chunk.get(x, y, z) === BlockId.Stone) chunk.set(x, y, z, ore.block);
          x = Math.max(0, Math.min(CHUNK_SIZE - 1, x + Math.floor(rng() * 3) - 1));
          y = Math.max(ore.minY, Math.min(ore.maxY, y + Math.floor(rng() * 3) - 1));
          z = Math.max(0, Math.min(CHUNK_SIZE - 1, z + Math.floor(rng() * 3) - 1));
        }
      }
    }
  }

  private decorate(chunk: Chunk): void {
    const rng = mulberry32(hashCoords(this.numericSeed + 1601, chunk.x, 0, chunk.z));
    const center = this.columnAt(chunk.x * CHUNK_SIZE + 8, chunk.z * CHUNK_SIZE + 8);
    const attempts = center.biome === 'forest' ? 10 : center.biome === 'desert' ? 5 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const x = 2 + Math.floor(rng() * (CHUNK_SIZE - 4));
      const z = 2 + Math.floor(rng() * (CHUNK_SIZE - 4));
      const worldX = chunk.x * CHUNK_SIZE + x;
      const worldZ = chunk.z * CHUNK_SIZE + z;
      const column = this.columnAt(worldX, worldZ);
      if (column.height <= SEA_LEVEL || column.height >= WORLD_HEIGHT - 8) continue;
      if (chunk.get(x, column.height, z) === BlockId.Air) continue;
      if (column.biome === 'desert') {
        if (chunk.get(x, column.height, z) !== BlockId.Sand || rng() > 0.09) continue;
        const height = 2 + Math.floor(rng() * 2);
        for (let y = 1; y <= height; y += 1) chunk.set(x, column.height + y, z, BlockId.Cactus);
      } else {
        if (chunk.get(x, column.height, z) !== BlockId.GrassBlock) continue;
        if (column.biome === 'forest' && rng() > 0.4) continue;
        if (column.biome === 'plains' && rng() > 0.48) continue;
        const grove = fbm2D(this.numericSeed + 1703, worldX / 42, worldZ / 42, 2);
        if (column.biome === 'forest' && grove < -0.35 && rng() > 0.5) continue;
        this.placeOak(chunk, x, column.height + 1, z, 4 + Math.floor(rng() * 2));
      }
    }
    this.decoratePlants(chunk, rng);
  }

  private decoratePlants(chunk: Chunk, rng: () => number): void {
    for (let attempt = 0; attempt < 52; attempt += 1) {
      const x = Math.floor(rng() * CHUNK_SIZE);
      const z = Math.floor(rng() * CHUNK_SIZE);
      const worldX = chunk.x * CHUNK_SIZE + x;
      const worldZ = chunk.z * CHUNK_SIZE + z;
      const column = this.columnAt(worldX, worldZ);
      if (column.height <= SEA_LEVEL || column.height >= WORLD_HEIGHT - 2) continue;
      const plantY = column.height + 1;
      if (chunk.get(x, plantY, z) !== BlockId.Air) continue;
      const roll = rng();
      if (column.biome === 'desert') {
        if (chunk.get(x, column.height, z) === BlockId.Sand && roll < 0.08) {
          chunk.set(x, plantY, z, BlockId.DeadBush);
        }
        continue;
      }
      if (chunk.get(x, column.height, z) !== BlockId.GrassBlock) continue;
      const density = column.biome === 'forest' ? 0.76 : 0.50;
      if (roll >= density) continue;
      const kind = rng();
      if (column.biome === 'forest' && kind < 0.34) chunk.set(x, plantY, z, BlockId.Fern);
      else if (kind < 0.82) chunk.set(x, plantY, z, BlockId.TallGrass);
      else if (kind < 0.89) chunk.set(x, plantY, z, BlockId.Dandelion);
      else if (kind < 0.96) chunk.set(x, plantY, z, BlockId.Poppy);
      else chunk.set(x, plantY, z, BlockId.OxeyeDaisy);
    }
  }

  private placeOak(chunk: Chunk, x: number, y: number, z: number, height: number): void {
    for (let offset = 0; offset < height; offset += 1) chunk.set(x, y + offset, z, BlockId.OakLog);
    const top = y + height;
    for (let dy = -2; dy <= 1; dy += 1) {
      const radius = dy >= 1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && dy !== 0) continue;
          if (chunk.get(x + dx, top + dy, z + dz) === BlockId.Air) chunk.set(x + dx, top + dy, z + dz, BlockId.OakLeaves);
        }
      }
    }
  }

  private seedParts(seed: string): [number, number, number] {
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    let c = 0x85ebca6b;
    for (let index = 0; index < seed.length; index += 1) {
      const code = seed.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ (code + index), 2246822519);
      c = Math.imul(c ^ (code * 31), 3266489917);
    }
    return [a | 0, b | 0, c | 0];
  }
}
