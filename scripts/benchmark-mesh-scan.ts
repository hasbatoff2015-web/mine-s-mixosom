/**
 * Deep CPU breakdown of ChunkMesher after typed-array emit.
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

interface IsolationModeRow {
  totalMs: number;
  scanMs: number;
  geometryMs: number;
  cacheFillMs: number;
  faces: number;
  cells: number;
  air: number;
  cubes: number;
  specials: number;
  liquids: number;
  lightCellReads: number;
  positionFloats: number;
  indexCount: number;
  vertices: number;
}

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
    const data: IsolationModeRow = {
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
      indexCount: profile.indexCount,
      vertices: profile.positionFloats / 3,
    };
    rows[mode.label] = data;
    dispose(meshed);
  }
  return rows;
}

function occludes(id: number): boolean {
  if (id === BlockId.Air) return false;
  return getBlockDefinition(id as BlockId).occludesFaces === true;
}

type Axis = 'x' | 'y' | 'z';

function greedyMergePlane(
  neighbor: (x: number, y: number, z: number) => number,
  blocks: Uint8Array | Uint16Array,
  height: number,
  nx: number,
  ny: number,
  nz: number,
  uAxis: Axis,
  vAxis: Axis,
): { naive: number; greedy: number } {
  const uSize = uAxis === 'y' ? height : CHUNK_SIZE;
  const vSize = vAxis === 'y' ? height : CHUNK_SIZE;
  const wSize = nx !== 0 ? CHUNK_SIZE : ny !== 0 ? height : CHUNK_SIZE;
  const used = new Uint8Array(Math.max(uSize * vSize, 1));
  const coord = (w: number, u: number, v: number) => {
    const x = nx !== 0 ? w : uAxis === 'x' ? u : v;
    const y = ny !== 0 ? w : uAxis === 'y' ? u : vAxis === 'y' ? v : 0;
    const z = nz !== 0 ? w : uAxis === 'z' ? u : v;
    return { x, y, z };
  };
  const blockAt = (x: number, y: number, z: number) => {
    if (y < 0 || y >= height || x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return 0;
    return blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x]!;
  };
  let naive = 0;
  let greedy = 0;
  for (let w = 0; w < wSize; w += 1) {
    used.fill(0);
    for (let v = 0; v < vSize; v += 1) {
      for (let u = 0; u < uSize; u += 1) {
        const { x, y, z } = coord(w, u, v);
        const id = blockAt(x, y, z);
        if (id === BlockId.Air) continue;
        const def = getBlockDefinition(id as BlockId);
        if (def.renderShape !== 'cube' && def.renderShape !== 'slab') continue;
        if (occludes(neighbor(x + nx, y + ny, z + nz))) continue;
        naive += 1;
        if (used[u + v * uSize]) continue;
        let width = 1;
        while (u + width < uSize && !used[u + width + v * uSize]) {
          const n = coord(w, u + width, v);
          if (blockAt(n.x, n.y, n.z) !== id) break;
          if (occludes(neighbor(n.x + nx, n.y + ny, n.z + nz))) break;
          width += 1;
        }
        let depth = 1;
        outer: while (v + depth < vSize) {
          for (let du = 0; du < width; du += 1) {
            if (used[u + du + (v + depth) * uSize]) break outer;
            const n = coord(w, u + du, v + depth);
            if (blockAt(n.x, n.y, n.z) !== id) break outer;
            if (occludes(neighbor(n.x + nx, n.y + ny, n.z + nz))) break outer;
          }
          depth += 1;
        }
        for (let dv = 0; dv < depth; dv += 1) {
          for (let du = 0; du < width; du += 1) used[u + du + (v + dv) * uSize] = 1;
        }
        greedy += 1;
      }
    }
  }
  return { naive, greedy };
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
  const plusY = greedyMergePlane(neighbor, blocks, height, 0, 1, 0, 'x', 'z');
  const dirs: Array<{ nx: number; ny: number; nz: number; u: Axis; v: Axis }> = [
    { nx: 1, ny: 0, nz: 0, u: 'y', v: 'z' },
    { nx: -1, ny: 0, nz: 0, u: 'y', v: 'z' },
    { nx: 0, ny: 1, nz: 0, u: 'x', v: 'z' },
    { nx: 0, ny: -1, nz: 0, u: 'x', v: 'z' },
    { nx: 0, ny: 0, nz: 1, u: 'x', v: 'y' },
    { nx: 0, ny: 0, nz: -1, u: 'x', v: 'y' },
  ];
  let naive6 = 0;
  let greedy6 = 0;
  for (const dir of dirs) {
    const part = greedyMergePlane(neighbor, blocks, height, dir.nx, dir.ny, dir.nz, dir.u, dir.v);
    naive6 += part.naive;
    greedy6 += part.greedy;
  }
  return {
    plusYNaiveFaces: plusY.naive,
    plusYGreedyQuads: plusY.greedy,
    plusYMergeRatio: plusY.naive > 0 ? Number((plusY.naive / Math.max(1, plusY.greedy)).toFixed(2)) : 0,
    allDirNaiveFaces: naive6,
    allDirGreedyQuads: greedy6,
    allDirMergeRatio: naive6 > 0 ? Number((naive6 / Math.max(1, greedy6)).toFixed(2)) : 0,
    expectedVertexUpperBound: greedy6 * 4,
    expectedIndexUpperBound: greedy6 * 6,
    note: 'Upper bound: cube/slab faces merged by block id only, ignoring AO/light/texture/biome splits. Not wired to production.',
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
    note: 'Clone cost only. A worker also needs blockStates, fluids, farming stem resolve, and atlas UVs. It does not make mesh() faster; it only moves CPU off the render thread.',
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

const byMode: Record<string, {
  total: number[];
  scan: number[];
  geo: number[];
  cacheFill: number[];
  reads: number[];
  faces: number[];
  vertices: number[];
  indices: number[];
}> = {};
for (const mode of ISOLATION) {
  byMode[mode.label] = {
    total: [], scan: [], geo: [], cacheFill: [], reads: [], faces: [], vertices: [], indices: [],
  };
}
for (const row of isolation) {
  for (const mode of ISOLATION) {
    const data = row[mode.label] as IsolationModeRow;
    byMode[mode.label]!.total.push(data.totalMs);
    byMode[mode.label]!.scan.push(data.scanMs);
    byMode[mode.label]!.geo.push(data.geometryMs);
    byMode[mode.label]!.cacheFill.push(data.cacheFillMs);
    byMode[mode.label]!.reads.push(data.lightCellReads);
    byMode[mode.label]!.faces.push(data.faces);
    byMode[mode.label]!.vertices.push(data.vertices);
    byMode[mode.label]!.indices.push(data.indexCount);
  }
}

const modeSummary: Record<string, unknown> = {};
for (const mode of ISOLATION) {
  const stats = byMode[mode.label]!;
  modeSummary[mode.label] = {
    totalMs: summarize(stats.total),
    scanMs: summarize(stats.scan),
    geometryConversionMs: summarize(stats.geo),
    cacheFillMs: summarize(stats.cacheFill),
    lightCellReads: summarize(stats.reads),
    faces: summarize(stats.faces),
    vertices: summarize(stats.vertices),
    indices: summarize(stats.indices),
  };
}

const phase = {
  voxelWalk: [] as number[],
  faceVisibility: [] as number[],
  emit: [] as number[],
  cheapLight: [] as number[],
  aoUncached: [] as number[],
  aoCached: [] as number[],
  geometryConversion: [] as number[],
  totalCached: [] as number[],
};
for (const row of isolation) {
  const vis = row.visibilityOnly as IsolationModeRow;
  const flat = row.emitFlatLight as IsolationModeRow;
  const cheap = row.emitCheapLight as IsolationModeRow;
  const full = row.fullAo as IsolationModeRow;
  const cached = row.fullAoLightCache as IsolationModeRow;
  phase.voxelWalk.push(vis.scanMs);
  phase.faceVisibility.push(vis.scanMs);
  phase.emit.push(flat.scanMs - vis.scanMs);
  phase.cheapLight.push(cheap.scanMs - flat.scanMs);
  phase.aoUncached.push(full.scanMs - cheap.scanMs);
  phase.aoCached.push(cached.scanMs - cheap.scanMs);
  phase.geometryConversion.push(cached.geometryMs);
  phase.totalCached.push(cached.totalMs);
}

const sample = isolation.find((row) => {
  const full = row.fullAo as IsolationModeRow;
  return full.faces > 5000;
}) ?? isolation[40] ?? isolation[0]!;

const greedy = estimateGreedy(spawnWorld, sample.cx as number, sample.cz as number);
const cloneCost = cloneNeighborhoodCost(spawnWorld, sample.cx as number, sample.cz as number);

const full = sample.fullAo as IsolationModeRow;
const vis = sample.visibilityOnly as IsolationModeRow;
const flat = sample.emitFlatLight as IsolationModeRow;
const cheap = sample.emitCheapLight as IsolationModeRow;
const cached = sample.fullAoLightCache as IsolationModeRow;
const totalFaces = byMode.fullAoLightCache!.faces.reduce((a, b) => a + b, 0);
const totalVertices = byMode.fullAoLightCache!.vertices.reduce((a, b) => a + b, 0);
const totalIndices = byMode.fullAoLightCache!.indices.reduce((a, b) => a + b, 0);

console.log(JSON.stringify({
  note: 'CPU-only mesher isolation. GPU/FPS not measured. PR #47 generate XOR mesh is unchanged. Greedy/worker are estimates only.',
  spawnPresent: true,
  grid: '9x9 RD=4 around spawn',
  chunks: coords.length,
  heapDeltaMb: Number(((heapAfter.heapUsed - heapBefore.heapUsed) / (1024 * 1024)).toFixed(2)),
  heapAfterMb: Number((heapAfter.heapUsed / (1024 * 1024)).toFixed(2)),
  totals: {
    faces: totalFaces,
    vertices: totalVertices,
    indices: totalIndices,
  },
  phaseBreakdownMs: {
    voxelWalkAndFaceVisibility: summarize(phase.voxelWalk),
    emit: summarize(phase.emit),
    cheapLight: summarize(phase.cheapLight),
    aoUncachedExtra: summarize(phase.aoUncached),
    aoCachedExtra: summarize(phase.aoCached),
    geometryConversion: summarize(phase.geometryConversion),
    totalFullAoCached: summarize(phase.totalCached),
  },
  modeSummary,
  sampleChunk: {
    cx: sample.cx,
    cz: sample.cz,
    occupancyTop: sample.occupancyTop,
    faces: full.faces,
    vertices: cached.vertices,
    indices: cached.indexCount,
    visibilityScanMs: vis.scanMs,
    emitFlatScanMs: flat.scanMs,
    emitCheapScanMs: cheap.scanMs,
    fullAoScanMs: full.scanMs,
    cachedScanMs: cached.scanMs,
    cacheFillMs: cached.cacheFillMs,
    geometryConversionMs: cached.geometryMs,
    derived: {
      voxelWalkAndVisibilityMs: vis.scanMs,
      emitAndArrayPushMs: Number((flat.scanMs - vis.scanMs).toFixed(3)),
      cheapLightMs: Number((cheap.scanMs - flat.scanMs).toFixed(3)),
      fullAoExtraMs: Number((full.scanMs - cheap.scanMs).toFixed(3)),
      cachedAoExtraMs: Number((cached.scanMs - cheap.scanMs).toFixed(3)),
      cacheVsFullAoMs: Number((full.scanMs - cached.scanMs).toFixed(3)),
    },
    lightCellReadsFull: full.lightCellReads,
    lightCellReadsCached: cached.lightCellReads,
  },
  greedyEstimate: greedy,
  workerClone: cloneCost,
  gpu: {
    measured: false,
    reason: 'No DevTools Performance / renderer.info capture in this Cloud VM pass.',
  },
}, null, 2));
