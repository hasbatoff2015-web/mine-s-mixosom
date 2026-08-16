import { BlockId } from '../blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { Chunk } from './Chunk';
import { fbm2D, hashCoords, mulberry32, random01, valueNoise3D } from './noise';

export type Biome = 'plains' | 'forest' | 'desert';

interface OreRule {
  block: BlockId;
  minY: number;
  maxY: number;
  veins: number;
  size: number;
}

const ORES: readonly OreRule[] = [
  { block: BlockId.CoalOre, minY: 18, maxY: 46, veins: 10, size: 7 },
  { block: BlockId.IronOre, minY: 8, maxY: 40, veins: 10, size: 6 },
  { block: BlockId.GoldOre, minY: 4, maxY: 24, veins: 4, size: 5 },
  { block: BlockId.RedstoneOre, minY: 3, maxY: 15, veins: 5, size: 5 },
  { block: BlockId.DiamondOre, minY: 3, maxY: 11, veins: 2, size: 4 },
];

export interface ColumnInfo {
  biome: Biome;
  height: number;
}

export class TerrainGenerator {
  readonly numericSeed: number;

  constructor(readonly seed: string) {
    this.numericSeed = hashCoords(0x51f15e, ...this.seedParts(seed));
  }

  columnAt(x: number, z: number): ColumnInfo {
    const climate = fbm2D(this.numericSeed + 301, x / 150, z / 150, 3);
    const dryness = fbm2D(this.numericSeed + 733, x / 210, z / 210, 3);
    const biome: Biome = dryness > 0.24 ? 'desert' : climate < -0.14 ? 'forest' : 'plains';
    const broad = fbm2D(this.numericSeed + 17, x / 105, z / 105, 4);
    const detail = fbm2D(this.numericSeed + 47, x / 32, z / 32, 3);
    const ridge = 1 - Math.abs(fbm2D(this.numericSeed + 91, x / 185, z / 185, 3));
    const biomeScale = biome === 'desert' ? 0.65 : biome === 'forest' ? 1.08 : 0.9;
    const raw = 49 + broad * 8 * biomeScale + detail * 2.2 + Math.max(0, ridge - 0.7) * 13;
    return { biome, height: Math.max(38, Math.min(68, Math.floor(raw))) };
  }

  generate(chunk: Chunk): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
        const x = worldX + localX;
        const z = worldZ + localZ;
        const column = this.columnAt(x, z);
        const columnIndex = localZ * CHUNK_SIZE + localX;
        chunk.surfaceHeights[columnIndex] = column.height;
        chunk.biomeCodes[columnIndex] = column.biome === 'forest' ? 1 : column.biome === 'desert' ? 2 : 0;
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          let block = BlockId.Air;
          if (y <= this.bedrockHeight(x, z)) block = BlockId.Bedrock;
          else if (y < column.height - (column.biome === 'desert' ? 4 : 3)) block = BlockId.Stone;
          else if (y < column.height) block = column.biome === 'desert' ? BlockId.Sandstone : BlockId.Dirt;
          else if (y === column.height) block = column.biome === 'desert' ? BlockId.Sand : BlockId.GrassBlock;
          else if (y <= SEA_LEVEL) block = BlockId.Water;

          if (block === BlockId.Stone && y > 3 && y < column.height - 4 && this.isCave(x, y, z)) {
            block = y < 7 && random01(this.numericSeed + 8128, x, y, z) > 0.78 ? BlockId.Lava : BlockId.Air;
          }
          chunk.set(localX, y, localZ, block);
        }
      }
    }

    this.generateOres(chunk);
    this.decorate(chunk);
    chunk.generated = true;
    chunk.dirty = true;
  }

  private bedrockHeight(x: number, z: number): number {
    return Math.floor(random01(this.numericSeed + 9001, x, 0, z) * 3);
  }

  private isCave(x: number, y: number, z: number): boolean {
    const primary = valueNoise3D(this.numericSeed + 191, x / 19, y / 11, z / 19);
    const tunnels = Math.abs(valueNoise3D(this.numericSeed + 419, x / 28, y / 8, z / 28));
    return primary > 0.46 && tunnels < 0.43;
  }

  private generateOres(chunk: Chunk): void {
    const rng = mulberry32(hashCoords(this.numericSeed + 991, chunk.x, 0, chunk.z));
    for (const ore of ORES) {
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
      if (column.biome === 'desert') {
        if (chunk.get(x, column.height, z) !== BlockId.Sand || rng() > 0.72) continue;
        const height = 2 + Math.floor(rng() * 2);
        for (let y = 1; y <= height; y += 1) chunk.set(x, column.height + y, z, BlockId.Cactus ?? BlockId.OakLog);
      } else {
        if (chunk.get(x, column.height, z) !== BlockId.GrassBlock || (column.biome === 'plains' && rng() > 0.48)) continue;
        this.placeOak(chunk, x, column.height + 1, z, 4 + Math.floor(rng() * 2));
      }
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
