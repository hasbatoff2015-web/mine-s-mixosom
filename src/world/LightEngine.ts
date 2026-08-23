import { BlockId, getBlockDefinition, type BlockDefinition } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey, floorDiv, positiveMod } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
] as const;

const COLUMN_COUNT = CHUNK_SIZE * CHUNK_SIZE;
const MAX_PROPAGATION_NODES = 8_192;
const FLOOD_CAP = 8_192;
const YIELD_COLUMN_STEP = 16;
const YIELD_NODE_STEP = 64;
const MAX_COLUMNS_PER_SLICE = 96;
const MAX_NODES_PER_SLICE = 768;

export interface LightRegion {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface LightFrameStats {
  jobsActive: number;
  jobsPending: number;
  columns: number;
  nodes: number;
  ms: number;
  maxSlice: number;
  dirtyLightChunks: number;
}

export const lightEngineStats = {
  skyRecomputes: 0,
  blockPropagations: 0,
};

export const lightFrameStats: LightFrameStats = {
  jobsActive: 0,
  jobsPending: 0,
  columns: 0,
  nodes: 0,
  ms: 0,
  maxSlice: 0,
  dirtyLightChunks: 0,
};

const lightTouched = new Set<Chunk>();
const floodX = new Int32Array(FLOOD_CAP);
const floodY = new Int32Array(FLOOD_CAP);
const floodZ = new Int32Array(FLOOD_CAP);
const floodL = new Uint8Array(FLOOD_CAP);
let floodHead = 0;
let floodTail = 0;
let floodOwnerKey = '';

export function resetLightEngineStats(): void {
  lightEngineStats.skyRecomputes = 0;
  lightEngineStats.blockPropagations = 0;
}

export function resetLightFrameStats(): void {
  lightFrameStats.jobsActive = 0;
  lightFrameStats.jobsPending = 0;
  lightFrameStats.columns = 0;
  lightFrameStats.nodes = 0;
  lightFrameStats.ms = 0;
  lightFrameStats.maxSlice = 0;
  lightFrameStats.dirtyLightChunks = 0;
}

export function consumeLightTouched(): Chunk[] {
  const chunks = [...lightTouched];
  lightTouched.clear();
  return chunks;
}

export function peekLightTouched(): ReadonlySet<Chunk> {
  return lightTouched;
}

function loadedChunk(world: VoxelWorld, x: number, z: number): Chunk | undefined {
  return world.chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
}

function chunkIndex(x: number, y: number, z: number): number {
  return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
}

function shouldYield(deadline: number | undefined, didWork: boolean): boolean {
  if (deadline === undefined || !didWork) return false;
  return performance.now() >= deadline;
}

function noteTouched(chunk: Chunk): void {
  lightTouched.add(chunk);
}

function recordSlice(started: number): void {
  const elapsed = performance.now() - started;
  lightFrameStats.ms += elapsed;
  if (elapsed > lightFrameStats.maxSlice) lightFrameStats.maxSlice = elapsed;
}

/**
 * Simplified sky filter. Opaque blocks seal the column. Water and leaf cubes
 * attenuate by 1. Cross plants, torches, doors, etc. do not change sky access,
 * so a surface tall-grass break can skip lighting entirely.
 */
export function skyOcclusionClass(definition: BlockDefinition | undefined): 'block' | 'attenuate' | 'pass' {
  if (!definition || definition.id === BlockId.Air) return 'pass';
  if (definition.occludesFaces) return 'block';
  if (definition.liquid) return 'attenuate';
  if (definition.renderLayer === 'cutout' && definition.renderShape === 'cube') return 'attenuate';
  return 'pass';
}

function skyAttenuation(definition: BlockDefinition): number {
  const kind = skyOcclusionClass(definition);
  if (kind === 'block') return 16;
  if (kind === 'attenuate') return 1;
  return 0;
}

function setSky(chunk: Chunk, localX: number, y: number, localZ: number, value: number): boolean {
  const index = chunkIndex(localX, y, localZ);
  if ((chunk.skyLight[index] ?? 0) === value) return false;
  chunk.skyLight[index] = value;
  noteTouched(chunk);
  return true;
}

function setBlockLightValue(chunk: Chunk, localX: number, y: number, localZ: number, value: number): boolean {
  const index = chunkIndex(localX, y, localZ);
  if ((chunk.blockLight[index] ?? 0) === value) return false;
  chunk.blockLight[index] = value;
  noteTouched(chunk);
  return true;
}

function cellEmission(world: VoxelWorld, chunk: Chunk, localX: number, y: number, localZ: number, worldX: number, worldZ: number): number {
  const block = chunk.get(localX, y, localZ) as BlockId;
  if (block === BlockId.Furnace) return world.blockEmissionAt(worldX, y, worldZ);
  return getBlockDefinition(block).emission ?? 0;
}

export function fillColumnSky(chunk: Chunk, localX: number, localZ: number): void {
  let sky = 15;
  for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    const definition = getBlockDefinition(chunk.get(localX, y, localZ));
    if (skyOcclusionClass(definition) === 'block') {
      setSky(chunk, localX, y, localZ, 0);
      sky = 0;
      continue;
    }
    setSky(chunk, localX, y, localZ, sky);
    sky = Math.max(0, sky - skyAttenuation(definition));
  }
}

