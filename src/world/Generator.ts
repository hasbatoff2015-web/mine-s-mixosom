import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, MAX_GENERATED_SURFACE, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { Chunk } from './Chunk';
import { fbm2D, hashCoords, mulberry32, random01, smoothstep, valueNoise2D, valueNoise3D } from './noise';

export type Biome = 'plains' | 'forest' | 'desert' | 'snowy_plains';

export const BIOME_CODES: Readonly<Record<Biome, number>> = {
  plains: 0,
  forest: 1,
  desert: 2,
  snowy_plains: 3,
};

export const DESERT_THRESHOLD = 0.24;
export const FOREST_THRESHOLD = -0.14;
/** Calibrated over eight 2048×2048 samples: ~9.1% of above-sea land. */
export const SNOWY_THRESHOLD = -0.36;

export function biomeCode(biome: Biome): number {
  return BIOME_CODES[biome];
}

export type TreeKind = 'oak' | 'birch' | 'spruce';

export const TREE_BLOCKS: Readonly<Record<TreeKind, Readonly<{ log: BlockId; leaves: BlockId }>>> = {
  oak: { log: BlockId.OakLog, leaves: BlockId.OakLeaves },
  birch: { log: BlockId.BirchLog, leaves: BlockId.BirchLeaves },
  spruce: { log: BlockId.SpruceLog, leaves: BlockId.SpruceLeaves },
};

const BIOME_SPAWN_PENALTY: Readonly<Record<Biome, number>> = {
  plains: 0,
  forest: 18,
  snowy_plains: 42,
  desert: 80,
};

export interface OreRule {
  readonly block: BlockId;
  readonly minY: number;
  readonly maxY: number;
  readonly veins: number;
  readonly size: number;
  /** Extra independent vein attempt with this probability. Diamond only. */
  readonly extraVeinChance?: number;
  /** Optional whole-rule chance. Absent rules consume no additional RNG call. */
  readonly spawnChance?: number;
}

/**
 * Ordinary cave carving stops this many blocks below the local (3×3 min) terrain roof.
 * Intentional 1×1 surface mouths are disabled; underground networks stay intact.
 */
export const CAVE_ROOF_DEPTH = 4;

/** Solid Stone that always sits on top of Bedrock and cannot be carved or replaced by lava. */
export const BEDROCK_COVER_DEPTH = 1;
/** Inclusive Y of the world-wide Stone cap. Bedrock stays at Y 0–2. */
export const STONE_CAP_TOP_Y = 3;

export function stoneCapY(_bedrockTop: number): number {
  return STONE_CAP_TOP_Y;
}

export function minCaveY(_bedrockTop: number): number {
  return STONE_CAP_TOP_Y + 1;
}

/** Deepest Y a generated cave-lava pond surface may occupy. */
export const LAVA_POND_MAX_SURFACE_Y = 12;

/** Ordinary generated ponds are 1–3 source layers, never a tall lava wall. */
export const LAVA_POND_MAX_DEPTH = 3;

/** World-space lattice for pond attempts. Ponds may straddle chunk borders. */
export const LAVA_POND_CELL = 16;

/** Skip tiny fragments that would look like the old scatter. */
const LAVA_POND_MIN_COLUMNS = 4;

/** Cave deposits use a separate world-space lattice and never consume ore RNG. */
export const CAVE_DEPOSIT_CELL_XZ = 12;
export const CAVE_DEPOSIT_CELL_Y = 10;
export const CAVE_DEPOSIT_MIN_Y = 14;
export const CAVE_DEPOSIT_MAX_Y = 54;
const CAVE_DEPOSIT_MAX_RADIUS_XZ = 3.9;
const CAVE_DEPOSIT_MAX_RADIUS_Y = 2.2;
const CAVE_DEPOSIT_CHANCE = 0.20;

type CaveDepositKind = 'gravel' | 'clay';

interface CaveDepositPlan {
  readonly cellX: number;
  readonly cellY: number;
  readonly cellZ: number;
  readonly kind: CaveDepositKind;
  readonly block: BlockId.Gravel | BlockId.Clay;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly radiusZ: number;
}

interface CaveDepositVoxel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const HORIZONTAL_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

interface LavaPondPlan {
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  readonly depth: number;
}

interface LavaPondColumn {
  readonly x: number;
  readonly z: number;
  readonly depth: number;
}

/**
 * Absolute Y bands after the +15 stack shift. Relative shape matches the old
 * compact-world layout (diamond/redstone near bedrock, coal higher).
 * Vein *attempts* are ~2× the previous pass; vein `size` is unchanged.
 */
