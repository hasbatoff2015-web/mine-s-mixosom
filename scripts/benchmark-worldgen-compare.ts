import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator } from '../src/world/Generator';
import { SEA_LEVEL } from '../src/core/constants';

interface Sample {
  totalMs: number;
  perChunk: number[];
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index]!;
}

function summarize(label: string, sample: Sample) {
  const per = sample.perChunk;
  return {
    label,
    chunks: per.length,
    totalMs: Number(sample.totalMs.toFixed(3)),
    avgMs: Number((sample.totalMs / Math.max(1, per.length)).toFixed(3)),
    p50Ms: Number(percentile(per, 0.5).toFixed(3)),
    p95Ms: Number(percentile(per, 0.95).toFixed(3)),
    maxMs: Number(Math.max(0, ...per).toFixed(3)),
  };
}

function findRegion(seed: string, wet: boolean): { cx: number; cz: number } {
  const generator = new TerrainGenerator(seed);
  for (let z = -48; z <= 48; z += 1) {
    for (let x = -48; x <= 48; x += 1) {
      const height = generator.columnAt(x * 16 + 8, z * 16 + 8).height;
      if (wet ? height < SEA_LEVEL : height > SEA_LEVEL + 2) return { cx: x, cz: z };
    }
  }
  return { cx: 0, cz: 0 };
}

function generateGrid(seed: string, originX: number, originZ: number): Sample {
  const generator = new TerrainGenerator(seed);
  const perChunk: number[] = [];
  const start = performance.now();
  for (let z = originZ - 4; z <= originZ + 4; z += 1) {
    for (let x = originX - 4; x <= originX + 4; x += 1) {
      const chunk = new Chunk(x, z);
      const t0 = performance.now();
      generator.generate(chunk);
      perChunk.push(performance.now() - t0);
    }
  }
  return { totalMs: performance.now() - start, perChunk };
}

const seed = 'alpha';
const land = findRegion(seed, false);
const ocean = findRegion(seed, true);
const landSample = generateGrid(seed, land.cx, land.cz);
const oceanSample = generateGrid(seed, ocean.cx, ocean.cz);

console.log(JSON.stringify({
  seed,
  landOrigin: land,
  oceanOrigin: ocean,
  land: summarize('land-81', landSample),
  ocean: summarize('ocean-81', oceanSample),
}, null, 2));
