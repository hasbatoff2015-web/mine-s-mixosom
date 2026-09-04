/**
 * Deep CPU breakdown of ChunkMesher after PR #47.
 * Isolation modes + greedy estimate + worker clone cost. No GPU.
 */
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import {
  ChunkMesher,
  type ChunkMeshBuildOptions,
} from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import { ANARCHY_WORLD_ID, ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import { FsWorldStore } from '../server/FsWorldStore';
import { loadServerConfig } from '../server/config';

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

const ISOLATION: Array<{ label: string; options: ChunkMeshBuildOptions }> = [
  { label: 'visibilityOnly', options: { emitGeometry: false, vertexLight: 'flat', collectDetail: true } },
  { label: 'emitFlatLight', options: { vertexLight: 'flat', collectDetail: true } },
  { label: 'emitCheapLight', options: { vertexLight: 'cheap', collectDetail: true } },
  { label: 'fullAo', options: { vertexLight: 'full', neighborhoodLightCache: false, collectDetail: true } },
  { label: 'fullAoLightCache', options: { vertexLight: 'full', neighborhoodLightCache: true, collectDetail: true } },
];

function runIsolation(world: VoxelWorld, cx: number, cz: number) {
  const mesher = new ChunkMesher(atlasStub);
  const chunk = world.getChunk(cx, cz)!;
  world.ensureChunkLighting(chunk);
  const rows: Record<string, unknown> = { cx, cz, occupancyTop: chunk.occupancyTop };
  for (const mode of ISOLATION) {
    const started = performance.now();
    const meshed = mesher.build(chunk, world, mode.options);
    const totalMs = performance.now() - started;
    const profile = mesher.lastProfile;
    rows[mode.label] = {
      totalMs: Number(totalMs.toFixed(3)),
      scanMs: Number(profile.scanMs.toFixed(3)),
      geometryMs: Number(profile.geometryMs.toFixed(3)),
      cacheFillMs: Number(profile.cacheFillMs.toFixed(3)),
      faces: meshed.faces,
      cells: profile.cells,
      air: profile.air,
      cubes: profile.cubes,
      specials: profile.specials,
      liquids: profile.liquids,
      lightCellReads: profile.lightCellReads,
      positionFloats: profile.positionFloats,
    };
    dispose(meshed);
  }
  return rows;
}

function occludes(id: number): boolean {
  if (id === BlockId.Air) return false;
  return getBlockDefinition(id as BlockId).occludesFaces === true;
}

function estimateGreedy(world: VoxelWorld, cx: number, cz: number) {
  const chunk = world.getChunk(cx, cz)!;
  const height = chunk.scanMaxY() + 1;
  const blocks = chunk.blocks;
  const neighbor = (x: number, y: number, z: number): number => {
    if (y < 0) return BlockId.Bedrock;
    if (y >= height) return BlockId.Air;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
      return blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x]!;
    }
    const wx = cx * CHUNK_SIZE + x;
    const wz = cz * CHUNK_SIZE + z;
    const n = world.getChunk(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE), false);
    if (!n) return BlockId.Air;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return n.blocks[y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx]!;
  };
  const faceVisible = (nx: number, ny: number, nz: number): boolean => !occludes(neighbor(nx, ny, nz));
  let naive = 0;
  let greedy = 0;
  const used = new Uint8Array(CHUNK_SIZE * height * CHUNK_SIZE);
  const markIndex = (x: number, y: number, z: number) => y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
  // +Y faces only as a representative merge (largest spawn roofs/floors).
  for (let y = 0; y < height; y += 1) {
    used.fill(0);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const id = blocks[markIndex(x, y, z)]!;
        if (id === BlockId.Air) continue;
        const def = getBlockDefinition(id as BlockId);
        if (def.renderShape !== 'cube' && !(def.renderShape === 'slab')) continue;
        if (!faceVisible(x, y + 1, z)) continue;
        naive += 1;
        if (used[x + z * CHUNK_SIZE]) continue;
        let width = 1;
        while (x + width < CHUNK_SIZE && !used[x + width + z * CHUNK_SIZE]
          && blocks[markIndex(x + width, y, z)] === id
          && faceVisible(x + width, y + 1, z)) {
          width += 1;
        }
        let depth = 1;
        outer: while (z + depth < CHUNK_SIZE) {
          for (let dx = 0; dx < width; dx += 1) {
            if (used[x + dx + (z + depth) * CHUNK_SIZE]) break outer;
            if (blocks[markIndex(x + dx, y, z + depth)] !== id) break outer;
            if (!faceVisible(x + dx, y + 1, z + depth)) break outer;
          }
          depth += 1;
        }
        for (let dz = 0; dz < depth; dz += 1) {
          for (let dx = 0; dx < width; dx += 1) used[x + dx + (z + dz) * CHUNK_SIZE] = 1;
        }
        greedy += 1;
      }
    }
  }
  return {
    plusYNaiveFaces: naive,
    plusYGreedyQuads: greedy,
    plusYMergeRatio: naive > 0 ? Number((naive / Math.max(1, greedy)).toFixed(2)) : 0,
    note: 'Upper bound: +Y opaque/slab faces merged by block id only, ignoring AO/light splits and other 5 dirs.',
  };
}

