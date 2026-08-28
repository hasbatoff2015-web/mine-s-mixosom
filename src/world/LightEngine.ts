import { BLOCKS, BlockId, getBlockDefinition, type BlockDefinition } from '../blocks';
import { CHUNK_SIZE, LATERAL_SKY_RADIUS, WORLD_HEIGHT, chunkKey, floorDiv, positiveMod } from '../core/constants';
import { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

const COLUMNS = CHUNK_SIZE * CHUNK_SIZE;
const VOLUME = COLUMNS * WORLD_HEIGHT;
const SLOT_SHIFT = Math.ceil(Math.log2(VOLUME));
const SLOT_SIZE = 2 ** SLOT_SHIFT;
const SLOT_MASK = SLOT_SIZE - 1;
const SNAPSHOT_PAGE_SIZE = 4096;
const RETAINED_FLAG_BUFFERS = 16;
const DX = [1, -1, 0, 0, 0, 0] as const;
const DZ = [0, 0, 0, 0, 1, -1] as const;
const HORIZONTAL = [0, 1, 4, 5] as const;
export const MAX_LIGHT_COLUMNS_PER_SLICE = 256;
export const MAX_LIGHT_NODES_PER_SLICE = 4096;

export interface LightRegion {
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
}
export const LIGHT_FLOOD_REGION = 'region';
export const LIGHT_FLOOD_ADD_EMITTER = 'add-emitter';
export type LightJobOrigin = 'fluid' | 'edit' | 'other';
export interface PendingLightJob {
  region: LightRegion;
  sky: boolean;
  block: boolean;
  origin: LightJobOrigin;
}
export interface LightFrameStats {
  jobsActive: number; jobsPending: number; columns: number; nodes: number;
  ms: number; maxSlice: number; dirtyLightChunks: number;
}
export const lightEngineStats = { skyRecomputes: 0, blockPropagations: 0 };
export const lightFrameStats: LightFrameStats = {
  jobsActive: 0, jobsPending: 0, columns: 0, nodes: 0, ms: 0, maxSlice: 0, dirtyLightChunks: 0,
};

export function skyOcclusionClass(definition: BlockDefinition | undefined): 'block' | 'attenuate' | 'pass' {
  if (!definition || definition.id === BlockId.Air) return 'pass';
  if (definition.occludesFaces) return 'block';
  if (definition.liquid || (definition.renderLayer === 'cutout' && definition.renderShape === 'cube')) return 'attenuate';
  return 'pass';
}
export function skyAttenuation(definition: BlockDefinition): number {
  const kind = skyOcclusionClass(definition);
  return kind === 'block' ? 16 : kind === 'attenuate' ? 1 : 0;
}
const FILTER = new Uint8Array(65536);
const EMISSION = new Uint8Array(65536);
const OCCLUDES = new Uint8Array(65536);
for (const definition of BLOCKS) {
  FILTER[definition.id] = skyAttenuation(definition);
  EMISSION[definition.id] = definition.emission ?? 0;
  OCCLUDES[definition.id] = Number(definition.occludesFaces);
}
export type LightingInvalidation = 'none' | 'addEmitter' | 'region';
export function lightingInvalidation(previous: BlockId, next: BlockId): LightingInvalidation {
  if (FILTER[previous] !== FILTER[next] || OCCLUDES[previous] !== OCCLUDES[next]) return 'region';
  if (EMISSION[next]! > EMISSION[previous]!) return 'addEmitter';
  if (EMISSION[next]! < EMISSION[previous]!) return 'region';
  return 'none';
}

type LightPages = Array<Uint8Array | undefined>;
interface Snapshot { sky?: LightPages; block?: LightPages; initial: boolean }
interface Entry {
  readonly chunk: Chunk;
  readonly slot: number;
  readonly queued: Uint32Array;
  readonly neighbors: Array<Entry | undefined>;
  snapshot?: Snapshot;
}
type Phase = 'sky-clear' | 'sky-seed' | 'sky-flood' | 'block-clear' | 'block-seed' | 'block-flood' | 'done';
interface LightState {
  readonly world: VoxelWorld;
  owner: string;
  phase: Phase;
  channel: 'sky' | 'block';
  cursor: number;
  block: boolean;
  region?: LightRegion;
  initial?: Chunk;
  job?: PendingLightJob;
  targets: Chunk[];
  entries: Entry[];
  readonly entryMap: Map<Chunk, Entry>;
  readonly flagPool: Uint32Array[];
  queue: Uint32Array;
  head: number;
  size: number;
  readonly touched: Map<Chunk, Snapshot>;
  emitters: Array<readonly [number, number, number]>;
  emitterCursor: number;
  snapshotBytes: number;
  peakSnapshotBytes: number;
  peakFlagsBytes: number;
  peakQueueBytes: number;
}
const states = new WeakMap<VoxelWorld, LightState>();
let lastState: LightState | undefined;
/** Session teardown must also release the legacy diagnostic reference to the last world. */
export function disposeWorldLighting(world: VoxelWorld): void {
  if (lastState === states.get(world)) lastState = undefined;
  states.delete(world);
}
function stateFor(world: VoxelWorld): LightState {
  let state = states.get(world);
  if (!state) {
    state = {
      world, owner: '', phase: 'done', channel: 'block', cursor: 0, block: false,
      targets: [], entries: [], entryMap: new Map(), flagPool: [], queue: new Uint32Array(32768),
      head: 0, size: 0, touched: new Map(), emitters: [], emitterCursor: 0,
      snapshotBytes: 0, peakSnapshotBytes: 0, peakFlagsBytes: 0, peakQueueBytes: 32768 * 4,
    };
    states.set(world, state);
  }
  lastState = state;
  return state;
}
function entryFor(state: LightState, chunk: Chunk): Entry {
  let entry = state.entryMap.get(chunk);
  if (entry) return entry;
  const slot = state.entries.length;
  const queued = state.flagPool[slot] ?? (state.flagPool[slot] = new Uint32Array(Math.ceil(VOLUME / 32)));
  state.peakFlagsBytes = Math.max(state.peakFlagsBytes, state.flagPool.length * queued.byteLength);
  queued.fill(0);
  entry = { chunk, slot, queued, neighbors: [] };
  state.entries.push(entry);
  state.entryMap.set(chunk, entry);
  return entry;
}
function loadedChunk(world: VoxelWorld, x: number, z: number): Chunk | undefined {
  return world.chunks.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
}
function touch(state: LightState, entry: Entry, index: number, channel: 'sky' | 'block'): void {
  const chunk = entry.chunk;
  let snapshot = entry.snapshot ?? state.touched.get(chunk);
  if (!snapshot) {
    snapshot = { initial: !chunk.lightingReady };
    state.touched.set(chunk, snapshot);
  }
  entry.snapshot = snapshot;
  if (!snapshot.initial) {
    const pages = snapshot[channel] ?? (snapshot[channel] = []);
    const page = Math.floor(index / SNAPSHOT_PAGE_SIZE);
    if (!pages[page]) {
      const values = channel === 'sky' ? chunk.skyLight : chunk.blockLight;
      pages[page] = values.slice(page * SNAPSHOT_PAGE_SIZE, (page + 1) * SNAPSHOT_PAGE_SIZE);
      if (channel === 'sky') {
        const before = pages[page]!;
        for (let offset = 0; offset < before.length; offset += 1) before[offset] = chunk.skyLightAtIndex(page * SNAPSHOT_PAGE_SIZE + offset);
      }
      state.snapshotBytes += pages[page]!.byteLength;
      state.peakSnapshotBytes = Math.max(state.peakSnapshotBytes, state.snapshotBytes);
    }
  }
  chunk.lightPending = true;
}
function write(state: LightState, entry: Entry, index: number, value: number, channel: 'sky' | 'block'): void {
  const values = channel === 'sky' ? entry.chunk.skyLight : entry.chunk.blockLight;
  const previous = channel === 'sky' ? entry.chunk.skyLightAtIndex(index) : values[index];
  if (previous !== value) touch(state, entry, index, channel);
  if (values[index] === value) return;
  values[index] = value;
  if (channel === 'block' && value > 0) entry.chunk.blockLightTop = Math.max(entry.chunk.blockLightTop, Math.floor(index / COLUMNS));
}
function changedBorders(pages: LightPages | undefined, chunk: Chunk, sky: boolean): number {
  if (!pages) return -1;
  let mask = -1;
  for (let page = 0; page < pages.length; page += 1) {
    const before = pages[page];
    if (!before) continue;
    for (let offset = 0; offset < before.length; offset += 1) {
      const i = page * SNAPSHOT_PAGE_SIZE + offset;
      if (before[offset] === (sky ? chunk.skyLightAtIndex(i) : chunk.blockLight[i])) continue;
      if (mask < 0) mask = 0;
      const x = i % CHUNK_SIZE;
      const z = Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
      if (x === CHUNK_SIZE - 1) mask |= 1;
      if (x === 0) mask |= 2;
      if (z === CHUNK_SIZE - 1) mask |= 4;
      if (z === 0) mask |= 8;
      if (x === CHUNK_SIZE - 1 && z === CHUNK_SIZE - 1) mask |= 16;
      if (x === 0 && z === CHUNK_SIZE - 1) mask |= 32;
      if (x === CHUNK_SIZE - 1 && z === 0) mask |= 64;
      if (x === 0 && z === 0) mask |= 128;
    }
  }
  return mask;
}
export function consumeLightTouched(world?: VoxelWorld): Chunk[] {
  const state = world ? stateFor(world) : lastState;
  if (!state) return [];
  const result: Chunk[] = [];
  for (const [chunk, snapshot] of state.touched) {
    const sky = changedBorders(snapshot.sky, chunk, true);
    const block = changedBorders(snapshot.block, chunk, false);
    if (!snapshot.initial && sky < 0 && block < 0) continue;
    chunk.changedLightBorders = snapshot.initial ? 255 : Math.max(0, sky) | Math.max(0, block);
    result.push(chunk);
  }
  state.touched.clear();
  state.snapshotBytes = 0;
  for (const entry of state.entries) entry.snapshot = undefined;
  if (!state.owner) {
    state.entries = [];
    state.entryMap.clear();
    state.targets = [];
    state.initial = undefined;
    state.job = undefined;
    state.region = undefined;
    state.flagPool.length = Math.min(RETAINED_FLAG_BUFFERS, state.flagPool.length);
    if (state.queue.length > 32768) state.queue = new Uint32Array(32768);
  }
  return result;
}
export function peekLightTouched(world?: VoxelWorld): ReadonlySet<Chunk> {
  return new Set((world ? stateFor(world) : lastState)?.touched.keys());
}
export function resetLightEngineStats(): void {
  lightEngineStats.skyRecomputes = 0;
  lightEngineStats.blockPropagations = 0;
}
export function resetLightFrameStats(): void {
  for (const key of Object.keys(lightFrameStats) as Array<keyof LightFrameStats>) lightFrameStats[key] = 0;
}
function recordSlice(started: number): void {
  const elapsed = performance.now() - started;
  lightFrameStats.ms += elapsed;
  lightFrameStats.maxSlice = Math.max(lightFrameStats.maxSlice, elapsed);
}
function clearQueue(state: LightState): void {
  state.head = 0;
  state.size = 0;
  for (const entry of state.entries) entry.queued.fill(0);
}
function push(state: LightState, entry: Entry, index: number): void {
  const word = index >>> 5;
  const bit = 1 << (index & 31);
  if (entry.queued[word]! & bit) return;
  // One pending entry per voxel. Capacity is bounded by loaded job voxels;
  // unlike the old append-only 8192 cap, exhaustion never discards light.
  if (state.size === state.queue.length) {
    const next = new Uint32Array(Math.min(state.queue.length * 2, state.entries.length * VOLUME));
    for (let i = 0; i < state.size; i += 1) next[i] = state.queue[(state.head + i) % state.queue.length]!;
    state.queue = next;
    state.peakQueueBytes = Math.max(state.peakQueueBytes, next.byteLength);
    state.head = 0;
  }
  state.queue[(state.head + state.size) % state.queue.length] = entry.slot * SLOT_SIZE + index;
  state.size += 1;
  entry.queued[word] = entry.queued[word]! | bit;
}
function neighbor(state: LightState, entry: Entry, index: number, dir: number): number {
  const x = index % CHUNK_SIZE;
  const z = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
  const y = Math.floor(index / COLUMNS);
  if (dir === 2) return y + 1 < WORLD_HEIGHT ? entry.slot * SLOT_SIZE + index + COLUMNS : -1;
  if (dir === 3) return y > 0 ? entry.slot * SLOT_SIZE + index - COLUMNS : -1;
  if (dir === 0 && x < CHUNK_SIZE - 1) return entry.slot * SLOT_SIZE + index + 1;
  if (dir === 1 && x > 0) return entry.slot * SLOT_SIZE + index - 1;
  if (dir === 4 && z < CHUNK_SIZE - 1) return entry.slot * SLOT_SIZE + index + CHUNK_SIZE;
  if (dir === 5 && z > 0) return entry.slot * SLOT_SIZE + index - CHUNK_SIZE;
  let other = entry.neighbors[dir];
  if (!other) {
    const chunk = state.world.chunks.get(chunkKey(entry.chunk.x + DX[dir]!, entry.chunk.z + DZ[dir]!));
    if (!chunk) return -1;
    other = entryFor(state, chunk);
    entry.neighbors[dir] = other;
  }
  const offset = dir === 0 ? -(CHUNK_SIZE - 1) : dir === 1 ? CHUNK_SIZE - 1
    : dir === 4 ? -(CHUNK_SIZE - 1) * CHUNK_SIZE : (CHUNK_SIZE - 1) * CHUNK_SIZE;
  return other.slot * SLOT_SIZE + index + offset;
}
function inside(state: LightState, entry: Entry, index: number, sky: boolean): boolean {
  const region = state.region;
  if (!region) return true;
  const x = entry.chunk.x * CHUNK_SIZE + index % CHUNK_SIZE;
  const z = entry.chunk.z * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
  const y = Math.floor(index / COLUMNS);
  return x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ
    && (sky || (y >= region.minY && y <= region.maxY));
}
function floodNode(state: LightState): void {
  const packed = state.queue[state.head]!;
  state.head = (state.head + 1) % state.queue.length;
  state.size -= 1;
  const entry = state.entries[packed >>> SLOT_SHIFT]!;
  const index = packed & SLOT_MASK;
  entry.queued[index >>> 5] = entry.queued[index >>> 5]! & ~(1 << (index & 31));
  const sky = state.channel === 'sky';
  const level = sky ? entry.chunk.skyLightAtIndex(index) : entry.chunk.blockLight[index]!;
  if (level <= 1) return;
  for (let dir = 0; dir < 6; dir += 1) {
    const cell = neighbor(state, entry, index, dir);
    if (cell < 0) continue;
    const target = state.entries[cell >>> SLOT_SHIFT]!;
    const at = cell & SLOT_MASK;
    if (!inside(state, target, at, sky)) continue;
    if (sky && !target.chunk.skyReady && !state.region) continue;
    const id = target.chunk.blocks[at]!;
    if (sky ? FILTER[id] === 16 : OCCLUDES[id] && !EMISSION[id]) continue;
    const next = level - 1 - (sky ? FILTER[id]! : 0);
    if (sky && next < 15 - LATERAL_SKY_RADIUS) continue;
    const value = sky ? target.chunk.skyLightAtIndex(at) : target.chunk.blockLight[at]!;
    if (next <= value) continue;
    write(state, target, at, next, state.channel);
    push(state, target, at);
  }
}
function emissionAt(state: LightState, entry: Entry, index: number): number {
  const id = entry.chunk.blocks[index]!;
  return id === BlockId.Furnace
    ? state.world.blockEmissionAt(entry.chunk.x * CHUNK_SIZE + index % CHUNK_SIZE, Math.floor(index / COLUMNS),
      entry.chunk.z * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE)
    : EMISSION[id]!;
}
function fillColumn(chunk: Chunk, x: number, z: number, state?: LightState): void {
  let sky = 15;
  let filterHeight = 0;
  const entry = state ? entryFor(state, chunk) : undefined;
  for (let index = chunk.scanMaxY() * COLUMNS + z * CHUNK_SIZE + x; index >= 0; index -= COLUMNS) {
    const attenuation = FILTER[chunk.blocks[index]!]!;
    if (attenuation > 0 && filterHeight === 0) filterHeight = Math.floor(index / COLUMNS) + 1;
    if (attenuation === 16) sky = 0;
    if (state && entry) write(state, entry, index, sky, 'sky');
    else chunk.skyLight[index] = sky;
    sky = Math.max(0, sky - attenuation);
  }
  chunk.skyFilterHeights[z * CHUNK_SIZE + x] = filterHeight;
  chunk.skyStoredHeights[z * CHUNK_SIZE + x] = chunk.scanMaxY() + 1;
}
export function fillColumnSky(chunk: Chunk, x: number, z: number): void { fillColumn(chunk, x, z); }
export function continueSkyFill(chunk: Chunk, deadline?: number): boolean {
  if (chunk.skyReady) return true;
  let columns = 0;
  while (chunk.skyFillCursor < COLUMNS) {
    if (deadline !== undefined && columns > 0 && (columns >= MAX_LIGHT_COLUMNS_PER_SLICE
      || (columns % 4 === 0 && performance.now() >= deadline))) return false;
    fillColumn(chunk, chunk.skyFillCursor % CHUNK_SIZE, Math.floor(chunk.skyFillCursor / CHUNK_SIZE));
    chunk.skyFillCursor += 1;
    columns += 1;
    lightFrameStats.columns += 1;
  }
  chunk.skyReady = true;
  chunk.skyLateralReady = false;
  lightEngineStats.skyRecomputes += 1;
  return true;
}
function seedSkyColumn(state: LightState, entry: Entry, column: number): void {
  const chunk = entry.chunk;
  let maxY = chunk.skyFilterHeights[column]!;
  let boundary = false;
  for (const dir of HORIZONTAL) {
    const packed = neighbor(state, entry, column, dir);
    if (packed < 0) continue;
    const other = state.entries[packed >>> SLOT_SHIFT]!;
    const at = packed & SLOT_MASK;
    maxY = Math.max(maxY, other.chunk.skyFilterHeights[at]!);
    boundary ||= state.region ? !inside(state, other, at, true) : other.chunk !== chunk;
  }
  for (let index = column; index < Math.min(WORLD_HEIGHT, maxY) * COLUMNS; index += COLUMNS) {
    const id = chunk.blocks[index]!;
    if (FILTER[id] === 16) continue;
    let value = chunk.skyLightAtIndex(index);
    if (value <= 1 && !boundary) continue;
    for (const dir of HORIZONTAL) {
      const packed = neighbor(state, entry, index, dir);
      if (packed < 0) continue;
      const other = state.entries[packed >>> SLOT_SHIFT]!;
      const at = packed & SLOT_MASK;
      if (!other.chunk.skyReady && !(state.region && inside(state, other, at, true))) continue;
      const external = state.region ? !inside(state, other, at, true) : other.chunk !== chunk;
      const incoming = other.chunk.skyLightAtIndex(at) - 1 - FILTER[id]!;
      if (external && incoming > value && incoming >= 15 - LATERAL_SKY_RADIUS) {
        write(state, entry, index, incoming, 'sky');
        value = incoming;
        push(state, entry, index);
      }
      if (value > 1 && value - 1 - FILTER[other.chunk.blocks[at]!]! > other.chunk.skyLightAtIndex(at)) push(state, entry, index);
    }
  }
}
function seedBlockColumn(state: LightState, entry: Entry, column: number): void {
  const minY = Math.max(0, Math.ceil(state.region?.minY ?? 0));
  let top = Math.max(entry.chunk.scanMaxY(), entry.chunk.blockLightTop);
  for (const dir of HORIZONTAL) {
    const packed = neighbor(state, entry, column, dir);
    if (packed >= 0) top = Math.max(top, state.entries[packed >>> SLOT_SHIFT]!.chunk.blockLightTop);
  }
  const maxY = Math.min(top, Math.floor(state.region?.maxY ?? WORLD_HEIGHT - 1));
  const x = entry.chunk.x * CHUNK_SIZE + column % CHUNK_SIZE;
  const z = entry.chunk.z * CHUNK_SIZE + Math.floor(column / CHUNK_SIZE);
  const minX = state.region?.minX ?? entry.chunk.x * CHUNK_SIZE;
  const maxX = state.region?.maxX ?? (entry.chunk.x + 1) * CHUNK_SIZE - 1;
  const minZ = state.region?.minZ ?? entry.chunk.z * CHUNK_SIZE;
  const maxZ = state.region?.maxZ ?? (entry.chunk.z + 1) * CHUNK_SIZE - 1;
  for (let y = minY; y <= maxY; y += 1) {
    const index = y * COLUMNS + column;
    const id = entry.chunk.blocks[index]!;
    if ((EMISSION[id] || id === BlockId.Furnace) && entry.chunk.blockLight[index]! > 0) push(state, entry, index);
    if (OCCLUDES[id] && !EMISSION[id]) continue;
    if (x !== minX && x !== maxX && z !== minZ && z !== maxZ && y !== minY && y !== maxY) continue;
    for (let dir = 0; dir < 6; dir += 1) {
      if (dir === 0 ? x !== maxX : dir === 1 ? x !== minX : dir === 2 ? y !== maxY
        : dir === 3 ? y !== minY : dir === 4 ? z !== maxZ : z !== minZ) continue;
      const packed = neighbor(state, entry, index, dir);
      if (packed < 0) continue;
      const other = state.entries[packed >>> SLOT_SHIFT]!;
      const at = packed & SLOT_MASK;
      // Invalidated import chunks still contain old arrays until their own clear stage.
      if (state.initial && !other.chunk.blockLightReady) continue;
      const external = state.region ? !inside(state, other, at, false) : other.chunk !== entry.chunk;
      if (!external) continue;
      const incoming = other.chunk.blockLight[at]! - 1;
      if (incoming <= entry.chunk.blockLight[index]!) continue;
      write(state, entry, index, incoming, 'block');
      push(state, entry, index);
    }
  }
}
function startWork(state: LightState, owner: string, sky: boolean, block: boolean, initial?: Chunk, job?: PendingLightJob): void {
  clearQueue(state);
  state.emitters = [];
  state.emitterCursor = 0;
  state.entries = [];
  state.entryMap.clear();
  state.owner = owner;
  state.initial = initial;
  state.job = job;
  state.region = job?.region;
  state.targets = initial ? [initial] : [...state.world.chunks.values()].filter((chunk) => {
    const r = state.region!;
    return chunk.x * CHUNK_SIZE <= r.maxX && (chunk.x + 1) * CHUNK_SIZE > r.minX
      && chunk.z * CHUNK_SIZE <= r.maxZ && (chunk.z + 1) * CHUNK_SIZE > r.minZ;
  });
  state.phase = sky ? (initial ? 'sky-seed' : 'sky-clear') : 'block-clear';
  state.channel = sky ? 'sky' : 'block';
  state.block = block;
  state.cursor = 0;
}
function finishWork(state: LightState): void {
  for (const chunk of state.touched.keys()) chunk.lightPending = false;
  for (const chunk of state.targets) chunk.lightPending = false;
  state.owner = '';
  state.phase = 'done';
  state.emitters = [];
  state.emitterCursor = 0;
}
function advancePhase(state: LightState): void {
  state.cursor = 0;
  switch (state.phase) {
    case 'sky-clear': state.phase = 'sky-seed'; lightEngineStats.skyRecomputes += 1; break;
    case 'sky-seed': state.phase = 'sky-flood'; break;
    case 'sky-flood':
      if (state.initial) state.initial.skyLateralReady = true;
      state.phase = state.block ? 'block-clear' : 'done';
      state.channel = 'block';
      break;
    case 'block-clear': state.phase = 'block-seed'; break;
    case 'block-seed': state.phase = 'block-flood'; break;
    case 'block-flood':
      if (state.initial) state.initial.blockLightReady = true;
      lightEngineStats.blockPropagations += 1;
      state.phase = 'done';
      break;
  }
}
function continueWork(state: LightState, deadline?: number): boolean {
  let columns = 0;
  let nodes = 0;
  while (state.emitterCursor < state.emitters.length) {
    if (deadline !== undefined && (nodes >= MAX_LIGHT_NODES_PER_SLICE
      || (nodes > 0 && nodes % 32 === 0 && performance.now() >= deadline))) return false;
    const [x, y, z] = state.emitters[state.emitterCursor++]!;
    nodes += 1;
    lightFrameStats.nodes += 1;
    if (y < 0 || y >= WORLD_HEIGHT) continue;
    const chunk = loadedChunk(state.world, x, z);
    if (!chunk) continue;
    const entry = entryFor(state, chunk);
    const index = Chunk.index(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE));
    const value = emissionAt(state, entry, index);
    if (value <= 0) continue;
    write(state, entry, index, value, 'block');
    push(state, entry, index);
  }
  while (state.phase !== 'done') {
    const flood = state.phase === 'sky-flood' || state.phase === 'block-flood';
    if (flood) {
      while (state.size > 0) {
        if (deadline !== undefined && (nodes >= MAX_LIGHT_NODES_PER_SLICE
          || (nodes > 0 && nodes % 32 === 0 && performance.now() >= deadline))) return false;
        floodNode(state);
        nodes += 1;
        lightFrameStats.nodes += 1;
      }
    } else {
      while (state.cursor < state.targets.length * COLUMNS) {
        if (deadline !== undefined && (columns >= MAX_LIGHT_COLUMNS_PER_SLICE
          || (columns > 0 && columns % 4 === 0 && performance.now() >= deadline))) return false;
        const chunk = state.targets[Math.floor(state.cursor / COLUMNS)]!;
        const column = state.cursor % COLUMNS;
        state.cursor += 1;
        columns += 1;
        const entry = entryFor(state, chunk);
        if (!inside(state, entry, column, true)) continue;
        lightFrameStats.columns += 1;
        if (state.phase === 'sky-clear') fillColumn(chunk, column % CHUNK_SIZE, Math.floor(column / CHUNK_SIZE), state);
        else if (state.phase === 'sky-seed') seedSkyColumn(state, entry, column);
        else if (state.phase === 'block-clear') {
          const minY = Math.max(0, Math.ceil(state.region?.minY ?? 0));
          const maxY = Math.min(Math.max(chunk.scanMaxY(), chunk.blockLightTop), Math.floor(state.region?.maxY ?? WORLD_HEIGHT - 1));
          for (let y = minY; y <= maxY; y += 1) {
            const index = y * COLUMNS + column;
            write(state, entry, index, emissionAt(state, entry, index), 'block');
          }
          if (state.initial) state.initial.blockScanCursor = state.cursor;
        } else seedBlockColumn(state, entry, column);
      }
    }
    advancePhase(state);
    if (deadline !== undefined && (columns + nodes > 0) && performance.now() >= deadline && (state.phase as Phase) !== 'done') return false;
  }
  finishWork(state);
  return true;
}
export function lightingFloodOwner(world?: VoxelWorld): string { return (world ? stateFor(world) : lastState)?.owner ?? ''; }
export function abandonLightingFloodIfOrphaned(keepOwner: (key: string) => boolean, world?: VoxelWorld): boolean {
  const state = world ? stateFor(world) : lastState;
  if (!state || !state.owner || state.owner === LIGHT_FLOOD_REGION || state.owner === LIGHT_FLOOD_ADD_EMITTER || keepOwner(state.owner)) return false;
  clearQueue(state);
  finishWork(state);
  return true;
}
export function resetRegionLightFlood(world?: VoxelWorld): void {
  const state = world ? stateFor(world) : lastState;
  if (!state || state.owner !== LIGHT_FLOOD_REGION) return;
  clearQueue(state);
  state.owner = '';
}
export function resetIncompleteBlockLighting(chunk: Chunk): void {
  if (!chunk.blockLightReady) chunk.blockScanCursor = 0;
}
/** Imports invalidate cursors, not individual voxels; queued emission work must survive a restart. */
export function restartLightingAfterImport(world: VoxelWorld): Array<readonly [number, number, number]> {
  const state = states.get(world);
  if (!state?.owner) return [];
  const emitters = state.emitters;
  if (state.initial) {
    state.initial.skyReady = false;
    state.initial.skyLateralReady = false;
    state.initial.blockLightReady = false;
    state.initial.skyFillCursor = 0;
    state.initial.blockScanCursor = 0;
  }
  clearQueue(state);
  finishWork(state);
  return emitters;
}
export function processChunkLighting(world: VoxelWorld, chunk: Chunk, deadline?: number): boolean {
  if (chunk.lightingReady) return true;
  const started = performance.now();
  const state = stateFor(world);
  const owner = chunkKey(chunk.x, chunk.z);
  lightFrameStats.jobsActive += 1;
  if (state.owner && state.owner !== owner) return false;
  if (!continueSkyFill(chunk, deadline)) { recordSlice(started); return false; }
  if (state.owner !== owner) startWork(state, owner, !chunk.skyLateralReady, !chunk.blockLightReady, chunk);
  const done = continueWork(state, deadline);
  recordSlice(started);
  return done;
}
export function recomputeChunkSky(world: VoxelWorld, chunk: Chunk): void {
  const state = stateFor(world);
  chunk.skyReady = false;
  chunk.skyLateralReady = false;
  chunk.skyFillCursor = 0;
  continueSkyFill(chunk);
  startWork(state, chunkKey(chunk.x, chunk.z), true, false, chunk);
  continueWork(state);
}
export function ensureChunkSky(world: VoxelWorld, chunk: Chunk): void {
  if (!chunk.skyReady || !chunk.skyLateralReady) recomputeChunkSky(world, chunk);
}
export function seedChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  chunk.blockLightReady = false;
  chunk.blockScanCursor = 0;
  const state = stateFor(world);
  startWork(state, chunkKey(chunk.x, chunk.z), false, true, chunk);
  continueWork(state);
}
export function ensureChunkBlockLight(world: VoxelWorld, chunk: Chunk): void {
  if (!chunk.blockLightReady) seedChunkBlockLight(world, chunk);
}
export function relightRegion(world: VoxelWorld, region: LightRegion, sky = true, block = true, deadline?: number, job?: PendingLightJob): boolean {
  const started = performance.now();
  const state = stateFor(world);
  if (state.owner !== LIGHT_FLOOD_REGION || !job || state.job !== job) {
    startWork(state, LIGHT_FLOOD_REGION, sky, block, undefined, job ?? { region, sky, block, origin: 'other' });
    if (!sky && !block) state.phase = 'done';
  }
  const done = continueWork(state, deadline);
  recordSlice(started);
  return done;
}
export function relightAround(world: VoxelWorld, x: number, y: number, z: number, radius = 14, sky = true): void {
  relightRegion(world, { minX: x - radius, minY: y - radius, minZ: z - radius, maxX: x + radius, maxY: y + radius, maxZ: z + radius }, sky);
}
export function recomputeSkyColumnAt(world: VoxelWorld, x: number, z: number): void {
  relightRegion(world, { minX: x - LATERAL_SKY_RADIUS, maxX: x + LATERAL_SKY_RADIUS, minZ: z - LATERAL_SKY_RADIUS,
    maxZ: z + LATERAL_SKY_RADIUS, minY: 0, maxY: WORLD_HEIGHT - 1 }, true, false);
}
export function addBlockLightEmitters(world: VoxelWorld, emitters: ReadonlyArray<readonly [number, number, number]>, deadline?: number): boolean {
  const started = performance.now();
  lightFrameStats.jobsActive += 1;
  const state = stateFor(world);
  if (state.owner !== LIGHT_FLOOD_ADD_EMITTER) {
    clearQueue(state);
    state.entries = [];
    state.entryMap.clear();
    state.targets = [];
    state.region = undefined;
    state.initial = undefined;
    state.owner = LIGHT_FLOOD_ADD_EMITTER;
    state.phase = 'block-flood';
    state.channel = 'block';
    state.emitters = [];
    state.emitterCursor = 0;
  }
  for (const emitter of emitters) state.emitters.push(emitter);
  const done = continueWork(state, deadline);
  recordSlice(started);
  return done;
}
export function continuePendingLight(world: VoxelWorld, job: PendingLightJob, deadline?: number): boolean {
  lightFrameStats.jobsActive += 1;
  return relightRegion(world, job.region, job.sky, job.block, deadline, job);
}
export function getSkyLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (y > chunk.occupancyTop) return 15;
  if (!world.deferredLighting && !chunk.skyReady && !lightingFloodOwner(world)) ensureChunkSky(world, chunk);
  return chunk.skyLightAtIndex(Chunk.index(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE)));
}
export function getBlockLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  if (!world.deferredLighting && !chunk.blockLightReady && !lightingFloodOwner(world)) ensureChunkBlockLight(world, chunk);
  return chunk.blockLight[Chunk.index(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE))]!;
}
/** Direct exposure for gameplay, distinct from the stored direct + lateral field. */
export function getDirectSkyLight(world: VoxelWorld, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return 15;
  const chunk = loadedChunk(world, x, z);
  if (!chunk) return 0;
  let sky = 15;
  const column = positiveMod(z, CHUNK_SIZE) * CHUNK_SIZE + positiveMod(x, CHUNK_SIZE);
  for (let cy = chunk.scanMaxY(); cy >= y; cy -= 1) {
    const attenuation = FILTER[chunk.blocks[cy * COLUMNS + column]!]!;
    if (attenuation === 16) return 0;
    if (cy === y) return sky;
    sky = Math.max(0, sky - attenuation);
    if (sky === 0) return 0;
  }
  return sky;
}
export function combinedLight(world: VoxelWorld, x: number, y: number, z: number, daylight = 1): number {
  return Math.max(getSkyLight(world, x, y, z) * Math.max(0, Math.min(1, daylight)), getBlockLight(world, x, y, z));
}