export function getSkyLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (!chunk.skyReady) ensureChunkSky(world, chunk);
  return chunk.skyLight[chunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function getBlockLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (!chunk.blockLightReady) ensureChunkBlockLight(world, chunk);
  return chunk.blockLight[chunkIndex(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))] ?? 0;
}

export function combinedLight(world: VoxelWorld, x: number, y: number, z: number, daylight = 1): number {
  const sky = getSkyLight(world, x, y, z) * Math.max(0, Math.min(1, daylight));
  const block = getBlockLight(world, x, y, z);
  return Math.max(sky, block);
}

/**
 * Minecraft-style 4-tap smooth lighting for one cube-face corner.
 * Averages the cells that meet at the vertex on the exposed side of the face
 * so cave openings interpolate instead of flipping from full sky to 0 on a grid edge.
 */
export function smoothFaceCornerLight(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
): { sky: number; block: number } {
  const startX = nx !== 0 ? x + nx : x + cx - 1;
  const startY = ny !== 0 ? y + ny : y + cy - 1;
  const startZ = nz !== 0 ? z + nz : z + cz - 1;
  const countX = nx !== 0 ? 1 : 2;
  const countY = ny !== 0 ? 1 : 2;
  const countZ = nz !== 0 ? 1 : 2;
  let sky = 0;
  let block = 0;
  let samples = 0;
  for (let iz = 0; iz < countZ; iz += 1) {
    for (let iy = 0; iy < countY; iy += 1) {
      for (let ix = 0; ix < countX; ix += 1) {
        sky += getSkyLight(world, startX + ix, startY + iy, startZ + iz);
        block += getBlockLight(world, startX + ix, startY + iy, startZ + iz);
        samples += 1;
      }
    }
  }
  const inv = 1 / Math.max(1, samples);
  return { sky: sky * inv, block: block * inv };
}

/** Packed 0–15 sky/block sample. If the cell is unlit, uses the brightest neighbor air. */
export function sampleVoxelLightLevels(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): { sky: number; block: number } {
  let sky = getSkyLight(world, x, y, z);
  let block = getBlockLight(world, x, y, z);
  if (sky > 0 || block > 0) return { sky, block };
  for (const [dx, dy, dz] of NEIGHBOURS) {
    sky = Math.max(sky, getSkyLight(world, x + dx, y + dy, z + dz));
    block = Math.max(block, getBlockLight(world, x + dx, y + dy, z + dz));
  }
  return { sky, block };
}

export function continueSkyFill(chunk: Chunk, deadline?: number): boolean {
  if (chunk.skyReady) return true;
  const started = performance.now();
  let didWork = false;
  let columnsThisSlice = 0;
  while (chunk.skyFillCursor < COLUMN_COUNT) {
    if (
      deadline !== undefined
      && (columnsThisSlice >= MAX_COLUMNS_PER_SLICE || (shouldYield(deadline, didWork) && chunk.skyFillCursor % YIELD_COLUMN_STEP === 0))
    ) {
      recordSlice(started);
      return false;
    }
    const localX = chunk.skyFillCursor % CHUNK_SIZE;
    const localZ = (chunk.skyFillCursor / CHUNK_SIZE) | 0;
    fillColumnSky(chunk, localX, localZ);
    chunk.skyFillCursor += 1;
    lightFrameStats.columns += 1;
    columnsThisSlice += 1;
    didWork = true;
  }
  chunk.skyReady = true;
  lightEngineStats.skyRecomputes += 1;
  recordSlice(started);
  return true;
}

