import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator, type Biome } from '../src/world/Generator';
import {
  GOURD_PATCH_CELL,
  MELON_DECORATION_SALT,
  PUMPKIN_DECORATION_SALT,
  planGourdPatch,
} from '../src/world/gourdDecorations';
import { WORLDGEN_QA_SEEDS } from '../src/world/worldgenMetrics';

const SPAN = 2048;
const STEP = 8;
const seeds = WORLDGEN_QA_SEEDS.slice(0, 8);

interface WaterStats {
  columns: number;
  water: number;
  lake: number;
  ocean: number;
  land: number;
  depths: number[];
  shoreline: number;
  biomes: Record<Biome, number>;
  landBiomes: Record<Biome, number>;
  oceanComponents: number[];
  lakeComponents: number[];
}

function emptyBiomes(): Record<Biome, number> {
  return { plains: 0, forest: 0, desert: 0, snowy_plains: 0 };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function componentSizes(cells: ReadonlySet<string>, step: number): number[] {
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let size = 0;
    while (stack.length > 0) {
      const [x, z] = stack.pop()!.split(',').map(Number) as [number, number];
      size += 1;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
        const key = `${x + dx},${z + dz}`;
        if (!cells.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push(key);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

function sampleSeed(seed: string): WaterStats {
  const generator = new TerrainGenerator(seed);
  const stats: WaterStats = {
    columns: 0,
    water: 0,
    lake: 0,
    ocean: 0,
    land: 0,
    depths: [],
    shoreline: 0,
    biomes: emptyBiomes(),
    landBiomes: emptyBiomes(),
    oceanComponents: [],
    lakeComponents: [],
  };
  const oceanCells = new Set<string>();
  const lakeCells = new Set<string>();
  const height = new Map<string, number>();
  for (let z = -SPAN / 2; z < SPAN / 2; z += STEP) {
    for (let x = -SPAN / 2; x < SPAN / 2; x += STEP) {
      const column = generator.columnAt(x, z);
      const key = `${x},${z}`;
      height.set(key, column.height);
      stats.columns += 1;
      stats.biomes[column.biome] += 1;
      if (column.height < SEA_LEVEL) {
        stats.water += 1;
        stats.depths.push(SEA_LEVEL - column.height);
      } else {
        stats.land += 1;
        stats.landBiomes[column.biome] += 1;
      }
      if (column.waterBiome === 'ocean') {
        stats.ocean += 1;
        oceanCells.add(key);
      } else if (column.waterBiome === 'lake') {
        stats.lake += 1;
        lakeCells.add(key);
      }
    }
  }
  for (const [key, surface] of height) {
    if (surface >= SEA_LEVEL) continue;
    const [x, z] = key.split(',').map(Number) as [number, number];
    const neighbors = [
      height.get(`${x + STEP},${z}`),
      height.get(`${x - STEP},${z}`),
      height.get(`${x},${z + STEP}`),
      height.get(`${x},${z - STEP}`),
    ];
    if (neighbors.some((value) => value !== undefined && value >= SEA_LEVEL)) stats.shoreline += 1;
  }
  stats.oceanComponents = componentSizes(oceanCells, STEP);
  stats.lakeComponents = componentSizes(lakeCells, STEP);
  return stats;
}

function sampleGourds() {
  const pumpkin = { patches: 0, fruits: 0, plains: 0, forest: 0, sizes: [] as number[] };
  const melon = { patches: 0, fruits: 0, plains: 0, forest: 0, sizes: [] as number[] };
  let plainsCells = 0;
  let forestCells = 0;
  let suitablePumpkinChunks = 0;
  let suitableMelonChunks = 0;
  const cellSpan = Math.floor(SPAN / GOURD_PATCH_CELL);
  for (const seed of seeds) {
    const generator = new TerrainGenerator(seed);
    for (let cellZ = -cellSpan / 2; cellZ < cellSpan / 2; cellZ += 1) {
      for (let cellX = -cellSpan / 2; cellX < cellSpan / 2; cellX += 1) {
        const cx = cellX * GOURD_PATCH_CELL + 16;
        const cz = cellZ * GOURD_PATCH_CELL + 16;
        const column = generator.columnAt(cx, cz);
        if (column.biome === 'plains') plainsCells += 1;
        if (column.biome === 'forest') forestCells += 1;
        const pumpkinPatch = planGourdPatch(generator, PUMPKIN_DECORATION_SALT, 'pumpkin', cellX, cellZ);
        const melonPatch = planGourdPatch(generator, MELON_DECORATION_SALT, 'melon', cellX, cellZ);
        if (pumpkinPatch) {
          pumpkin.patches += 1;
          pumpkin.fruits += pumpkinPatch.count;
          pumpkin.sizes.push(pumpkinPatch.count);
          pumpkin[column.biome === 'forest' ? 'forest' : 'plains'] += 1;
        }
        if (melonPatch) {
          melon.patches += 1;
          melon.fruits += melonPatch.count;
          melon.sizes.push(melonPatch.count);
          melon[column.biome === 'forest' ? 'forest' : 'plains'] += 1;
        }
      }
    }
  }
  suitablePumpkinChunks = plainsCells * 4 + forestCells * 4;
  suitableMelonChunks = forestCells * 4 + plainsCells * 4;
  return {
    pumpkin: {
      patches: pumpkin.patches,
      fruits: pumpkin.fruits,
      avgPatchSize: Number(mean(pumpkin.sizes).toFixed(3)),
      patchesPerSuitableChunk: Number((pumpkin.patches / Math.max(1, suitablePumpkinChunks)).toFixed(4)),
      biomeDistribution: { plains: pumpkin.plains, forest: pumpkin.forest },
    },
    melon: {
      patches: melon.patches,
      fruits: melon.fruits,
      avgPatchSize: Number(mean(melon.sizes).toFixed(3)),
      patchesPerSuitableChunk: Number((melon.patches / Math.max(1, suitableMelonChunks)).toFixed(4)),
      biomeDistribution: { plains: melon.plains, forest: melon.forest },
    },
  };
}

function samplePlacedFruit() {
  const pumpkin = { total: 0, plains: 0, forest: 0, underwater: 0 };
  const melon = { total: 0, plains: 0, forest: 0, underwater: 0 };
  const radius = 6;
  for (const seed of seeds.slice(0, 4)) {
    const generator = new TerrainGenerator(seed);
    for (let cz = -radius; cz <= radius; cz += 1) {
      for (let cx = -radius; cx <= radius; cx += 1) {
        const chunk = new Chunk(cx, cz);
        generator.generate(chunk);
        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;
            const column = generator.columnAt(wx, wz);
            const fruit = chunk.get(x, column.height + 1, z);
            if (fruit !== BlockId.Pumpkin && fruit !== BlockId.Melon) continue;
            const bucket = fruit === BlockId.Pumpkin ? pumpkin : melon;
            bucket.total += 1;
            if (column.biome === 'plains' || column.biome === 'forest') bucket[column.biome] += 1;
            if (column.height < SEA_LEVEL || column.waterBiome !== 'none') bucket.underwater += 1;
          }
        }
      }
    }
  }
  return { pumpkin, melon, chunkRadius: radius, seeds: seeds.slice(0, 4) };
}

function timedGenerate(seed: string, predicate: (column: ReturnType<TerrainGenerator['columnAt']>) => boolean): number {
  const generator = new TerrainGenerator(seed);
  let cx = 0;
  let cz = 0;
  for (let z = -32; z <= 32; z += 1) {
    for (let x = -32; x <= 32; x += 1) {
      if (!predicate(generator.columnAt(x * 16 + 8, z * 16 + 8))) continue;
      cx = x;
      cz = z;
      break;
    }
  }
  const chunk = new Chunk(cx, cz);
  const start = performance.now();
  generator.generate(chunk);
  return performance.now() - start;
}

const perSeed = seeds.map((seed) => ({ seed, ...sampleSeed(seed) }));
const totals = perSeed.reduce((acc, stats) => {
  acc.columns += stats.columns;
  acc.water += stats.water;
  acc.lake += stats.lake;
  acc.ocean += stats.ocean;
  acc.land += stats.land;
  acc.shoreline += stats.shoreline;
  acc.depths.push(...stats.depths);
  for (const biome of Object.keys(acc.biomes) as Biome[]) {
    acc.biomes[biome] += stats.biomes[biome];
    acc.landBiomes[biome] += stats.landBiomes[biome];
  }
  acc.oceanComponents.push(...stats.oceanComponents);
  acc.lakeComponents.push(...stats.lakeComponents);
  return acc;
}, {
  columns: 0,
  water: 0,
  lake: 0,
  ocean: 0,
  land: 0,
  shoreline: 0,
  depths: [] as number[],
  biomes: emptyBiomes(),
  landBiomes: emptyBiomes(),
  oceanComponents: [] as number[],
  lakeComponents: [] as number[],
});

const gourds = sampleGourds();
const placed = samplePlacedFruit();
const landMs = seeds.map((seed) => timedGenerate(seed, (column) => column.waterMask <= 0));
const waterMs = seeds.map((seed) => timedGenerate(seed, (column) => column.waterBiome === 'ocean'));
const batchStart = performance.now();
{
  const generator = new TerrainGenerator('batch-81');
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const chunk = new Chunk(x, z);
      generator.generate(chunk);
    }
  }
}
const batchMs = performance.now() - batchStart;