/** On-demand CPU/DEV accounting only; excludes JS object overhead and GPU allocations. */
export function lightingMemoryUsage(world: VoxelWorld): {
  flagsBytes: number; queueBytes: number; snapshotBytes: number; snapshotPages: number; entries: number;
  peakSnapshotBytes: number; peakFlagsBytes: number; peakQueueBytes: number;
} {
  const state = states.get(world);
  const snapshotBytes = state?.snapshotBytes ?? 0;
  return { flagsBytes: state?.flagPool.reduce((sum, flags) => sum + flags.byteLength, 0) ?? 0,
    queueBytes: state?.queue.byteLength ?? 0, snapshotBytes, snapshotPages: snapshotBytes / SNAPSHOT_PAGE_SIZE,
    entries: state?.entries.length ?? 0, peakSnapshotBytes: state?.peakSnapshotBytes ?? 0,
    peakFlagsBytes: state?.peakFlagsBytes ?? 0, peakQueueBytes: state?.peakQueueBytes ?? 0 };
}
export function sampleVoxelLightLevels(world: VoxelWorld, x: number, y: number, z: number): { sky: number; block: number } {
  let sky = getSkyLight(world, x, y, z);
  let block = getBlockLight(world, x, y, z);
  if (sky || block || !getBlockDefinition(world.getBlock(x, y, z, false)).occludesFaces) return { sky, block };
  for (let dir = 0; dir < 6; dir += 1) {
    const ny = y + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
    sky = Math.max(sky, getSkyLight(world, x + DX[dir]!, ny, z + DZ[dir]!));
    block = Math.max(block, getBlockLight(world, x + DX[dir]!, ny, z + DZ[dir]!));
  }
  return { sky, block };
}
