import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { interpolatePose } from '../src/core/entityInterpolation';
import { advanceFixedStep } from '../src/core/fixedStep';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { resetLightEngineStats, lightEngineStats } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function measureBreaks(seed: string, count: number, defer: boolean): {
  totalMs: number;
  averageMs: number;
  p95Ms: number;
  skyRecomputes: number;
  pendingMesh: number;
  dirtyChunks: number;
} {
  const world = new VoxelWorld(seed);
  world.ensureChunks(8, 8, 1);
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  for (const chunk of world.chunks.values()) chunk.dirty = false;
  world.pendingMesh.clear();
  resetLightEngineStats();
  const samples: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const x = 4 + (index % 8);
    const z = 4;
    const y = 40 + (index % 3);
    const one = performance.now();
    world.applyBlockBatch([{ x, y, z, block: BlockId.Stone }], { deferLighting: defer });
    world.applyBlockBatch([{ x, y, z, block: BlockId.Air }], { deferLighting: defer });
    samples.push(performance.now() - one);
  }
  if (defer) world.flushLighting();
  return {
    totalMs: performance.now() - started,
    averageMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95Ms: percentile(samples, 0.95),
    skyRecomputes: lightEngineStats.skyRecomputes,
    pendingMesh: world.pendingMeshJobs,
    dirtyChunks: world.dirtyChunkCount,
  };
}

function measureGenerateMesh(): { generateMs: number; lightMs: number; meshMs: number; faces: number } {
  const world = new VoxelWorld('perf-pass-mesh');
  const mesher = new ChunkMesher(atlasStub);
  const generateStart = performance.now();
  const chunk = world.getChunk(0, 0)!;
  const generateMs = performance.now() - generateStart;
  const lightStart = performance.now();
  world.ensureChunkLighting(chunk);
  const lightMs = performance.now() - lightStart;
  const meshStart = performance.now();
  const meshed = mesher.build(chunk, world);
  const meshMs = performance.now() - meshStart;
  const faces = meshed.faces;
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  return { generateMs, lightMs, meshMs, faces };
}

const mid = interpolatePose(
  { x: 0, y: 0, z: 0, yaw: 0, walkPhase: 0 },
  { x: 1, y: 0, z: 0, yaw: 0, walkPhase: 1 },
  0.5,
);
const catchUp = advanceFixedStep(0, 0.3);

console.info(JSON.stringify({
  scenario: 'perf-pass-cpu',
  chunkSize: CHUNK_SIZE,
  interpolateMid: mid.x,
  catchUpTicks: catchUp.ticks,
  droppedSeconds: Number(catchUp.droppedSeconds.toFixed(3)),
  generateMesh: measureGenerateMesh(),
  break30Immediate: measureBreaks('perf-break-30', 30, false),
  break100Deferred: measureBreaks('perf-break-100', 100, true),
}, null, 2));
