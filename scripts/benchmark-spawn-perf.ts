/**
 * CPU audit: procedural vs imported Anarchy spawn meshing / streaming.
 * No GPU. Writes JSON to stdout. Does not mutate server/data/worlds.
 */
import { CHEAP_VERTEX_LIGHT_CHEBYSHEV, ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import { CHUNK_SIZE, WORLD_JOB_BUDGET_MS, WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import { ANARCHY_WORLD_ID, ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import { FsWorldStore } from '../server/FsWorldStore';
import { loadServerConfig } from '../server/config';
import { collectReadyMeshJobs, planMeshFrame, shouldDeferGenerateForMesh } from '../src/world/streamingScheduler';

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
    return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, sum: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    avg: Number((sum / values.length).toFixed(3)),
    p50: Number(percentile(values, 0.5).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
    p99: Number(percentile(values, 0.99).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
    sum: Number(sum.toFixed(3)),
  };
}

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

function meshChunk(mesher: ChunkMesher, world: VoxelWorld, cx: number, cz: number) {
  const chunk = world.getChunk(cx, cz)!;
  world.ensureChunkLighting(chunk);
  const started = performance.now();
  const meshed = mesher.build(chunk, world);
  const meshMs = performance.now() - started;
  const faces = meshed.faces;
  const scanMs = mesher.lastProfile.scanMs;
  const geometryMs = mesher.lastProfile.geometryMs;
  const layers = [
    meshed.opaque.getAttribute('position').count > 0,
    meshed.cutout.getAttribute('position').count > 0,
    meshed.vegetation.getAttribute('position').count > 0,
    meshed.translucent.getAttribute('position').count > 0,
    meshed.water.getAttribute('position').count > 0,
    meshed.fire.getAttribute('position').count > 0,
  ].filter(Boolean).length;
  disposeMeshed(meshed);
  chunk.dirty = false;
  return {
    cx,
    cz,
    meshMs,
    scanMs,
    geometryMs,
    faces,
    layers,
    occupancyTop: chunk.occupancyTop,
    mods: world.modifications.get(`${cx},${cz}`)?.size ?? 0,
  };
}

function meshGrid(label: string, world: VoxelWorld, cx0: number, cz0: number, radius: number) {
  const mesher = new ChunkMesher(atlasStub);
  const rows = [];
  for (let cz = cz0 - radius; cz <= cz0 + radius; cz += 1) {
    for (let cx = cx0 - radius; cx <= cx0 + radius; cx += 1) {
      rows.push(meshChunk(mesher, world, cx, cz));
    }
  }
  const meshMs = rows.map((row) => row.meshMs);
  const faces = rows.map((row) => row.faces);
  const layers = rows.reduce((sum, row) => sum + row.layers, 0);
  const worst = [...rows].sort((a, b) => b.meshMs - a.meshMs).slice(0, 8);
  return {
    label,
    chunks: rows.length,
    meshMs: summarize(meshMs),
    faces: summarize(faces),
    totalFaces: faces.reduce((a, b) => a + b, 0),
    drawCallLayers: layers,
    worst,
  };
}

function walkBudgeted(
  world: VoxelWorld,
  path: Array<{ x: number; z: number }>,
  meshRadius: number,
  options: { defaultMeshLimit: number } = { defaultMeshLimit: 1 },
) {
  const mesher = new ChunkMesher(atlasStub);
  const overBudget: number[] = [];
  const meshMs: number[] = [];
  const genMs: number[] = [];
  const lightMs: number[] = [];
  const stackedMs: number[] = [];
  let meshes = 0;
  let generates = 0;
  let stackedFrames = 0;
  let deferredGenerates = 0;
  let consecutiveGenWithoutMesh = 0;
  for (const pos of path) {
    const frameStart = performance.now();
    world.setViewCenter(pos.x, pos.z, meshRadius);
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    const genRadius = meshRadius + 1;
    const peek = collectReadyMeshJobs(world, pos.x, pos.z, meshRadius, performance.now(), 4, 0);
    const deferGenerate = shouldDeferGenerateForMesh(false, consecutiveGenWithoutMesh, peek);
    let generatedThisFrame = 0;
    const genStart = performance.now();
    if (deferGenerate) {
      deferredGenerates += 1;
    } else {
      for (let z = cz - genRadius; z <= cz + genRadius; z += 1) {
        for (let x = cx - genRadius; x <= cx + genRadius; x += 1) {
          if (world.getChunk(x, z, false)) continue;
          world.getChunk(x, z);
          generatedThisFrame = 1;
          generates += 1;
          break;
        }
        if (generatedThisFrame > 0) break;
      }
    }
    const oneGen = performance.now() - genStart;
    genMs.push(oneGen);
    const lightStart = performance.now();
    world.processLighting(WORLD_LIGHT_BUDGET_MS, pos.x, pos.z);
    lightMs.push(performance.now() - lightStart);
    const ready = collectReadyMeshJobs(world, pos.x, pos.z, meshRadius, performance.now(), 4, 0);
    const plan = planMeshFrame({
      loading: false,
      generatedThisFrame: generatedThisFrame > 0,
      consecutiveGenWithoutMesh,
      readyJobs: ready,
      defaultMeshLimit: options.defaultMeshLimit,
      frameElapsedMs: performance.now() - frameStart,
    });
    let meshedThisFrame = 0;
    let oneMesh = 0;
    if (!plan.skipMesh && plan.meshLimit > 0) {
      let rebuilt = 0;
      const meshStart = performance.now();
      for (const job of ready) {
        if (rebuilt >= plan.meshLimit) break;
        if (!job.chunk.lightingReady) continue;
        const built = mesher.build(job.chunk, world, {
          cheapVertexLight: job.chebyshev >= CHEAP_VERTEX_LIGHT_CHEBYSHEV,
        });
        disposeMeshed(built);
        job.chunk.dirty = false;
        world.acknowledgeMeshed(job.chunk);
        rebuilt += 1;
        meshes += 1;
        meshedThisFrame += 1;
        if (rebuilt > 0 && performance.now() - meshStart >= WORLD_JOB_BUDGET_MS) break;
      }
      oneMesh = performance.now() - meshStart;
      meshMs.push(oneMesh);
      if (oneMesh > WORLD_JOB_BUDGET_MS) overBudget.push(oneMesh);
    }
    if (generatedThisFrame > 0 && meshedThisFrame > 0) {
      stackedFrames += 1;
      stackedMs.push(oneGen + oneMesh);
    }
    if (plan.skipMesh || plan.meshLimit <= 0) {
      consecutiveGenWithoutMesh = generatedThisFrame > 0 ? consecutiveGenWithoutMesh + 1 : 0;
    } else {
      consecutiveGenWithoutMesh = meshedThisFrame > 0 || generatedThisFrame === 0
        ? 0
        : consecutiveGenWithoutMesh + 1;
    }
  }
  return {
    steps: path.length,
    generates,
    meshes,
    stackedFrames,
    deferredGenerates,
    stackedMs: summarize(stackedMs),
    genMs: summarize(genMs),
    lightMs: summarize(lightMs),
    meshMs: summarize(meshMs),
    overBudgetMeshes: overBudget.length,
    overBudget: summarize(overBudget),
  };
}

function cheapLightSample(world: VoxelWorld, cx: number, cz: number) {
  const mesher = new ChunkMesher(atlasStub);
  const chunk = world.getChunk(cx, cz)!;
  world.ensureChunkLighting(chunk);
  const fullStart = performance.now();
  const full = mesher.build(chunk, world);
  const fullMs = performance.now() - fullStart;
  const fullScanMs = mesher.lastProfile.scanMs;
  const cheapStart = performance.now();
  const cheap = mesher.build(chunk, world, { cheapVertexLight: true });
  const cheapMs = performance.now() - cheapStart;
  const result = {
    cx,
    cz,
    faces: full.faces,
    facesMatch: cheap.faces === full.faces,
    fullMs: Number(fullMs.toFixed(3)),
    cheapMs: Number(cheapMs.toFixed(3)),
    scanFullMs: Number(fullScanMs.toFixed(3)),
    scanCheapMs: Number(mesher.lastProfile.scanMs.toFixed(3)),
  };
  disposeMeshed(full);
  disposeMeshed(cheap);
  return result;
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

const procedural = new VoxelWorld('audit-procedural');
const proceduralGrid = meshGrid('procedural-rd4', procedural, 0, 0, 4);

const spawnWorld = await loadSpawnWorld();
let spawn = null;
let spawnWalk = null;
let spawnMods = null;
let cheapLight = null;
if (spawnWorld) {
  const spawnX = 53.5;
  const spawnZ = 70.5;
  const scx = Math.floor(spawnX / CHUNK_SIZE);
  const scz = Math.floor(spawnZ / CHUNK_SIZE);
  spawn = meshGrid('spawn-rd4', spawnWorld, scx, scz, 4);
  cheapLight = cheapLightSample(spawnWorld, spawn.worst[0]!.cx, spawn.worst[0]!.cz);
  const path: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 48; i += 1) {
    path.push({ x: spawnX + i * 3.2, z: spawnZ + (i % 2 === 0 ? 1.5 : -1.5) });
  }
  spawnWalk = walkBudgeted(spawnWorld, path, 4);
  spawnMods = {
    chunks: spawnWorld.modifications.size,
    cells: [...spawnWorld.modifications.values()].reduce((sum, map) => sum + map.size, 0),
  };
}

const emptyWalkWorld = new VoxelWorld('audit-empty-walk');
const emptyPath: Array<{ x: number; z: number }> = [];
for (let i = 0; i < 48; i += 1) emptyPath.push({ x: 8 + i * 3.2, z: 8 });
const emptyWalk = walkBudgeted(emptyWalkWorld, emptyPath, 4);

console.log(JSON.stringify({
  note: 'CPU-only Node audit. GPU/FPS not measured here.',
  jobBudgetMs: WORLD_JOB_BUDGET_MS,
  lightBudgetMs: WORLD_LIGHT_BUDGET_MS,
  proceduralGrid,
  spawnPresent: Boolean(spawnWorld),
  spawnMods,
  spawn,
  spawnWalk,
  cheapLight,
  emptyWalk,
}, null, 2));