function cloneNeighborhoodCost(world: VoxelWorld, cx: number, cz: number) {
  const chunks = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const chunk = world.getChunk(cx + dx, cz + dz, false);
      if (!chunk) continue;
      chunks.push({
        x: chunk.x,
        z: chunk.z,
        occupancyTop: chunk.occupancyTop,
        blocks: chunk.blocks.slice(),
        skyLight: chunk.skyLight.slice(),
        blockLight: chunk.blockLight.slice(),
        biomeCodes: chunk.biomeCodes.slice(),
        surfaceHeights: chunk.surfaceHeights.slice(),
      });
    }
  }
  const bytes = chunks.reduce((sum, chunk) => (
    sum
    + chunk.blocks.byteLength
    + chunk.skyLight.byteLength
    + chunk.blockLight.byteLength
    + chunk.biomeCodes.byteLength
    + chunk.surfaceHeights.byteLength
  ), 0);
  const cloneStart = performance.now();
  structuredClone(chunks);
  const structuredCloneMs = performance.now() - cloneStart;
  const sliceStart = performance.now();
  for (const chunk of chunks) {
    chunk.blocks.slice();
    chunk.skyLight.slice();
    chunk.blockLight.slice();
  }
  const typedSliceMs = performance.now() - sliceStart;
  return {
    neighborhoodChunks: chunks.length,
    payloadBytes: bytes,
    structuredCloneMs: Number(structuredCloneMs.toFixed(3)),
    typedArraySliceMs: Number(typedSliceMs.toFixed(3)),
    note: 'Clone cost only. A worker also needs blockStates, fluids, farming stem resolve, and atlas UVs.',
  };
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
const coords: Array<{ cx: number; cz: number }> = [];
for (let cz = scz - 4; cz <= scz + 4; cz += 1) {
  for (let cx = scx - 4; cx <= scx + 4; cx += 1) coords.push({ cx, cz });
}

const heapBefore = process.memoryUsage();
const isolation = [];
for (const coord of coords) isolation.push(runIsolation(spawnWorld, coord.cx, coord.cz));
const heapAfter = process.memoryUsage();

const byMode: Record<string, { total: number[]; scan: number[]; geo: number[]; cacheFill: number[]; reads: number[] }> = {};
for (const mode of ISOLATION) {
  byMode[mode.label] = { total: [], scan: [], geo: [], cacheFill: [], reads: [] };
}
for (const row of isolation) {
  for (const mode of ISOLATION) {
    const data = row[mode.label] as {
      totalMs: number;
      scanMs: number;
      geometryMs: number;
      cacheFillMs: number;
      lightCellReads: number;
    };
    byMode[mode.label]!.total.push(data.totalMs);
    byMode[mode.label]!.scan.push(data.scanMs);
    byMode[mode.label]!.geo.push(data.geometryMs);
    byMode[mode.label]!.cacheFill.push(data.cacheFillMs);
    byMode[mode.label]!.reads.push(data.lightCellReads);
  }
}

const modeSummary: Record<string, unknown> = {};
for (const mode of ISOLATION) {
  const stats = byMode[mode.label]!;
  modeSummary[mode.label] = {
    totalMs: summarize(stats.total),
    scanMs: summarize(stats.scan),
    geometryMs: summarize(stats.geo),
    cacheFillMs: summarize(stats.cacheFill),
    lightCellReads: summarize(stats.reads),
  };
}

const sample = isolation.find((row) => {
  const full = row.fullAo as { faces: number };
  return full.faces > 5000;
}) ?? isolation[40] ?? isolation[0]!;

const greedy = estimateGreedy(spawnWorld, sample.cx as number, sample.cz as number);
const cloneCost = cloneNeighborhoodCost(spawnWorld, sample.cx as number, sample.cz as number);

const full = sample.fullAo as { totalMs: number; scanMs: number; lightCellReads: number; faces: number };
const vis = sample.visibilityOnly as { totalMs: number; scanMs: number };
const flat = sample.emitFlatLight as { totalMs: number; scanMs: number };
const cheap = sample.emitCheapLight as { totalMs: number; scanMs: number };
const cached = sample.fullAoLightCache as { totalMs: number; scanMs: number; cacheFillMs: number; lightCellReads: number };

console.log(JSON.stringify({
  note: 'CPU-only mesher isolation. GPU/FPS not measured. PR #47 generate XOR mesh is unchanged.',
  spawnPresent: true,
  grid: '9x9 RD=4 around spawn',
  chunks: coords.length,
  heapDeltaMb: Number(((heapAfter.heapUsed - heapBefore.heapUsed) / (1024 * 1024)).toFixed(2)),
  heapAfterMb: Number((heapAfter.heapUsed / (1024 * 1024)).toFixed(2)),
  modeSummary,
  sampleChunk: {
    cx: sample.cx,
    cz: sample.cz,
    occupancyTop: sample.occupancyTop,
    faces: full.faces,
    visibilityScanMs: vis.scanMs,
    emitFlatScanMs: flat.scanMs,
    emitCheapScanMs: cheap.scanMs,
    fullAoScanMs: full.scanMs,
    cachedScanMs: cached.scanMs,
    cacheFillMs: cached.cacheFillMs,
    derived: {
      voxelWalkAndVisibilityMs: vis.scanMs,
      emitAndArrayPushMs: Number((flat.scanMs - vis.scanMs).toFixed(3)),
      cheapLightMs: Number((cheap.scanMs - flat.scanMs).toFixed(3)),
      fullAoExtraMs: Number((full.scanMs - cheap.scanMs).toFixed(3)),
      cacheVsFullAoMs: Number((full.scanMs - cached.scanMs).toFixed(3)),
    },
    lightCellReadsFull: full.lightCellReads,
    lightCellReadsCached: cached.lightCellReads,
  },
  greedyEstimate: greedy,
  workerClone: cloneCost,
}, null, 2));