export const ORE_RULES: readonly OreRule[] = [
  { block: BlockId.CoalOre, minY: 28, maxY: 61, veins: 24, size: 7 },
  { block: BlockId.IronOre, minY: 8, maxY: 52, veins: 22, size: 6 },
  { block: BlockId.GoldOre, minY: 4, maxY: 32, veins: 8, size: 5 },
  { block: BlockId.RedstoneOre, minY: 3, maxY: 18, veins: 10, size: 5 },
  { block: BlockId.DiamondOre, minY: 3, maxY: 16, veins: 1, size: 4, extraVeinChance: 1 / 3 },
  { block: BlockId.TitaniumOre, minY: 4, maxY: 12, veins: 1, size: 3, spawnChance: 0.75 },
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
  return BIOME_SPAWN_PENALTY[column.biome]
    + column.mountain * 3.2
    + Math.hypot(column.x - originX, column.z - originZ) * 0.04;
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
const MAX_SURFACE = MAX_GENERATED_SURFACE;

export class TerrainGenerator {
  readonly numericSeed: number;
  private readonly caveDepositCache = new Map<string, readonly CaveDepositVoxel[] | null>();
  private readonly caveColumnCache = new Map<string, ColumnInfo>();

  constructor(readonly seed: string) {
    this.numericSeed = hashCoords(0x51f15e, ...this.seedParts(seed));
  }

  columnAt(x: number, z: number): ColumnInfo {
    const climate = fbm2D(this.numericSeed + 301, x / 150, z / 150, 3);
    const dryness = fbm2D(this.numericSeed + 733, x / 210, z / 210, 3);
    const biome: Biome = dryness > DESERT_THRESHOLD
      ? 'desert'
      : climate < SNOWY_THRESHOLD
        ? 'snowy_plains'
        : climate < FOREST_THRESHOLD
          ? 'forest'
          : 'plains';
    const broad = fbm2D(this.numericSeed + 17, x / 120, z / 120, 4);
    const detail = fbm2D(this.numericSeed + 47, x / 36, z / 36, 3);
    // Snow is carved out of the former cold forest range, so it deliberately
    // keeps the exact old forest terrain multiplier.
    const biomeDetail = biome === 'desert' ? 0.75 : biome === 'forest' || biome === 'snowy_plains' ? 1.05 : 0.9;
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
        biomes[index] = biomeCode(column.biome);
      }
    }

    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
        const x = worldX + localX;
        const z = worldZ + localZ;
        const hx = localX + halo;
        const hz = localZ + halo;
        const height = heights[hz * stride + hx]!;
        const code = biomes[hz * stride + hx]!;
        const desert = code === BIOME_CODES.desert;
        const snowy = code === BIOME_CODES.snowy_plains;
        const columnIndex = localZ * CHUNK_SIZE + localX;
        chunk.surfaceHeights[columnIndex] = height;
        chunk.biomeCodes[columnIndex] = code;
        let roof = height;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            roof = Math.min(roof, heights[(hz + dz) * stride + hx + dx]!);
          }
        }
        roof -= CAVE_ROOF_DEPTH;
        const floor = this.bedrockHeight(x, z);
        const cap = stoneCapY(floor);
        const fillTop = Math.max(height, SEA_LEVEL);
        for (let y = 0; y <= fillTop; y += 1) {
          let block = BlockId.Air;
          if (y <= floor) block = BlockId.Bedrock;
          else if (y <= cap) block = BlockId.Stone;
          else if (y < height - (desert ? 4 : 3)) block = BlockId.Stone;
          else if (y < height) block = desert ? BlockId.Sandstone : BlockId.Dirt;
          else if (y === height) block = desert ? BlockId.Sand : snowy ? BlockId.SnowBlock : BlockId.GrassBlock;
          else if (y <= SEA_LEVEL) block = snowy && y === SEA_LEVEL ? BlockId.Ice : BlockId.Water;

          if (y > cap && y <= roof && this.isCave(x, y, z, height)) {
            block = BlockId.Air;
          }
          chunk.set(localX, y, localZ, block);
        }
      }
    }

    this.placeLavaLakes(chunk, heights, halo);
    this.generateOres(chunk);
    this.generateCaveDeposits(chunk);
    this.decorate(chunk);
    chunk.generated = true;
    chunk.dirty = true;
  }

  bedrockHeight(x: number, z: number): number {
    return Math.floor(random01(this.numericSeed + 9001, x, 0, z) * 3);
  }

  isCave(x: number, y: number, z: number, surfaceY: number): boolean {
    const floor = this.bedrockHeight(x, z);
    if (y < minCaveY(floor) || y >= surfaceY) return false;
    const main = Math.abs(valueNoise3D(this.numericSeed + 191, x / 52, y / 22, z / 52));
    const slow = valueNoise3D(this.numericSeed + 419, x / 78, y / 26, z / 78);
    if (main < 0.10 + Math.max(0, slow) * 0.02) return true;
    if (slow > 0.12) {
      const branch = Math.abs(valueNoise3D(this.numericSeed + 811, x / 34, y / 18, z / 34));
      if (branch < 0.07) return true;
    }
    return slow > 0.50 && main < 0.18;
  }

  /** Exact terrain-pass cave Air query, including the local 3×3 roof guard. */
  isNaturalCaveAir(x: number, y: number, z: number): boolean {
    if (y < CAVE_DEPOSIT_MIN_Y - 1 || y >= WORLD_HEIGHT) return false;
    const column = this.caveColumnAt(x, z);
    let roof = column.height;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        roof = Math.min(roof, this.caveColumnAt(x + dx, z + dz).height);
      }
    }
    roof -= CAVE_ROOF_DEPTH;
    const cap = stoneCapY(this.bedrockHeight(x, z));
    return y > cap && y <= roof && this.isCave(x, y, z, column.height);
  }

  private caveColumnAt(x: number, z: number): ColumnInfo {
    const key = `${x},${z}`;
    const cached = this.caveColumnCache.get(key);
    if (cached) return cached;
    const column = this.columnAt(x, z);
    if (this.caveColumnCache.size >= 8192) {
      const oldest = this.caveColumnCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.caveColumnCache.delete(oldest);
    }
    this.caveColumnCache.set(key, column);
    return column;
  }

  isSafeSpawnColumn(x: number, z: number): boolean {
    const column = this.columnAt(x, z);
    if (column.biome === 'desert' || column.height <= SEA_LEVEL) return false;
    return true;
  }

  /** Lowest deep-cave stone floor in the lava band, or undefined if none. */
  caveFloorStoneY(x: number, z: number): number | undefined {
    const surface = this.columnAt(x, z).height;
    const cap = stoneCapY(this.bedrockHeight(x, z));
    const maxY = Math.min(LAVA_POND_MAX_SURFACE_Y, surface - 8);
    if (maxY <= cap + 1) return undefined;
    for (let y = cap + 2; y <= maxY; y += 1) {
      if (!this.isCave(x, y, z, surface) || this.isCave(x, y - 1, z, surface)) continue;
      const stoneY = y - 1;
      if (stoneY <= cap) continue;
      return stoneY;
    }
    return undefined;
  }

  private pondPlan(cellX: number, cellZ: number): LavaPondPlan | undefined {
    if (random01(this.numericSeed + 8128, cellX, 3, cellZ) > 0.48) return undefined;
    const jitterX = random01(this.numericSeed + 8129, cellX, 4, cellZ);
    const jitterZ = random01(this.numericSeed + 8130, cellX, 5, cellZ);
    const sizeRoll = random01(this.numericSeed + 8131, cellX, 6, cellZ);
    const depthRoll = random01(this.numericSeed + 8132, cellX, 7, cellZ);
    const radius = sizeRoll < 0.62
      ? 1.7 + (sizeRoll / 0.62) * 0.9
      : sizeRoll < 0.9
        ? 2.6 + ((sizeRoll - 0.62) / 0.28) * 1.4
        : 4.0 + ((sizeRoll - 0.9) / 0.1) * 2.0;
    return {
      cx: cellX * LAVA_POND_CELL + 2 + Math.floor(jitterX * (LAVA_POND_CELL - 4)),
      cz: cellZ * LAVA_POND_CELL + 2 + Math.floor(jitterZ * (LAVA_POND_CELL - 4)),
      radius,
      depth: 1 + Math.floor(depthRoll * LAVA_POND_MAX_DEPTH),
    };
  }

  private inPondFootprint(x: number, z: number, pond: LavaPondPlan): boolean {
    const dx = x - pond.cx;
    const dz = z - pond.cz;
    const warp = valueNoise2D(this.numericSeed + 9041, x / 5.5, z / 5.5);
    const radius = pond.radius * (0.84 + warp * 0.28);
    return dx * dx + dz * dz <= radius * radius;
  }

  private placeLavaLakes(chunk: Chunk, heights: Int16Array, halo: number): void {
    void heights;
    void halo;
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const minCellX = Math.floor(worldX / LAVA_POND_CELL) - 1;
    const maxCellX = Math.floor((worldX + CHUNK_SIZE - 1) / LAVA_POND_CELL) + 1;
    const minCellZ = Math.floor(worldZ / LAVA_POND_CELL) - 1;
    const maxCellZ = Math.floor((worldZ + CHUNK_SIZE - 1) / LAVA_POND_CELL) + 1;
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const pond = this.pondPlan(cellX, cellZ);
        if (!pond) continue;
        const reach = Math.ceil(pond.radius + 2);
        if (pond.cx + reach < worldX || pond.cx - reach >= worldX + CHUNK_SIZE) continue;
        if (pond.cz + reach < worldZ || pond.cz - reach >= worldZ + CHUNK_SIZE) continue;
        const centerFloor = this.caveFloorStoneY(pond.cx, pond.cz);
        if (centerFloor === undefined) continue;
        const enclosed = this.enclosedPondColumns(pond, centerFloor);
        if (!enclosed) continue;
        this.fillPondInChunk(chunk, enclosed, centerFloor);
      }
    }
  }

  /**
   * Deterministic solid query in world coordinates. Does not treat an
   * ungenerated neighbor chunk as a wall — cave air on the other side of a
   * chunk border is still Air.
   */
  terrainSolid(x: number, y: number, z: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const surface = this.columnAt(x, z).height;
    const floor = this.bedrockHeight(x, z);
    if (y <= floor) return true;
    if (y <= stoneCapY(floor)) return true;
    if (y > surface) return false;
    return !this.isCave(x, y, z, surface);
  }

  /**
   * Flat cave-floor columns inside the irregular ellipse. Columns on a drop
   * (different `caveFloorStoneY`) are excluded instead of being filled.
   */
  private collectFlatPondColumns(pond: LavaPondPlan, centerFloor: number): LavaPondColumn[] {
    const reach = Math.ceil(pond.radius + 2);
    const columns: LavaPondColumn[] = [];
    for (let wz = pond.cz - reach; wz <= pond.cz + reach; wz += 1) {
      for (let wx = pond.cx - reach; wx <= pond.cx + reach; wx += 1) {
        if (!this.inPondFootprint(wx, wz, pond)) continue;
        if (this.caveFloorStoneY(wx, wz) !== centerFloor) continue;
        const cap = stoneCapY(this.bedrockHeight(wx, wz));
        const depth = Math.min(pond.depth, centerFloor - (cap + 1), LAVA_POND_MAX_DEPTH);
        if (depth < 1) continue;
        const bottom = centerFloor - depth;
        if (!this.terrainSolid(wx, centerFloor, wz)) continue;
        if (!this.terrainSolid(wx, bottom - 1, wz)) continue;
        columns.push({ x: wx, z: wz, depth });
      }
    }
    return columns;
  }

  private pondColumnLeaks(
    column: LavaPondColumn,
    centerFloor: number,
    depths: ReadonlyMap<string, number>,
  ): boolean {
    const lavaTop = centerFloor - 1;
    const lavaBottom = centerFloor - column.depth;
    if (!this.terrainSolid(column.x, lavaBottom - 1, column.z)) return true;
    for (let y = lavaBottom; y <= lavaTop; y += 1) {
      for (const [dx, dz] of HORIZONTAL_NEIGHBORS) {
        const nx = column.x + dx;
        const nz = column.z + dz;
        const neighborDepth = depths.get(`${nx},${nz}`);
        if (neighborDepth !== undefined) {
          const neighborBottom = centerFloor - neighborDepth;
          if (y >= neighborBottom && y <= lavaTop) continue;
        }
        if (!this.terrainSolid(nx, y, nz)) return true;
      }
    }
    for (const [dx, dz] of HORIZONTAL_NEIGHBORS) {
      const nx = column.x + dx;
      const nz = column.z + dz;
      if (depths.has(`${nx},${nz}`)) continue;
      if (!this.terrainSolid(nx, centerFloor, nz)) return true;
    }
    return false;
  }

  private largestPondComponent(columns: readonly LavaPondColumn[]): LavaPondColumn[] {
    if (columns.length === 0) return [];
    const byKey = new Map<string, LavaPondColumn>(
      columns.map((column) => [`${column.x},${column.z}`, column]),
    );
    const seen = new Set<string>();
    let best: LavaPondColumn[] = [];
    for (const start of columns) {
      const startKey = `${start.x},${start.z}`;
      if (seen.has(startKey)) continue;
      const stack = [start];
      const component: LavaPondColumn[] = [];
      seen.add(startKey);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        component.push(cur);
        for (const [dx, dz] of HORIZONTAL_NEIGHBORS) {
          const key = `${cur.x + dx},${cur.z + dz}`;
          if (seen.has(key) || !byKey.has(key)) continue;
          seen.add(key);
          stack.push(byKey.get(key)!);
        }
      }
      if (component.length > best.length) best = component;
    }
    return best;
  }

  /**
   * Shrink leaking perimeter cells until the remaining footprint is a closed
   * Stone basin, or reject the candidate. Never builds an artificial box.
   */
  private enclosedPondColumns(pond: LavaPondPlan, centerFloor: number): LavaPondColumn[] | undefined {
    let remaining = this.collectFlatPondColumns(pond, centerFloor);
    if (remaining.length < LAVA_POND_MIN_COLUMNS) return undefined;
    for (let iter = 0; iter < 24; iter += 1) {
      const depths = new Map<string, number>(
        remaining.map((column) => [`${column.x},${column.z}`, column.depth]),
      );
      const kept = remaining.filter((column) => !this.pondColumnLeaks(column, centerFloor, depths));
      if (kept.length === remaining.length) {
        const connected = this.largestPondComponent(kept);
        return connected.length >= LAVA_POND_MIN_COLUMNS ? connected : undefined;
      }
      remaining = kept;
      if (remaining.length < LAVA_POND_MIN_COLUMNS) return undefined;
    }
    return undefined;
  }

  private fillPondInChunk(chunk: Chunk, columns: readonly LavaPondColumn[], centerFloor: number): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const capY = STONE_CAP_TOP_Y;
    for (const column of columns) {
      const lx = column.x - worldX;
      const lz = column.z - worldZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const above = chunk.get(lx, centerFloor + 1, lz);
      const floor = chunk.get(lx, centerFloor, lz);
      if (above !== BlockId.Air && above !== BlockId.Lava) continue;
      if (!this.carvableBasinBlock(floor)) continue;
      const stack: number[] = [];
      for (let d = 1; d <= column.depth; d += 1) {
        const y = centerFloor - d;
        if (y <= capY) break;
        const here = chunk.get(lx, y, lz);
        if (!this.carvableBasinBlock(here)) break;
        stack.push(y);
      }
      if (stack.length === 0) continue;
      const bottom = stack[stack.length - 1]!;
      const support = chunk.get(lx, bottom - 1, lz);
      if (!this.solidSupportBlock(support)) continue;
      let otherLava = false;
      for (let y = 1; y <= LAVA_POND_MAX_SURFACE_Y + 1; y += 1) {
        if (y === centerFloor || stack.includes(y)) continue;
        if (chunk.get(lx, y, lz) === BlockId.Lava) otherLava = true;
      }
      if (otherLava) continue;
      chunk.set(lx, centerFloor, lz, BlockId.Air);
      for (const y of stack) chunk.set(lx, y, lz, BlockId.Lava);
    }
  }

  private carvableBasinBlock(block: BlockId): boolean {
    if (block === BlockId.Lava) return true;
    if (block === BlockId.Air || block === BlockId.Water || block === BlockId.Bedrock) return false;
    const definition = getBlockDefinition(block);
    return definition.solid === true && definition.liquid !== true;
  }

  private solidSupportBlock(block: BlockId): boolean {
    if (block === BlockId.Air || block === BlockId.Water || block === BlockId.Lava) return false;
    return getBlockDefinition(block).solid === true && getBlockDefinition(block).liquid !== true;
  }

  private generateOres(chunk: Chunk): void {
    const rng = mulberry32(hashCoords(this.numericSeed + 991, chunk.x, 0, chunk.z));
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    for (const ore of ORE_RULES) {
      if (ore.spawnChance !== undefined && rng() > ore.spawnChance) continue;
      let veins = ore.veins;
      if ((ore.extraVeinChance ?? 0) > 0 && rng() < (ore.extraVeinChance ?? 0)) veins += 1;
      for (let vein = 0; vein < veins; vein += 1) {
        let x = Math.floor(rng() * CHUNK_SIZE);
        let y = ore.minY + Math.floor(rng() * (ore.maxY - ore.minY + 1));
        let z = Math.floor(rng() * CHUNK_SIZE);
        for (let step = 0; step < ore.size; step += 1) {
          const wx = worldX + x;
          const wz = worldZ + z;
          if (y > stoneCapY(this.bedrockHeight(wx, wz)) && chunk.get(x, y, z) === BlockId.Stone) {
            chunk.set(x, y, z, ore.block);
          }
          x = Math.max(0, Math.min(CHUNK_SIZE - 1, x + Math.floor(rng() * 3) - 1));
          y = Math.max(ore.minY, Math.min(ore.maxY, y + Math.floor(rng() * 3) - 1));
          z = Math.max(0, Math.min(CHUNK_SIZE - 1, z + Math.floor(rng() * 3) - 1));
        }
      }
    }
  }

  private caveDepositPlan(cellX: number, cellY: number, cellZ: number): CaveDepositPlan | undefined {
    if (random01(this.numericSeed + 12_101, cellX, cellY, cellZ) > CAVE_DEPOSIT_CHANCE) return undefined;
    const cx = cellX * CAVE_DEPOSIT_CELL_XZ
      + Math.floor(random01(this.numericSeed + 12_102, cellX, cellY, cellZ) * CAVE_DEPOSIT_CELL_XZ);
    const cy = cellY * CAVE_DEPOSIT_CELL_Y
      + Math.floor(random01(this.numericSeed + 12_103, cellX, cellY, cellZ) * CAVE_DEPOSIT_CELL_Y);
    const cz = cellZ * CAVE_DEPOSIT_CELL_XZ
      + Math.floor(random01(this.numericSeed + 12_104, cellX, cellY, cellZ) * CAVE_DEPOSIT_CELL_XZ);
    if (cy < CAVE_DEPOSIT_MIN_Y || cy > CAVE_DEPOSIT_MAX_Y) return undefined;
    const gravel = random01(this.numericSeed + 12_105, cellX, cellY, cellZ) < 0.64;
    const size = random01(this.numericSeed + 12_106, cellX, cellY, cellZ);
    const stretch = random01(this.numericSeed + 12_107, cellX, cellY, cellZ);
    const baseRadius = gravel ? 2.35 + size * 1.05 : 1.85 + size * 0.85;
    return {
      cellX,
      cellY,
      cellZ,
      kind: gravel ? 'gravel' : 'clay',
      block: gravel ? BlockId.Gravel : BlockId.Clay,
      cx,
      cy,
      cz,
      radiusX: baseRadius * (0.86 + stretch * 0.26),
      radiusY: gravel ? 1.25 + size * 0.85 : 1.15 + size * 0.65,
      radiusZ: baseRadius * (1.12 - stretch * 0.26),
    };
  }

  /** Ores run first; this pass can replace only remaining natural Stone. */
  private generateCaveDeposits(chunk: Chunk): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const minCellX = Math.floor((worldX - CAVE_DEPOSIT_MAX_RADIUS_XZ) / CAVE_DEPOSIT_CELL_XZ);
    const maxCellX = Math.floor((worldX + CHUNK_SIZE - 1 + CAVE_DEPOSIT_MAX_RADIUS_XZ) / CAVE_DEPOSIT_CELL_XZ);
    const minCellY = Math.floor((CAVE_DEPOSIT_MIN_Y - CAVE_DEPOSIT_MAX_RADIUS_Y) / CAVE_DEPOSIT_CELL_Y);
    const maxCellY = Math.floor((CAVE_DEPOSIT_MAX_Y + CAVE_DEPOSIT_MAX_RADIUS_Y) / CAVE_DEPOSIT_CELL_Y);
    const minCellZ = Math.floor((worldZ - CAVE_DEPOSIT_MAX_RADIUS_XZ) / CAVE_DEPOSIT_CELL_XZ);
    const maxCellZ = Math.floor((worldZ + CHUNK_SIZE - 1 + CAVE_DEPOSIT_MAX_RADIUS_XZ) / CAVE_DEPOSIT_CELL_XZ);
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const plan = this.caveDepositPlan(cellX, cellY, cellZ);
          if (!plan) continue;
          if (plan.cx + plan.radiusX < worldX || plan.cx - plan.radiusX >= worldX + CHUNK_SIZE) continue;
          if (plan.cz + plan.radiusZ < worldZ || plan.cz - plan.radiusZ >= worldZ + CHUNK_SIZE) continue;
          this.placeCaveDeposit(chunk, plan);
        }
      }
    }
  }

  private placeCaveDeposit(chunk: Chunk, plan: CaveDepositPlan): void {
    const worldX = chunk.x * CHUNK_SIZE;
    const worldZ = chunk.z * CHUNK_SIZE;
    const voxels = this.caveDepositVoxels(plan);
    for (const voxel of voxels) {
      const localX = voxel.x - worldX;
      const localZ = voxel.z - worldZ;
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) continue;
      if (chunk.get(localX, voxel.y, localZ) !== BlockId.Stone) continue;
      if (this.touchesFluidInChunk(chunk, localX, voxel.y, localZ)) continue;
      if (plan.kind === 'gravel') {
        const below = chunk.get(localX, voxel.y - 1, localZ) as BlockId;
        if (!this.solidSupportBlock(below)) continue;
      }
      chunk.set(localX, voxel.y, localZ, plan.block);
    }
  }

  private caveDepositVoxels(plan: CaveDepositPlan): readonly CaveDepositVoxel[] {
    const cacheKey = `${plan.cellX},${plan.cellY},${plan.cellZ}`;
    const cached = this.caveDepositCache.get(cacheKey);
    if (cached !== undefined) return cached ?? [];
    const minX = Math.floor(plan.cx - plan.radiusX);
    const maxX = Math.ceil(plan.cx + plan.radiusX);
    const minY = Math.max(CAVE_DEPOSIT_MIN_Y, Math.floor(plan.cy - plan.radiusY));
    const maxY = Math.min(CAVE_DEPOSIT_MAX_Y, Math.ceil(plan.cy + plan.radiusY));
    const minZ = Math.floor(plan.cz - plan.radiusZ);
    const maxZ = Math.ceil(plan.cz + plan.radiusZ);
    const rawColumns = new Map<string, ColumnInfo>();
    for (let z = minZ - 2; z <= maxZ + 2; z += 1) {
      for (let x = minX - 2; x <= maxX + 2; x += 1) {
        rawColumns.set(`${x},${z}`, this.caveColumnAt(x, z));
      }
    }
    const columns = new Map<string, ColumnInfo & { readonly roof: number; readonly cap: number }>();
    for (let z = minZ - 1; z <= maxZ + 1; z += 1) {
      for (let x = minX - 1; x <= maxX + 1; x += 1) {
        const column = rawColumns.get(`${x},${z}`)!;
        let roof = column.height;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            roof = Math.min(roof, rawColumns.get(`${x + dx},${z + dz}`)!.height);
          }
        }
        columns.set(`${x},${z}`, {
          ...column,
          roof: roof - CAVE_ROOF_DEPTH,
          cap: stoneCapY(this.bedrockHeight(x, z)),
        });
      }
    }
    const naturalAir = (x: number, y: number, z: number): boolean => {
      const column = columns.get(`${x},${z}`);
      if (!column || y <= column.cap || y > column.roof) return false;
      return this.isCave(x, y, z, column.height);
    };
    const naturalStone = (x: number, y: number, z: number): boolean => {
      const column = columns.get(`${x},${z}`);
      if (!column || y <= column.cap) return false;
      const soilDepth = column.biome === 'desert' ? 4 : 3;
      return y < column.height - soilDepth && !naturalAir(x, y, z);
    };
    const candidates: CaveDepositVoxel[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = (x - plan.cx) / plan.radiusX;
          const dy = (y - plan.cy) / plan.radiusY;
          const dz = (z - plan.cz) / plan.radiusZ;
          const warp = 0.88 + random01(this.numericSeed + 12_108, x, y, z) * 0.24;
          if (dx * dx + dy * dy + dz * dz > warp || !naturalStone(x, y, z)) continue;
          const caveSurface = ([
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
          ] as const).some(([ox, oy, oz]) => naturalAir(x + ox, y + oy, z + oz));
          if (!caveSurface) continue;
          if (plan.kind === 'gravel' && !naturalStone(x, y - 1, z)) continue;
          candidates.push({ x, y, z });
        }
      }
    }
    const largest = this.largestVoxelComponent(candidates);
    const minimum = plan.kind === 'gravel' ? 6 : 4;
    const maximum = plan.kind === 'gravel' ? 18 : 10;
    const result = largest.length < minimum ? [] : this.connectedVoxelSubset(largest, plan, maximum);
    if (this.caveDepositCache.size >= 512) {
      const oldest = this.caveDepositCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.caveDepositCache.delete(oldest);
    }
    this.caveDepositCache.set(cacheKey, result.length > 0 ? result : null);
    return result;
  }

  private largestVoxelComponent(voxels: readonly CaveDepositVoxel[]): CaveDepositVoxel[] {
    const byKey = new Map(voxels.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));
    const seen = new Set<string>();
    let largest: CaveDepositVoxel[] = [];
    for (const voxel of voxels) {
      const start = `${voxel.x},${voxel.y},${voxel.z}`;
      if (seen.has(start)) continue;
      const stack = [voxel];
      const component: CaveDepositVoxel[] = [];
      seen.add(start);
      while (stack.length > 0) {
        const current = stack.pop()!;
        component.push(current);
        for (const [dx, dy, dz] of [
          [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
        ] as const) {
          const key = `${current.x + dx},${current.y + dy},${current.z + dz}`;
          if (seen.has(key) || !byKey.has(key)) continue;
          seen.add(key);
          stack.push(byKey.get(key)!);
        }
      }
      if (component.length > largest.length) largest = component;
    }
    return largest;
  }

  private connectedVoxelSubset(
    component: readonly CaveDepositVoxel[],
    plan: CaveDepositPlan,
    maximum: number,
  ): CaveDepositVoxel[] {
    if (component.length <= maximum) return [...component];
    const byKey = new Map(component.map((voxel) => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));
    const start = [...component].sort((a, b) => {
      const da = (a.x - plan.cx) ** 2 + (a.y - plan.cy) ** 2 + (a.z - plan.cz) ** 2;
      const db = (b.x - plan.cx) ** 2 + (b.y - plan.cy) ** 2 + (b.z - plan.cz) ** 2;
      return da - db || random01(this.numericSeed + 12_109, a.x, a.y, a.z)
        - random01(this.numericSeed + 12_109, b.x, b.y, b.z);
    })[0]!;
    const queue = [start];
    const selected: CaveDepositVoxel[] = [];
    const seen = new Set([`${start.x},${start.y},${start.z}`]);
    while (queue.length > 0 && selected.length < maximum) {
      const current = queue.shift()!;
      selected.push(current);
      const neighbors: CaveDepositVoxel[] = [];
      for (const [dx, dy, dz] of [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      ] as const) {
        const key = `${current.x + dx},${current.y + dy},${current.z + dz}`;
        const neighbor = byKey.get(key);
        if (!neighbor || seen.has(key)) continue;
        seen.add(key);
        neighbors.push(neighbor);
      }
      neighbors.sort((a, b) => random01(this.numericSeed + 12_110, a.x, a.y, a.z)
        - random01(this.numericSeed + 12_110, b.x, b.y, b.z));
      queue.push(...neighbors);
    }
    return selected;
  }

  private touchesFluidInChunk(chunk: Chunk, x: number, y: number, z: number): boolean {
    for (const [dx, dy, dz] of [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ] as const) {
      const block = chunk.get(x + dx, y + dy, z + dz);
      if (block === BlockId.Lava || block === BlockId.Water) return true;
    }
    return false;
  }

  private decorate(chunk: Chunk): void {
    const rng = mulberry32(hashCoords(this.numericSeed + 1601, chunk.x, 0, chunk.z));
    const attempts = 10;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const x = 2 + Math.floor(rng() * (CHUNK_SIZE - 4));
      const z = 2 + Math.floor(rng() * (CHUNK_SIZE - 4));
      const worldX = chunk.x * CHUNK_SIZE + x;
      const worldZ = chunk.z * CHUNK_SIZE + z;
      const column = this.columnAt(worldX, worldZ);
      if (column.height <= SEA_LEVEL || column.height >= WORLD_HEIGHT - 8) continue;
      if (chunk.get(x, column.height, z) === BlockId.Air) continue;
      if (column.biome === 'desert') {
        if (chunk.get(x, column.height, z) !== BlockId.Sand || rng() > 0.05) continue;
        const height = 2 + Math.floor(rng() * 2);
        for (let y = 1; y <= height; y += 1) chunk.set(x, column.height + y, z, BlockId.Cactus);
      } else {
        const expectedSurface = column.biome === 'snowy_plains' ? BlockId.SnowBlock : BlockId.GrassBlock;
        if (chunk.get(x, column.height, z) !== expectedSurface) continue;
        if (column.biome === 'forest' && rng() > 0.55) continue;
        if (column.biome === 'plains' && rng() > 0.10) continue;
        if (column.biome === 'snowy_plains' && rng() > 0.02) continue;
        const grove = fbm2D(this.numericSeed + 1703, worldX / 42, worldZ / 42, 2);
        if (column.biome === 'forest' && grove < -0.35 && rng() > 0.5) continue;
        const kind: TreeKind = column.biome === 'snowy_plains'
          ? 'spruce'
          : column.biome === 'plains'
            ? 'oak'
            : this.forestTreeKind(rng());
        const height = kind === 'oak'
          ? 4 + Math.floor(rng() * 2)
          : kind === 'birch'
            ? 5 + Math.floor(rng() * 3)
            : 6 + Math.floor(rng() * 3);
        this.placeTree(chunk, x, column.height + 1, z, kind, height);
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
      if (column.biome === 'snowy_plains') continue;
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

  private forestTreeKind(roll: number): TreeKind {
    return roll < 1 / 3 ? 'oak' : roll < 2 / 3 ? 'birch' : 'spruce';
  }

  private placeTree(chunk: Chunk, x: number, y: number, z: number, kind: TreeKind, height: number): boolean {
    const blocks = TREE_BLOCKS[kind];
    const shape = new Map<string, Readonly<{ x: number; y: number; z: number; block: BlockId }>>();
    const addLeaves = (dy: number, radius: number, rounded = false): void => {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (rounded && radius > 1 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          const px = x + dx;
          const py = y + height + dy;
          const pz = z + dz;
          shape.set(`${px},${py},${pz}`, { x: px, y: py, z: pz, block: blocks.leaves });
        }
      }
    };
    if (kind === 'oak') {
      for (let dy = -2; dy <= 1; dy += 1) addLeaves(dy, dy >= 1 ? 1 : 2, dy !== 0);
    } else if (kind === 'birch') {
      addLeaves(-2, 1);
      addLeaves(-1, 1);
      addLeaves(0, 1);
      addLeaves(1, 0);
    } else {
      addLeaves(-5, 1);
      addLeaves(-4, 2, true);
      addLeaves(-3, 1);
      addLeaves(-2, 2, true);
      addLeaves(-1, 1);
      addLeaves(0, 0);
    }
    for (let offset = 0; offset < height; offset += 1) {
      shape.set(`${x},${y + offset},${z}`, { x, y: y + offset, z, block: blocks.log });
    }
    for (const entry of shape.values()) {
      if (entry.y < 0 || entry.y >= WORLD_HEIGHT) return false;
      const existing = chunk.get(entry.x, entry.y, entry.z) as BlockId;
      if (existing !== BlockId.Air && getBlockDefinition(existing).replaceable !== true) return false;
    }
    for (const entry of shape.values()) chunk.set(entry.x, entry.y, entry.z, entry.block);
    return true;
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
