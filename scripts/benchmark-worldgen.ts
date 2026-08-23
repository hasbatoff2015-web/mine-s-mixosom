import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { measureWorldgenRegion, WORLDGEN_QA_SEEDS } from '../src/world/worldgenMetrics';

interface SampleStats {
  averageMs: number;
  p95Ms: number;
  maximumMs: number;
  samples: number;
}

function summarize(samples: readonly number[]): SampleStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    averageMs: samples.reduce((sum, sample) => sum + sample, 0) / Math.max(1, samples.length),
    p95Ms: sorted[percentileIndex] ?? 0,
    maximumMs: sorted.at(-1) ?? 0,
    samples: samples.length,
  };
}

function rounded(stats: SampleStats): SampleStats {
  return {
    averageMs: Number(stats.averageMs.toFixed(3)),
    p95Ms: Number(stats.p95Ms.toFixed(3)),
    maximumMs: Number(stats.maximumMs.toFixed(3)),
    samples: stats.samples,
  };
}

function generateTimed(seed: string, cx: number, cz: number): number {
  const generator = new TerrainGenerator(seed);
  const chunk = new Chunk(cx, cz);
  const start = performance.now();
  generator.generate(chunk);
  return performance.now() - start;
}

function biomeSample(biome: 'plains' | 'forest' | 'desert'): SampleStats {
  const samples: number[] = [];
  for (const seed of WORLDGEN_QA_SEEDS) {
    const generator = new TerrainGenerator(seed);
    for (let z = -4; z <= 4 && samples.length < 12; z += 1) {
      for (let x = -4; x <= 4 && samples.length < 12; x += 1) {
        const column = generator.columnAt(x * 16 + 8, z * 16 + 8);
        if (column.biome !== biome) continue;
        samples.push(generateTimed(seed, x, z));
      }
    }
  }
  return rounded(summarize(samples));
}

const plains = biomeSample('plains');
const forest = biomeSample('forest');
const desert = biomeSample('desert');

const batchSamples: number[] = [];
{
  const generator = new TerrainGenerator('batch-81');
  const start = performance.now();
  for (let z = -4; z <= 4; z += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const chunk = new Chunk(x, z);
      generator.generate(chunk);
    }
  }
  batchSamples.push(performance.now() - start);
}

const stats = WORLDGEN_QA_SEEDS.map((seed) => {
  const region = measureWorldgenRegion(new TerrainGenerator(seed), 2);
  return { seed, ...region };
});

const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

console.log(JSON.stringify({
  generation: {
    plainsChunk: plains,
    forestChunk: forest,
    desertChunk: desert,
    batch81ChunksMs: Number(batchSamples[0]!.toFixed(3)),
  },
  sample: {
    minHeight: Math.min(...stats.map((row) => row.minHeight)),
    avgHeight: Number(avg(stats.map((row) => row.avgHeight)).toFixed(2)),
    p95Height: Number(avg(stats.map((row) => row.p95Height)).toFixed(2)),
    maxHeight: Math.max(...stats.map((row) => row.maxHeight)),
    maxMountain: Number(Math.max(...stats.map((row) => row.maxMountain)).toFixed(2)),
    elevatedShare: Number(avg(stats.map((row) => row.elevatedShare)).toFixed(3)),
    caveRatio: Number(avg(stats.map((row) => row.caveRatio)).toFixed(3)),
    caveAvgSize: Number(avg(stats.map((row) => row.caveAvgSize)).toFixed(1)),
    caveP95Size: Number(avg(stats.map((row) => row.caveP95Size)).toFixed(1)),
    caveLargest: Math.max(...stats.map((row) => row.caveLargest)),
    caveMeanWidth: Number(avg(stats.map((row) => row.caveMeanWidth)).toFixed(2)),
    treesPerForestChunk: Number((
      stats.reduce((sum, row) => sum + row.trees, 0)
      / Math.max(1, stats.reduce((sum, row) => sum + row.forestChunks, 0))
    ).toFixed(3)),
    cactusPerDesertChunk: Number((
      stats.reduce((sum, row) => sum + row.cactus, 0)
      / Math.max(1, stats.reduce((sum, row) => sum + row.desertChunks, 0))
    ).toFixed(3)),
  },
  seeds: stats.map((row) => ({
    seed: row.seed,
    minHeight: row.minHeight,
    avgHeight: Number(row.avgHeight.toFixed(2)),
    p95Height: row.p95Height,
    maxHeight: row.maxHeight,
    maxMountain: Number(row.maxMountain.toFixed(2)),
    elevatedShare: Number(row.elevatedShare.toFixed(3)),
    caveRatio: Number(row.caveRatio.toFixed(3)),
    caveLargest: row.caveLargest,
    trees: row.trees,
    cactus: row.cactus,
    forestChunks: row.forestChunks,
    desertChunks: row.desertChunks,
  })),
}, null, 2));