export function ensureChunkSky(world: VoxelWorld, chunk: Chunk): void {
  if (chunk.skyReady) return;
  recomputeChunkSky(world, chunk);
}

export function recomputeChunkSky(_world: VoxelWorld, chunk: Chunk): void {
  chunk.skyFillCursor = 0;
  chunk.skyReady = false;
  continueSkyFill(chunk);
}

function resetFlood(ownerKey: string): void {
  floodHead = 0;
  floodTail = 0;
  floodOwnerKey = ownerKey;
}

function floodPush(x: number, y: number, z: number, light: number): void {
  if (floodTail >= FLOOD_CAP || light <= 0) return;
  floodX[floodTail] = x;
  floodY[floodTail] = y;
  floodZ[floodTail] = z;
  floodL[floodTail] = light;
  floodTail += 1;
}

function stepFloodNode(world: VoxelWorld): void {
  const x = floodX[floodHead]!;
  const y = floodY[floodHead]!;
  const z = floodZ[floodHead]!;
  const light = floodL[floodHead]!;
  floodHead += 1;
  lightFrameStats.nodes += 1;
  if (light <= 1) return;
  for (const [dx, dy, dz] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (ny < 0 || ny >= WORLD_HEIGHT) continue;
    const chunk = loadedChunk(world, nx, nz);
    if (!chunk) continue;
    const localX = positiveMod(nx, CHUNK_SIZE);
    const localZ = positiveMod(nz, CHUNK_SIZE);
    const definition = getBlockDefinition(chunk.get(localX, ny, localZ));
    if (definition.occludesFaces && (definition.emission ?? 0) <= 0) continue;
    const next = light - 1;
    const index = chunkIndex(localX, ny, localZ);
    if (next <= (chunk.blockLight[index] ?? 0)) continue;
    chunk.blockLight[index] = next;
    noteTouched(chunk);
    floodPush(nx, ny, nz, next);
  }
}

function continueFlood(world: VoxelWorld, deadline?: number, nodeCap = MAX_PROPAGATION_NODES): boolean {
  let processed = 0;
  const sliceCap = deadline === undefined ? nodeCap : Math.min(nodeCap, MAX_NODES_PER_SLICE);
  while (floodHead < floodTail && processed < sliceCap) {
    if (shouldYield(deadline, processed > 0) && processed % YIELD_NODE_STEP === 0) return false;
    stepFloodNode(world);
    processed += 1;
  }
  return floodHead >= floodTail;
}

function scanEmitterColumn(
  world: VoxelWorld,
  chunk: Chunk,
  localX: number,
  localZ: number,
): void {
  const worldX = chunk.x * CHUNK_SIZE + localX;
  const worldZ = chunk.z * CHUNK_SIZE + localZ;
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    const emission = cellEmission(world, chunk, localX, y, localZ, worldX, worldZ);
    if (emission <= 0) continue;
    setBlockLightValue(chunk, localX, y, localZ, emission);
    floodPush(worldX, y, worldZ, emission);
  }
}

export function lightingFloodOwner(): string {
  return floodOwnerKey;
}

/** If the in-progress flood's chunk was pruned or left the live generate radius, drop the mutex. */
export function abandonLightingFloodIfOrphaned(keepOwner: (key: string) => boolean): boolean {
  if (floodOwnerKey === '' || floodOwnerKey === 'region') return false;
  if (keepOwner(floodOwnerKey)) return false;
  floodHead = 0;
  floodTail = 0;
  floodOwnerKey = '';
  return true;
}

/** Restart block-light seeding after an obsolete flood is dropped. Sky fill is kept. */
export function resetIncompleteBlockLighting(chunk: Chunk): void {
  if (chunk.blockLightReady) return;
  chunk.blockScanCursor = 0;
}

