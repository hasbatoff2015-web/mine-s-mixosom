/**
 * Hitch / budgeted-mesh / AO 3×3 / greedy-realistic / worker clone research.
 * Does not change production greedy or worker paths.
 */
import { CHUNK_SIZE, MESH_SLICE_BUDGET_MS } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import { compareAo3x3, greedyRealistic, packedNeighborhoodFillMs } from '../src/rendering/meshResearch';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import { ANARCHY_WORLD_ID, ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import { FsWorldStore } from '../server/FsWorldStore';
import { loadServerConfig } from '../server/config';
import { collectReadyMeshJobs, planMeshFrame, shouldDeferGenerateForMesh } from '../src/world/streamingScheduler';
import { WORLD_JOB_BUDGET_MS, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { CHEAP_VERTEX_LIGHT_CHEBYSHEV } from '../src/rendering/ChunkMesher';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(values: readonly number[]) {
  if (values.length === 0) {
    return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    avg: Number((sum / values.length).toFixed(3)),
    p50: Number(percentile(values, 0.5).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
    p99: Number(percentile(values, 0.99).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
  };
}

function dispose(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

async function loadSpawnWorld(): Promise<VoxelWorld | null> {
  const config = loadServerConfig();
  const store = new FsWorldStore(config.dataDir);
  const snapshot = await store.load(ANARCHY_WORLD_ID);
  if (!snapshot || Object.keys(snapshot.modifications).length < 10) return null;
  const world = new VoxelWorld(snapshot.summary.seed || ANARCHY_WORLD_SEED);
  world.restore(snapshot);
  return world;
}

const spawnWorld = await loadSpawnWorld();
if (!spawnWorld) {
  console.log(JSON.stringify({ error: 'spawn world missing' }));
  process.exit(1);
}

const spawnX = 53.5;
const spawnZ = 70.5;
const scx = Math.floor(spawnX / CHUNK_SIZE);
const scz = Math.floor(spawnZ / CHUNK_SIZE);
const sampleCx = scx;
const sampleCz = scz;
const sample = spawnWorld.getChunk(sampleCx, sampleCz)!;
spawnWorld.ensureChunkLighting(sample);
for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  spawnWorld.getChunk(sampleCx + dx, sampleCz + dz);
}

const mesher = new ChunkMesher(atlasStub);
const fullStart = performance.now();
const full = mesher.build(sample, spawnWorld, { vertexLight: 'full', collectDetail: true });
const fullMs = performance.now() - fullStart;
const fullFaces = full.faces;
const fullVerts = mesher.lastProfile.positionFloats / 3;
const fullIdx = mesher.lastProfile.indexCount;
dispose(full);

const sliceTimes: number[] = [];
mesher.startBuild(sample, spawnWorld, { vertexLight: 'full' });
let sliceStart = performance.now();
while (!mesher.pumpBuild(MESH_SLICE_BUDGET_MS)) {
  sliceTimes.push(performance.now() - sliceStart);
  sliceStart = performance.now();
}
sliceTimes.push(performance.now() - sliceStart);
const sliced = mesher.takeBuild()!;
const sliceFaces = sliced.faces;
dispose(sliced);

const toGeometryOnly = [];
for (let i = 0; i < 5; i += 1) {
  const built = mesher.build(sample, spawnWorld, { vertexLight: 'full', collectDetail: true });
  toGeometryOnly.push(mesher.lastProfile.geometryMs);
  dispose(built);
}

const packedFill = [];
for (let i = 0; i < 5; i += 1) packedFill.push(packedNeighborhoodFillMs(sample));

const aoRead: (x: number, y: number, z: number) => number = (x, y, z) => {
  const chunk = spawnWorld.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), false);
  if (!chunk || y < 0) return 256;
  const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const packed = chunk.skyLightAtIndex(y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx)
    | (chunk.blockLight[y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx]! << 4);
  return packed;
};
const ao = compareAo3x3(spawnWorld, sampleCx, sampleCz, aoRead);
const greedy = greedyRealistic(spawnWorld, sampleCx, sampleCz, aoRead);

const workerChunks = [];
for (let dz = -1; dz <= 1; dz += 1) {
  for (let dx = -1; dx <= 1; dx += 1) {
    const chunk = spawnWorld.getChunk(sampleCx + dx, sampleCz + dz, false);
    if (!chunk) continue;
    workerChunks.push({
      blocks: chunk.blocks.slice(),
      skyLight: chunk.skyLight.slice(),
      blockLight: chunk.blockLight.slice(),
    });
  }
}
const payloadBytes = workerChunks.reduce((sum, chunk) => (
  sum + chunk.blocks.byteLength + chunk.skyLight.byteLength + chunk.blockLight.byteLength
), 0);
const cloneStart = performance.now();
const cloned = structuredClone(workerChunks);
const structuredCloneMs = performance.now() - cloneStart;
cloned.length;

const walkPath: Array<{ x: number; z: number }> = [];
for (let step = 0; step < 48; step += 1) {
  walkPath.push({ x: spawnX + step * 1.4, z: spawnZ });
}
const sliceHitch: number[] = [];
const fullHitch: number[] = [];
const walkMesher = new ChunkMesher(atlasStub);
let consecutiveGenWithoutMesh = 0;
for (const pos of walkPath) {
  spawnWorld.setViewCenter(pos.x, pos.z, 4);
  const cx = Math.floor(pos.x / CHUNK_SIZE);
  const cz = Math.floor(pos.z / CHUNK_SIZE);
  const peek = collectReadyMeshJobs(spawnWorld, pos.x, pos.z, 4, performance.now(), 4, 0);
  const deferGenerate = shouldDeferGenerateForMesh(false, consecutiveGenWithoutMesh, peek);
  let generatedThisFrame = 0;
  if (!deferGenerate) {
    outer: for (let z = cz - 5; z <= cz + 5; z += 1) {
      for (let x = cx - 5; x <= cx + 5; x += 1) {
        if (spawnWorld.getChunk(x, z, false)) continue;
        spawnWorld.getChunk(x, z);
        generatedThisFrame = 1;
        break outer;
      }
    }
  }
  spawnWorld.processLighting(WORLD_LIGHT_BUDGET_MS, pos.x, pos.z);
  const ready = collectReadyMeshJobs(spawnWorld, pos.x, pos.z, 4, performance.now(), 4, 0);
  const plan = planMeshFrame({
    loading: false,
    generatedThisFrame: generatedThisFrame > 0,
    consecutiveGenWithoutMesh,
    readyJobs: ready,
    defaultMeshLimit: 1,
    frameElapsedMs: 1,
  });
  if (!plan.skipMesh && plan.meshLimit > 0 && ready[0]) {
    const job = ready[0];
    const t0 = performance.now();
    const built = walkMesher.build(job.chunk, spawnWorld, {
      cheapVertexLight: job.chebyshev >= CHEAP_VERTEX_LIGHT_CHEBYSHEV,
    });
    fullHitch.push(performance.now() - t0);
    dispose(built);
    job.chunk.dirty = true;
    walkMesher.startBuild(job.chunk, spawnWorld, {
      cheapVertexLight: job.chebyshev >= CHEAP_VERTEX_LIGHT_CHEBYSHEV,
    });
    const t1 = performance.now();
    const done = walkMesher.pumpBuild(MESH_SLICE_BUDGET_MS);
    sliceHitch.push(performance.now() - t1);
    if (done) {
      const meshed = walkMesher.takeBuild()!;
      dispose(meshed);
      job.chunk.dirty = false;
      spawnWorld.acknowledgeMeshed(job.chunk);
    } else {
      while (!walkMesher.pumpBuild(MESH_SLICE_BUDGET_MS)) { /* finish off-frame for the next compare */ }
      const meshed = walkMesher.takeBuild()!;
      dispose(meshed);
      job.chunk.dirty = false;
      spawnWorld.acknowledgeMeshed(job.chunk);
    }
    consecutiveGenWithoutMesh = 0;
  } else {
    consecutiveGenWithoutMesh = generatedThisFrame > 0 ? consecutiveGenWithoutMesh + 1 : 0;
  }
}

console.log(JSON.stringify({
  note: 'Hitch research. GPU/FPS not measured. Greedy/worker/3x3 AO are prototypes only.',
  sample: { cx: sampleCx, cz: sampleCz, occupancyTop: sample.occupancyTop },
  oneshot: {
    totalMs: Number(fullMs.toFixed(3)),
    faces: fullFaces,
    vertices: fullVerts,
    indices: fullIdx,
    geometryConversionAvgMs: summarize(toGeometryOnly).avg,
  },
  budgetedSlices: {
    sliceBudgetMs: MESH_SLICE_BUDGET_MS,
    slices: sliceTimes.length,
    sliceMs: summarize(sliceTimes),
    facesMatch: sliceFaces === fullFaces,
    jobBudgetMs: WORLD_JOB_BUDGET_MS,
  },
  packedNeighborhoodFillMs: summarize(packedFill),
  ao3x3: {
    comparedFaces: ao.compared,
    mismatches: ao.mismatches,
    perVertexMs: Number(ao.perVertexMs.toFixed(3)),
    face3x3Ms: Number(ao.face3x3Ms.toFixed(3)),
  },
  greedy: greedy,
  worker: {
    neighborhoodChunks: workerChunks.length,
    payloadBytes,
    structuredCloneMs: Number(structuredCloneMs.toFixed(3)),
    expectedMainThreadMs: Number(structuredCloneMs.toFixed(3)),
    expectedWorkerTotalMs: Number((fullMs + structuredCloneMs).toFixed(3)),
    hitchReduction: 'moves ~oneshot mesh off RAF; adds clone + at least one frame of latency',
  },
  walkSpikes: {
    steps: walkPath.length,
    oneshotMeshMs: summarize(fullHitch),
    firstSliceMs: summarize(sliceHitch),
  },
  gpu: { measured: false, reason: 'No DevTools / renderer.info in this Cloud VM.' },
}, null, 2));
