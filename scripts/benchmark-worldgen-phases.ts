import { Chunk } from '../src/world/Chunk';
import { TerrainGenerator, type TerrainGenPhase } from '../src/world/Generator';
import { SEA_LEVEL } from '../src/core/constants';

const PHASES: TerrainGenPhase[] = [
  'heights', 'columns', 'lava', 'ores', 'deposits', 'decorate', 'cane', 'gourds',
];

function emptyPhaseTimes(): Record<TerrainGenPhase, { total: number; max: number; calls: number }> {
  return Object.fromEntries(PHASES.map((phase) => [phase, { total: 0, max: 0, calls: 0 }])) as Record<
    TerrainGenPhase,
    { total: number; max: number; calls: number }
  >;
}

function measureChunk(seed: string, cx: number, cz: number) {
  const generator = new TerrainGenerator(seed);
  const job = generator.beginGenerate(new Chunk(cx, cz));
  const times = emptyPhaseTimes();
  let done = false;
  while (!done) {
    const phase = job.phase;
    const t0 = performance.now();
    done = generator.advanceGenerate(job);
    const dt = performance.now() - t0;
    times[phase].total += dt;
    times[phase].max = Math.max(times[phase].max, dt);
    times[phase].calls += 1;
  }
  return times;
}

function findChunk(seed: string, wet: boolean): { cx: number; cz: number } {
  const generator = new TerrainGenerator(seed);
  for (let z = -32; z <= 32; z += 1) {
    for (let x = -32; x <= 32; x += 1) {
      const height = generator.columnAt(x * 16 + 8, z * 16 + 8).height;
      if (wet ? height < SEA_LEVEL : height > SEA_LEVEL + 2) return { cx: x, cz: z };
    }
  }
  return { cx: 0, cz: 0 };
}

function roundTimes(times: ReturnType<typeof emptyPhaseTimes>) {
  return Object.fromEntries(PHASES.map((phase) => [phase, {
    avgMs: Number((times[phase].total / Math.max(1, times[phase].calls)).toFixed(3)),
    maxMs: Number(times[phase].max.toFixed(3)),
    calls: times[phase].calls,
  }]));
}

const seed = 'alpha';
const land = findChunk(seed, false);
const ocean = findChunk(seed, true);
const landTimes = measureChunk(seed, land.cx, land.cz);
const oceanTimes = measureChunk(seed, ocean.cx, ocean.cz);

const samples = 12;
const gourdMax: number[] = [];
for (let i = 0; i < samples; i += 1) {
  const origin = i % 2 === 0 ? land : ocean;
  gourdMax.push(measureChunk(`${seed}-${i}`, origin.cx, origin.cz).gourds.max);
}

console.log(JSON.stringify({
  seed,
  land,
  ocean,
  landPhases: roundTimes(landTimes),
  oceanPhases: roundTimes(oceanTimes),
  gourdsPhaseMaxMs: Number(Math.max(...gourdMax).toFixed(3)),
  gourdsPhaseAvgMaxMs: Number((gourdMax.reduce((sum, value) => sum + value, 0) / gourdMax.length).toFixed(3)),
}, null, 2));
