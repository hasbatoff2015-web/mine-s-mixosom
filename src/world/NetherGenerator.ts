import { BlockId } from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import { hashCoords, hashString, mulberry32, valueNoise2D } from './noise';
import type { ColumnInfo } from './Generator';
import type { Chunk } from './Chunk';
import type { TerrainGenJob } from './Generator';

const NETHER_SALT = 0x4e455448;
const MIN_SURFACE = 48;
const BASE_HEIGHT = 64;
const MAX_SURFACE = 96;

/**
 * Deterministic Nether terrain. Same world seed as the overworld, different salt.
 * No caves, no overworld ores, no biomes. Solid netherrack from the surface to bedrock.
 */
export class NetherGenerator {
  readonly numericSeed: number;

  constructor(readonly seed: string) {
    this.numericSeed = (hashString(seed) ^ NETHER_SALT) >>> 0;
  }

  columnAt(x: number, z: number): ColumnInfo {
    const broad = valueNoise2D(this.numericSeed + 17, x / 140, z / 140);
    const detail = valueNoise2D(this.numericSeed + 91, x / 48, z / 48);
    const hill = Math.max(0, valueNoise2D(this.numericSeed + 201, x / 72, z / 72) - 0.08) * 16;
    const height = Math.max(
      MIN_SURFACE,
      Math.min(MAX_SURFACE, Math.floor(BASE_HEIGHT + broad * 6 + detail * 3 + hill)),
    );
    return {
      biome: 'plains',
      hydrologyRegion: 'none',
      waterBiome: 'none',
      height,
      legacyHeight: height,
      base: BASE_HEIGHT,
      hills: hill,
      mountain: 0,
      climate: 0,
      dryness: 1,
      waterMask: 0,
    };
  }

  bedrockHeight(_x: number, _z: number): number {
    return 0;
  }

  isCave(_x: number, _y: number, _z: number, _surfaceY: number): boolean {
    return false;
  }

  isSafeSpawnColumn(x: number, z: number): boolean {
    return this.columnAt(x, z).height >= MIN_SURFACE;
  }

  terrainSolid(x: number, y: number, z: number): boolean {
    if (y <= 0) return true;
    return y <= this.columnAt(x, z).height;
  }

  generate(chunk: Chunk): void {
    const job = this.beginGenerate(chunk);
    while (!this.advanceGenerate(job, CHUNK_SIZE * CHUNK_SIZE)) {
      // Tests and the server need a finished column.
    }
  }

  beginGenerate(chunk: Chunk): TerrainGenJob {
    return {
      chunk,
      phase: 'heights',
      cursor: 0,
      heights: new Int16Array(CHUNK_SIZE * CHUNK_SIZE),
      biomes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
      halo: 0,
      elapsedMs: 0,
    };
  }

  advanceGenerate(job: TerrainGenJob, columnBudget = 16): boolean {
    const chunk = job.chunk;
    if (job.phase === 'heights') {
      const total = CHUNK_SIZE * CHUNK_SIZE;
      const limit = Math.max(1, Math.min(columnBudget, total - job.cursor));
      for (let i = 0; i < limit; i += 1) {
        const index = job.cursor + i;
        const localZ = Math.floor(index / CHUNK_SIZE);
        const localX = index - localZ * CHUNK_SIZE;
        const column = this.columnAt(chunk.x * CHUNK_SIZE + localX, chunk.z * CHUNK_SIZE + localZ);
        job.heights[index] = column.height;
        job.biomes[index] = 0;
        chunk.biomeCodes[index] = 0;
        chunk.surfaceHeights[index] = column.height;
      }
      job.cursor += limit;
      if (job.cursor >= total) {
        job.phase = 'columns';
        job.cursor = 0;
      }
      return false;
    }
    if (job.phase === 'columns') {
      const total = CHUNK_SIZE * CHUNK_SIZE;
      const limit = Math.max(1, Math.min(columnBudget, total - job.cursor));
      for (let i = 0; i < limit; i += 1) this.fillColumn(job, job.cursor + i);
      job.cursor += limit;
      if (job.cursor >= total) {
        job.phase = 'lava';
        job.cursor = 0;
      }
      return false;
    }
    if (job.phase === 'lava') {
      this.placeLavaLakes(chunk, job.heights);
      job.phase = 'ores';
      return false;
    }
    if (job.phase === 'ores') {
      this.placeMythril(chunk, job.heights);
      job.phase = 'deposits';
      return false;
    }
    if (job.phase === 'deposits') {
      this.placeGlowstone(chunk, job.heights);
      job.phase = 'decorate';
      return false;
    }
    if (job.phase === 'decorate') {
      this.placeSoulSandAndFlowers(chunk, job.heights);
      this.placeSoulFire(chunk, job.heights);
      this.placeMushrooms(chunk, job.heights);
      job.phase = 'cane';
      return false;
    }
    job.phase = 'gourds';
    return true;
  }