function absorbBorderBlockLight(world: VoxelWorld, chunk: Chunk): void {
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  const edges: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < CHUNK_SIZE; i += 1) {
    edges.push([0, i, -1, 0], [CHUNK_SIZE - 1, i, 1, 0], [i, 0, 0, -1], [i, CHUNK_SIZE - 1, 0, 1]);
  }
  for (const [localX, localZ, dx, dz] of edges) {
    const neighbor = loadedChunk(world, originX + localX + dx, originZ + localZ + dz);
    if (!neighbor) continue;
    const neighborLocalX = positiveMod(originX + localX + dx, CHUNK_SIZE);
    const neighborLocalZ = positiveMod(originZ + localZ + dz, CHUNK_SIZE);
    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      const incoming = neighbor.blockLight[chunkIndex(neighborLocalX, y, neighborLocalZ)] ?? 0;
      if (incoming <= 1) continue;
      const definition = getBlockDefinition(chunk.get(localX, y, localZ));
      if (definition.occludesFaces && (definition.emission ?? 0) <= 0) continue;
      const next = incoming - 1;
      const index = chunkIndex(localX, y, localZ);
      if (next <= (chunk.blockLight[index] ?? 0)) continue;
      chunk.blockLight[index] = next;
      noteTouched(chunk);
      floodPush(originX + localX, y, originZ + localZ, next);
    }
  }
}

export function continueBlockSeed(world: VoxelWorld, chunk: Chunk, deadline?: number): boolean {
  if (chunk.blockLightReady) return true;
  const started = performance.now();
  const owner = chunkKey(chunk.x, chunk.z);
  if (chunk.blockScanCursor === 0 && floodOwnerKey !== owner) {
    chunk.blockLight.fill(0);
    resetFlood(owner);
  }
  let didWork = chunk.blockScanCursor > 0 || floodHead > 0;
  let columnsThisSlice = 0;
  while (chunk.blockScanCursor < COLUMN_COUNT) {
    if (
      deadline !== undefined
      && (columnsThisSlice >= MAX_COLUMNS_PER_SLICE || (shouldYield(deadline, didWork) && chunk.blockScanCursor % YIELD_COLUMN_STEP === 0))
    ) {
      recordSlice(started);
      return false;
    }
    const localX = chunk.blockScanCursor % CHUNK_SIZE;
    const localZ = (chunk.blockScanCursor / CHUNK_SIZE) | 0;
    scanEmitterColumn(world, chunk, localX, localZ);
    chunk.blockScanCursor += 1;
    lightFrameStats.columns += 1;
    columnsThisSlice += 1;
    didWork = true;
  }
  if (chunk.blockScanCursor === COLUMN_COUNT && floodOwnerKey === owner && floodHead === 0 && floodTail === 0) {
    absorbBorderBlockLight(world, chunk);
  }
  if (!continueFlood(world, deadline)) {
    recordSlice(started);
    return false;
  }
  if (floodOwnerKey === owner) {
    absorbBorderBlockLight(world, chunk);
    if (!continueFlood(world, deadline)) {
      recordSlice(started);
      return false;
    }
  }
  chunk.blockLightReady = true;
  floodOwnerKey = '';
  lightEngineStats.blockPropagations += 1;
  recordSlice(started);
  return true;
}

export function seedChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  chunk.blockLightReady = false;
  chunk.blockScanCursor = 0;
  floodOwnerKey = '';
  continueBlockSeed(world, chunk);
}

export function ensureChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  if (chunk.blockLightReady) return;
  seedChunkBlockLight(world, chunk);
}

/** Resumable initial lighting. Returns true when sky and block light are stable. */
export function processChunkLighting(world: VoxelWorld, chunk: Chunk, deadline?: number): boolean {
  lightFrameStats.jobsActive += 1;
  if (!continueSkyFill(chunk, deadline)) return false;
  if (!continueBlockSeed(world, chunk, deadline)) return false;
  return true;
}

export function relightAround(world: VoxelWorld, x: number, y: number, z: number, radius = 14, recomputeSky = true): void {
  relightRegion(world, {
    minX: x - radius,
    minY: y - radius,
    minZ: z - radius,
    maxX: x + radius,
    maxY: y + radius,
    maxZ: z + radius,
  }, recomputeSky, true);
}

