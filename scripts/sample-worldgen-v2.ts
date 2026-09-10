import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../src/core/constants';
import { Chunk } from '../src/world/Chunk';
import {
  BIOME_CODES,
  CAVE_DEPOSIT_MAX_Y,
  CAVE_DEPOSIT_MIN_Y,
  SNOWY_THRESHOLD,
  TerrainGenerator,
  type Biome,
} from '../src/world/Generator';
import { WORLDGEN_QA_SEEDS } from '../src/world/worldgenMetrics';

const BIOME_SPAN = 2048;
const BIOME_STEP = 8;
const CHUNK_RADIUS = 4;
const seeds = WORLDGEN_QA_SEEDS.slice(0, 8);
const biomeCounts: Record<Biome, number> = { plains: 0, forest: 0, desert: 0, snowy_plains: 0 };
const biomeExamples: Partial<Record<Biome, { seed: string; x: number; z: number; height: number }>> = {};
const frozenWaterProbe = new TerrainGenerator('alpha').columnAt(2624, -2996);
let frozenWaterExample: { seed: string; x: number; z: number; height: number } | undefined =
  frozenWaterProbe.biome === 'snowy_plains' && frozenWaterProbe.height <= SEA_LEVEL - 2
    ? { seed: 'alpha', x: 2624, z: -2996, height: frozenWaterProbe.height }
    : undefined;
let landColumns = 0;
const snowyComponents: number[] = [];

for (const seed of seeds) {
  const generator = new TerrainGenerator(seed);
  const snowy = new Set<string>();
  for (let z = -BIOME_SPAN / 2; z < BIOME_SPAN / 2; z += BIOME_STEP) {
    for (let x = -BIOME_SPAN / 2; x < BIOME_SPAN / 2; x += BIOME_STEP) {
      const column = generator.columnAt(x, z);
      if (column.biome === 'snowy_plains' && column.height <= SEA_LEVEL - 2 && !frozenWaterExample) {
        frozenWaterExample = { seed, x, z, height: column.height };
      }
      if (column.height <= SEA_LEVEL) continue;
      biomeExamples[column.biome] ??= { seed, x, z, height: column.height };
      landColumns += 1;
      biomeCounts[column.biome] += 1;
      if (column.biome === 'snowy_plains' && x % CHUNK_SIZE === 0 && z % CHUNK_SIZE === 0) {
        snowy.add(`${x / CHUNK_SIZE},${z / CHUNK_SIZE}`);
      }
    }
  }
  snowyComponents.push(...componentSizes2d(snowy));
}

const forestTrees = { oak: 0, birch: 0, spruce: 0 };
let snowyTrees = 0;
let snowyInteriorTrees = 0;
let snowyInteriorChunks = 0;
let snowyColumns = 0;
let forestColumnsWithTrees = 0;
let forestColumns = 0;
let snowyColumnsWithTrees = 0;
const depositBlocks = { gravel: 0, clay: 0 };
const depositChunks = { gravel: 0, clay: 0 };
const depositComponents = { gravel: [] as number[], clay: [] as number[] };

for (const seed of seeds) {
  const generator = new TerrainGenerator(seed);
  const chunks = new Map<string, Chunk>();
  for (let cz = -CHUNK_RADIUS; cz <= CHUNK_RADIUS; cz += 1) {
    for (let cx = -CHUNK_RADIUS; cx <= CHUNK_RADIUS; cx += 1) {
      const chunk = new Chunk(cx, cz);
      generator.generate(chunk);
      chunks.set(`${cx},${cz}`, chunk);
      const snowyInterior = chunk.biomeCodes.every((code) => code === BIOME_CODES.snowy_plains);
      if (snowyInterior) snowyInteriorChunks += 1;
      let hasGravel = false;
      let hasClay = false;
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const wx = cx * CHUNK_SIZE + x;
          const wz = cz * CHUNK_SIZE + z;
          const column = generator.columnAt(wx, wz);
          const root = chunk.get(x, column.height + 1, z);
          if (column.biome === 'forest') {
            forestColumns += 1;
            if (root === BlockId.OakLog) { forestTrees.oak += 1; forestColumnsWithTrees += 1; }
            if (root === BlockId.BirchLog) { forestTrees.birch += 1; forestColumnsWithTrees += 1; }
            if (root === BlockId.SpruceLog) { forestTrees.spruce += 1; forestColumnsWithTrees += 1; }
          } else if (column.biome === 'snowy_plains') {
            snowyColumns += 1;
            if (root === BlockId.SpruceLog) {
              snowyTrees += 1;
              if (snowyInterior) snowyInteriorTrees += 1;
              snowyColumnsWithTrees += 1;
            }
          }
          for (let y = CAVE_DEPOSIT_MIN_Y; y <= CAVE_DEPOSIT_MAX_Y; y += 1) {
            const block = chunk.get(x, y, z);
            if (block === BlockId.Gravel) { depositBlocks.gravel += 1; hasGravel = true; }
            if (block === BlockId.Clay) { depositBlocks.clay += 1; hasClay = true; }
          }
        }
      }
      if (hasGravel) depositChunks.gravel += 1;
      if (hasClay) depositChunks.clay += 1;
    }
  }
  depositComponents.gravel.push(...componentSizes3d(chunks, BlockId.Gravel));
  depositComponents.clay.push(...componentSizes3d(chunks, BlockId.Clay));
}