  private fillColumn(job: TerrainGenJob, index: number): void {
    const chunk = job.chunk;
    const localZ = Math.floor(index / CHUNK_SIZE);
    const localX = index - localZ * CHUNK_SIZE;
    const height = job.heights[index] ?? BASE_HEIGHT;
    chunk.set(localX, 0, localZ, BlockId.Bedrock);
    for (let y = 1; y <= height; y += 1) chunk.set(localX, y, localZ, BlockId.Netherrack);
  }

  private placeLavaLakes(chunk: Chunk, heights: Int16Array): void {
    const originX = chunk.x * CHUNK_SIZE;
    const originZ = chunk.z * CHUNK_SIZE;
    for (let cellZ = Math.floor(originZ / 48) - 1; cellZ <= Math.floor((originZ + 15) / 48) + 1; cellZ += 1) {
      for (let cellX = Math.floor(originX / 48) - 1; cellX <= Math.floor((originX + 15) / 48) + 1; cellX += 1) {
        if (hashCoords(this.numericSeed + 41, cellX, 0, cellZ) % 5 !== 0) continue;
        const centerX = cellX * 48 + 24;
        const centerZ = cellZ * 48 + 24;
        const columns: Array<{ x: number; z: number; depth: number }> = [];
        for (let dz = -7; dz <= 7; dz += 1) {
          for (let dx = -7; dx <= 7; dx += 1) {
            const x = centerX + dx;
            const z = centerZ + dz;
            const nx = dx / 6.2;
            const nz = dz / 6.2;
            const edge = valueNoise2D(this.numericSeed + 77, x / 5, z / 5);
            if (nx * nx + nz * nz > 1 + edge * 0.35) continue;
            const depth = hashCoords(this.numericSeed + 13, x, 2, z) % 2 === 0 ? 1 : 2;
            columns.push({ x, z, depth });
          }
        }
        if (columns.length < 8) continue;
        const inside = new Set(columns.map((column) => `${column.x},${column.z}`));
        let enclosed = true;
        for (const column of columns) {
          const surface = this.columnAt(column.x, column.z).height;
          const lavaY = surface - column.depth;
          if (lavaY <= 1) {
            enclosed = false;
            break;
          }
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const neighbor = `${column.x + ox},${column.z + oz}`;
            if (inside.has(neighbor)) continue;
            if (this.columnAt(column.x + ox, column.z + oz).height < lavaY) enclosed = false;
          }
          if (!enclosed) break;
        }
        if (!enclosed) continue;
        for (const column of columns) {
          if (!this.inChunk(chunk, column.x, column.z)) continue;
          const localX = column.x - originX;
          const localZ = column.z - originZ;
          const index = localZ * CHUNK_SIZE + localX;
          const surface = heights[index] ?? this.columnAt(column.x, column.z).height;
          const lavaY = surface - column.depth;
          for (let y = lavaY + 1; y <= surface; y += 1) chunk.set(localX, y, localZ, BlockId.Air);
          chunk.set(localX, lavaY, localZ, BlockId.Lava);
          heights[index] = lavaY - 1;
          chunk.surfaceHeights[index] = lavaY - 1;
        }
      }
    }
  }

  private placeMythril(chunk: Chunk, heights: Int16Array): void {
    const random = mulberry32(hashCoords(this.numericSeed + 503, chunk.x, 0, chunk.z));
    const veins = random() < 0.22 ? 1 : 0;
    for (let vein = 0; vein < veins; vein += 1) {
      const localX = Math.floor(random() * CHUNK_SIZE);
      const localZ = Math.floor(random() * CHUNK_SIZE);
      const surface = heights[localZ * CHUNK_SIZE + localX] ?? BASE_HEIGHT;
      const y = 4 + Math.floor(random() * Math.max(1, surface - 8));
      const size = 1 + Math.floor(random() * 3);
      let x = localX;
      let zy = y;
      let z = localZ;
      for (let step = 0; step < size; step += 1) {
        this.replaceNetherrack(chunk, x, zy, z);
        x = Math.max(0, Math.min(CHUNK_SIZE - 1, x + Math.floor(random() * 3) - 1));
        z = Math.max(0, Math.min(CHUNK_SIZE - 1, z + Math.floor(random() * 3) - 1));
        zy = Math.max(2, Math.min(surface - 2, zy + Math.floor(random() * 3) - 1));
      }
    }
    if (random() < 0.04) {
      const localX = Math.floor(random() * CHUNK_SIZE);
      const localZ = Math.floor(random() * CHUNK_SIZE);
      const surface = heights[localZ * CHUNK_SIZE + localX] ?? BASE_HEIGHT;
      if (chunk.get(localX, surface, localZ) === BlockId.Netherrack) {
        chunk.set(localX, surface, localZ, BlockId.MythrilOre);
      }
    }
  }

  private placeGlowstone(chunk: Chunk, heights: Int16Array): void {
    const random = mulberry32(hashCoords(this.numericSeed + 809, chunk.x, 3, chunk.z));
    if (random() > 0.28) return;
    const count = 3 + Math.floor(random() * 6);
    let x = Math.floor(random() * CHUNK_SIZE);
    let z = Math.floor(random() * CHUNK_SIZE);
    const placed: Array<[number, number]> = [];
    for (let i = 0; i < count; i += 1) {
      const surface = heights[z * CHUNK_SIZE + x] ?? BASE_HEIGHT;
      const above = surface + 1 < 256 ? chunk.get(x, surface + 1, z) : BlockId.Air;
      if (chunk.get(x, surface, z) === BlockId.Netherrack && above !== BlockId.Lava) {
        chunk.set(x, surface, z, BlockId.Glowstone);
        placed.push([x, z]);
      }
      x = Math.max(0, Math.min(CHUNK_SIZE - 1, x + Math.floor(random() * 3) - 1));
      z = Math.max(0, Math.min(CHUNK_SIZE - 1, z + Math.floor(random() * 3) - 1));
    }
    if (placed.length < 3) {
      for (const [px, pz] of placed) {
        const surface = heights[pz * CHUNK_SIZE + px] ?? BASE_HEIGHT;
        if (chunk.get(px, surface, pz) === BlockId.Glowstone) chunk.set(px, surface, pz, BlockId.Netherrack);
      }
    }
  }

  private placeSoulSandAndFlowers(chunk: Chunk, heights: Int16Array): void {
    const originX = chunk.x * CHUNK_SIZE;
    const originZ = chunk.z * CHUNK_SIZE;
    for (let cellZ = Math.floor(originZ / 96) - 1; cellZ <= Math.floor((originZ + 15) / 96) + 1; cellZ += 1) {
      for (let cellX = Math.floor(originX / 96) - 1; cellX <= Math.floor((originX + 15) / 96) + 1; cellX += 1) {
        if (hashCoords(this.numericSeed + 1201, cellX, 4, cellZ) % 17 !== 0) continue;
        const size = hashCoords(this.numericSeed + 1202, cellX, 5, cellZ) % 2 === 0 ? 3 : 4;
        const startX = cellX * 96 + 40;
        const startZ = cellZ * 96 + 40;
        const cells: Array<[number, number]> = [];
        let flat = true;
        let base = -1;
        for (let dz = 0; dz < size; dz += 1) {
          for (let dx = 0; dx < size; dx += 1) {
            const x = startX + dx;
            const z = startZ + dz;
            const height = this.columnAt(x, z).height;
            if (base < 0) base = height;
            if (height !== base) flat = false;
            cells.push([x, z]);
          }
        }
        if (!flat || base < 2) continue;
        for (const [x, z] of cells) {
          if (!this.inChunk(chunk, x, z)) continue;
          const localX = x - originX;
          const localZ = z - originZ;
          const index = localZ * CHUNK_SIZE + localX;
          const surface = heights[index] ?? base;
          if (chunk.get(localX, surface, localZ) !== BlockId.Netherrack) continue;
          if (surface + 1 >= 255) continue;
          if (chunk.get(localX, surface + 1, localZ) !== BlockId.Air) continue;
          chunk.set(localX, surface, localZ, BlockId.SoulSand);
          chunk.set(localX, surface + 1, localZ, BlockId.EnchantmentFlower);
        }
      }
    }
  }

  private placeSoulFire(chunk: Chunk, heights: Int16Array): void {
    const random = mulberry32(hashCoords(this.numericSeed + 1601, chunk.x, 6, chunk.z));
    if (random() > 0.35) return;
    const localX = Math.floor(random() * CHUNK_SIZE);
    const localZ = Math.floor(random() * CHUNK_SIZE);
    const surface = heights[localZ * CHUNK_SIZE + localX] ?? BASE_HEIGHT;
    const support = chunk.get(localX, surface, localZ);
    if (support !== BlockId.Netherrack && support !== BlockId.SoulSand) return;
    if (surface + 1 >= 255) return;
    if (chunk.get(localX, surface + 1, localZ) !== BlockId.Air) return;
    chunk.set(localX, surface + 1, localZ, BlockId.SoulFire);
  }

  private placeMushrooms(chunk: Chunk, heights: Int16Array): void {
    const random = mulberry32(hashCoords(this.numericSeed + 1901, chunk.x, 7, chunk.z));
    const count = random() < 0.45 ? 1 : 0;
    for (let i = 0; i < count; i += 1) {
      const localX = 2 + Math.floor(random() * (CHUNK_SIZE - 4));
      const localZ = 2 + Math.floor(random() * (CHUNK_SIZE - 4));
      const surface = heights[localZ * CHUNK_SIZE + localX] ?? BASE_HEIGHT;
      if (chunk.get(localX, surface, localZ) !== BlockId.Netherrack) continue;
      const stem = 2 + Math.floor(random() * 2);
      const capY = surface + stem;
      if (capY + 1 >= 250) continue;
      const cells: Array<[number, number, number, BlockId]> = [];
      let clear = true;
      for (let y = 1; y <= stem; y += 1) {
        if (chunk.get(localX, surface + y, localZ) !== BlockId.Air) clear = false;
        cells.push([localX, surface + y, localZ, BlockId.NetherMushroomStem]);
      }
      for (let dz = -1; dz <= 1 && clear; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (Math.abs(dx) + Math.abs(dz) > 2) continue;
          const x = localX + dx;
          const z = localZ + dz;
          if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) {
            clear = false;
            break;
          }
          if (chunk.get(x, capY, z) !== BlockId.Air) clear = false;
          cells.push([x, capY, z, BlockId.NetherMushroomCap]);
        }
      }
      if (!clear) continue;
      if (chunk.get(localX, capY + 1, localZ) !== BlockId.Air) continue;
      cells.push([localX, capY + 1, localZ, BlockId.NetherMushroomCap]);
      for (const [x, y, z, block] of cells) chunk.set(x, y, z, block);
    }
  }

  private replaceNetherrack(chunk: Chunk, x: number, y: number, z: number): void {
    if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y <= 1) return;
    if (chunk.get(x, y, z) === BlockId.Netherrack) chunk.set(x, y, z, BlockId.MythrilOre);
  }

  private inChunk(chunk: Chunk, x: number, z: number): boolean {
    const originX = chunk.x * CHUNK_SIZE;
    const originZ = chunk.z * CHUNK_SIZE;
    return x >= originX && z >= originZ && x < originX + CHUNK_SIZE && z < originZ + CHUNK_SIZE;
  }
}