/**
 * Relights a bounding region. Sky is vertical columns only — no 6-pass spread.
 * Block light floods the AABB from current emitters. Light writes never mark
 * geometry dirty; callers bump `lightVersion` once per touched chunk.
 */
export function relightRegion(
  world: VoxelWorld,
  region: LightRegion,
  recomputeSky = true,
  propagateBlock = true,
  deadline?: number,
): boolean {
  const started = performance.now();
  const minX = Math.floor(region.minX);
  const maxX = Math.floor(region.maxX);
  const minY = Math.max(0, Math.floor(region.minY));
  const maxY = Math.min(WORLD_HEIGHT - 1, Math.floor(region.maxY));
  const minZ = Math.floor(region.minZ);
  const maxZ = Math.floor(region.maxZ);

  if (recomputeSky) {
    if (!updateSkyInRegion(world, minX, maxX, minZ, maxZ, deadline)) {
      recordSlice(started);
      return false;
    }
  }
  if (propagateBlock && maxY >= minY) {
    if (!propagateBlockLight(world, minX, minY, minZ, maxX, maxY, maxZ, deadline)) {
      recordSlice(started);
      return false;
    }
    lightEngineStats.blockPropagations += 1;
  }
  recordSlice(started);
  return true;
}

function recomputeSkyColumn(world: VoxelWorld, x: number, z: number): void {
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return;
  fillColumnSky(chunk, positiveMod(x, CHUNK_SIZE), positiveMod(z, CHUNK_SIZE));
}

function updateSkyInRegion(
  world: VoxelWorld,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  deadline?: number,
): boolean {
  const touchedKeys = new Set<string>();
  let columns = 0;
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const chunk = loadedChunk(world, x, z);
      if (!chunk) continue;
      if (!chunk.skyReady) {
        if (!continueSkyFill(chunk, deadline)) return false;
        touchedKeys.add(chunkKey(chunk.x, chunk.z));
        continue;
      }
      if (shouldYield(deadline, columns > 0) && columns % YIELD_COLUMN_STEP === 0) return false;
      recomputeSkyColumn(world, x, z);
      touchedKeys.add(chunkKey(chunk.x, chunk.z));
      columns += 1;
      lightFrameStats.columns += 1;
    }
  }
  lightEngineStats.skyRecomputes += touchedKeys.size;
  return true;
}

function cellEmissionAt(world: VoxelWorld, chunk: Chunk, x: number, y: number, z: number): number {
  return cellEmission(world, chunk, positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), x, z);
}

function propagateBlockLight(
  world: VoxelWorld,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  deadline?: number,
): boolean {
  resetFlood('region');
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const chunk = loadedChunk(world, x, z);
        if (!chunk) continue;
        const localX = positiveMod(x, CHUNK_SIZE);
        const localZ = positiveMod(z, CHUNK_SIZE);
        const emission = cellEmissionAt(world, chunk, x, y, z);
        setBlockLightValue(chunk, localX, y, localZ, emission);
        if (emission > 0) floodPush(x, y, z, emission);
      }
    }
  }
  const done = continueFlood(world, deadline);
  floodOwnerKey = '';
  return done;
}

/** Add-only block light: flood from known emitters without scanning a 29³ AABB. */
export function addBlockLightEmitters(
  world: VoxelWorld,
  emitters: ReadonlyArray<readonly [number, number, number]>,
  deadline?: number,
): boolean {
  const started = performance.now();
  resetFlood('region');
  for (const [x, y, z] of emitters) {
    if (y < 0 || y >= WORLD_HEIGHT) continue;
    const chunk = loadedChunk(world, x, z);
    if (!chunk) continue;
    const emission = cellEmissionAt(world, chunk, x, y, z);
    if (emission <= 0) continue;
    setBlockLightValue(chunk, positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), emission);
    floodPush(x, y, z, emission);
  }
  const done = continueFlood(world, deadline);
  floodOwnerKey = '';
  lightEngineStats.blockPropagations += 1;
  recordSlice(started);
  return done;
}

export interface PendingLightJob {
  region: LightRegion;
  sky: boolean;
  block: boolean;
}

export function continuePendingLight(world: VoxelWorld, job: PendingLightJob, deadline?: number): boolean {
  lightFrameStats.jobsActive += 1;
  return relightRegion(world, job.region, job.sky, job.block, deadline);
}