const share = (count: number): number => Number((count * 100 / Math.max(1, totals.columns)).toFixed(3));
const landShare = (count: number): number => Number((count * 100 / Math.max(1, totals.land)).toFixed(3));

console.log(JSON.stringify({
  inputs: { seeds, span: SPAN, step: STEP, sampledColumns: totals.columns },
  water: {
    totalPercent: share(totals.water),
    lakeClassifiedPercent: share(totals.lake),
    oceanClassifiedPercent: share(totals.ocean),
    landPercent: share(totals.land),
    shorelinePercent: share(totals.shoreline),
    avgDepth: Number(mean(totals.depths).toFixed(3)),
    p95Depth: percentile(totals.depths, 0.95),
    maxDepth: totals.depths.length > 0 ? Math.max(...totals.depths) : 0,
    largestOceanCells: totals.oceanComponents.length > 0 ? Math.max(...totals.oceanComponents) : 0,
    largestLakeCells: totals.lakeComponents.length > 0 ? Math.max(...totals.lakeComponents) : 0,
    oceanComponents: totals.oceanComponents.length,
    lakeComponents: totals.lakeComponents.length,
  },
  landBiomes: Object.fromEntries((Object.keys(totals.landBiomes) as Biome[]).map((biome) => [biome, {
    count: totals.landBiomes[biome],
    landPercent: landShare(totals.landBiomes[biome]),
  }])),
  gourds,
  placedFruit: placed,
  performance: {
    landChunkAvgMs: Number(mean(landMs).toFixed(3)),
    oceanChunkAvgMs: Number(mean(waterMs).toFixed(3)),
    batch81Ms: Number(batchMs.toFixed(3)),
  },
  perSeed: perSeed.map((stats) => ({
    seed: stats.seed,
    waterPercent: Number((stats.water * 100 / stats.columns).toFixed(3)),
    lakePercent: Number((stats.lake * 100 / stats.columns).toFixed(3)),
    oceanPercent: Number((stats.ocean * 100 / stats.columns).toFixed(3)),
    largestOcean: stats.oceanComponents.length > 0 ? Math.max(...stats.oceanComponents) : 0,
    largestLake: stats.lakeComponents.length > 0 ? Math.max(...stats.lakeComponents) : 0,
  })),
}, null, 2));