const totalForestTrees = forestTrees.oak + forestTrees.birch + forestTrees.spruce;
const sortedSnow = snowyComponents.sort((a, b) => a - b);
const targetedSnowy = sampleTargetedSnowyTrees();
const summary = {
  inputs: { seeds, biomeSpan: BIOME_SPAN, biomeStep: BIOME_STEP, sampledLandColumns: landColumns, chunkRadius: CHUNK_RADIUS },
  thresholds: { snowy: SNOWY_THRESHOLD },
  examples: { ...biomeExamples, frozenWater: frozenWaterExample },
  biomes: Object.fromEntries(Object.entries(biomeCounts).map(([name, count]) => [name, {
    count,
    landPercent: Number((count * 100 / Math.max(1, landColumns)).toFixed(3)),
  }])),
  snowyContiguity: {
    components: sortedSnow.length,
    medianChunks: percentile(sortedSnow, 0.5),
    p95Chunks: percentile(sortedSnow, 0.95),
    largestChunks: sortedSnow.at(-1) ?? 0,
  },
  forestTrees: {
    ...forestTrees,
    total: totalForestTrees,
    shares: Object.fromEntries(Object.entries(forestTrees).map(([name, count]) => [name, Number((count / Math.max(1, totalForestTrees)).toFixed(4))])),
    rootedColumns: forestColumnsWithTrees,
    forestColumns,
    equivalentChunks: Number((forestColumns / (CHUNK_SIZE * CHUNK_SIZE)).toFixed(3)),
    treesPerEquivalentChunk: Number((totalForestTrees * CHUNK_SIZE * CHUNK_SIZE / Math.max(1, forestColumns)).toFixed(4)),
  },
  snowyTrees: { spruce: snowyTrees, rootedColumns: snowyColumnsWithTrees, snowyColumns,
    equivalentChunks: Number((snowyColumns / (CHUNK_SIZE * CHUNK_SIZE)).toFixed(3)),
    treesPerEquivalentChunk: Number((snowyTrees * CHUNK_SIZE * CHUNK_SIZE / Math.max(1, snowyColumns)).toFixed(4)),
    interiorTrees: snowyInteriorTrees, interiorChunks: snowyInteriorChunks,
    treesPerInteriorChunk: Number((snowyInteriorTrees / Math.max(1, snowyInteriorChunks)).toFixed(4)),
    targeted: targetedSnowy },
  caveDeposits: {
    gravel: depositSummary(depositBlocks.gravel, depositChunks.gravel, depositComponents.gravel),
    clay: depositSummary(depositBlocks.clay, depositChunks.clay, depositComponents.clay),
  },
};

console.log(JSON.stringify(summary, null, 2));

function componentSizes2d(cells: Set<string>): number[] {
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
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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

function componentSizes3d(chunks: ReadonlyMap<string, Chunk>, target: BlockId): number[] {
  const cells = new Set<string>();
  for (const chunk of chunks.values()) {
    for (let y = 0; y <= chunk.scanMaxY(); y += 1) for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
      if (chunk.get(x, y, z) === target) cells.add(`${chunk.x * CHUNK_SIZE + x},${y},${chunk.z * CHUNK_SIZE + z}`);
    }
  }
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let size = 0;
    while (stack.length > 0) {
      const [x, y, z] = stack.pop()!.split(',').map(Number) as [number, number, number];
      size += 1;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const key = `${x + dx},${y + dy},${z + dz}`;
        if (!cells.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push(key);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

function depositSummary(blocks: number, chunks: number, components: readonly number[]) {
  return {
    blocks,
    caveBearingChunks: chunks,
    deposits: components.length,
    medianSize: percentile(components, 0.5),
    p95Size: percentile(components, 0.95),
    maxSize: components.length > 0 ? Math.max(...components) : 0,
  };
}

function sampleTargetedSnowyTrees() {
  let columns = 0;
  let trees = 0;
  let interiorChunks = 0;
  let interiorTrees = 0;
  for (const seed of seeds) {
    const generator = new TerrainGenerator(seed);
    const center = findBiomeChunk(generator, 'snowy_plains');
    for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const chunk = new Chunk(center.cx + dx, center.cz + dz);
      generator.generate(chunk);
      const interior = chunk.biomeCodes.every((code) => code === BIOME_CODES.snowy_plains);
      let chunkTrees = 0;
      for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) {
        if (chunk.biomeCodes[z * CHUNK_SIZE + x] !== BIOME_CODES.snowy_plains) continue;
        columns += 1;
        const wx = chunk.x * CHUNK_SIZE + x;
        const wz = chunk.z * CHUNK_SIZE + z;
        const height = generator.columnAt(wx, wz).height;
        if (chunk.get(x, height + 1, z) === BlockId.SpruceLog) { trees += 1; chunkTrees += 1; }
      }
      if (interior) { interiorChunks += 1; interiorTrees += chunkTrees; }
    }
  }
  return {
    spruce: trees,
    snowyColumns: columns,
    equivalentChunks: Number((columns / (CHUNK_SIZE * CHUNK_SIZE)).toFixed(3)),
    treesPerEquivalentChunk: Number((trees * CHUNK_SIZE * CHUNK_SIZE / Math.max(1, columns)).toFixed(4)),
    interiorTrees,
    interiorChunks,
    treesPerInteriorChunk: Number((interiorTrees / Math.max(1, interiorChunks)).toFixed(4)),
  };
}

function findBiomeChunk(generator: TerrainGenerator, biome: Biome): { cx: number; cz: number } {
  let best = { cx: 0, cz: 0, score: -1 };
  for (let cz = -64; cz <= 64; cz += 1) for (let cx = -64; cx <= 64; cx += 1) {
    let score = 0;
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (generator.columnAt((cx + dx) * CHUNK_SIZE + 8, (cz + dz) * CHUNK_SIZE + 8).biome === biome) score += 1;
    }
    if (score > best.score) best = { cx, cz, score };
    if (score === 9) return best;
  }
  if (best.score < 5) throw new Error(`No contiguous ${biome} sample for ${generator.seed}`);
  return best;
}
