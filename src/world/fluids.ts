import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, FLUID_JOB_BUDGET_MS, WORLD_HEIGHT, floorDiv } from '../core/constants';
import type { Chunk } from './Chunk';
import type { VoxelWorld } from './World';

export const FLUID_SOURCE_LEVEL = 8;
export const WATER_TICK_DELAY = 5;
export const LAVA_TICK_DELAY = 30;
export const FLUID_UPDATES_PER_TICK = 48;
export const FLUID_QUEUE_CAP = 2048;

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

const FLOW_COST_NOT_FOUND = 1_000;
const MAX_FLOW_SEARCH_RADIUS = 4;
const FLOW_SEARCH_DIAMETER = MAX_FLOW_SEARCH_RADIUS * 2 + 3;
const FLOW_SEARCH_CENTER = Math.floor(FLOW_SEARCH_DIAMETER / 2);
const FLOW_SEARCH_CAPACITY = FLOW_SEARCH_DIAMETER * FLOW_SEARCH_DIAMETER;
const flowSearchQueueX = new Int8Array(FLOW_SEARCH_CAPACITY);
const flowSearchQueueZ = new Int8Array(FLOW_SEARCH_CAPACITY);
const flowSearchTraversable = new Uint8Array(FLOW_SEARCH_CAPACITY);
const flowSearchDistance = new Uint8Array(FLOW_SEARCH_CAPACITY);
const HORIZONTAL_SELECTIONS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = Array.from(
  { length: 1 << HORIZONTAL.length },
  (_, mask) => HORIZONTAL.filter((_, index) => (mask & (1 << index)) !== 0),
);

export function isFluidBlock(block: BlockId): boolean {
  return block === BlockId.Water || block === BlockId.Lava;
}

export function fluidTickDelay(block: BlockId): number {
  return block === BlockId.Lava ? LAVA_TICK_DELAY : WATER_TICK_DELAY;
}

export function fluidDecay(block: BlockId): number {
  return block === BlockId.Lava ? 2 : 1;
}

export function fluidSurfaceHeight(level: number, falling: boolean): number {
  if (falling || level >= FLUID_SOURCE_LEVEL) return 14 / 16;
  return Math.max(2 / 16, (Math.max(1, level) / FLUID_SOURCE_LEVEL) * 14 / 16);
}

export function readFluidLevel(world: VoxelWorld, x: number, y: number, z: number): number {
  const block = world.getBlock(x, y, z, false);
  if (!isFluidBlock(block)) return 0;
  const state = world.getBlockState(x, y, z);
  if (state?.fluidLevel === undefined) return FLUID_SOURCE_LEVEL;
  return state.fluidLevel;
}

export function readFluidFalling(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return world.getBlockState(x, y, z)?.fluidFalling === true;
}

export function isFluidSource(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return isFluidBlock(world.getBlock(x, y, z, false))
    && readFluidLevel(world, x, y, z) >= FLUID_SOURCE_LEVEL
    && !readFluidFalling(world, x, y, z);
}

export function chunkLoaded(world: VoxelWorld, x: number, z: number): boolean {
  return world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false) !== undefined;
}

export function canReplaceWithFluid(block: BlockId): boolean {
  if (block === BlockId.Air || block === BlockId.Fire) return true;
  const definition = getBlockDefinition(block);
  return definition.fluidDisplaceable === true
    || (definition.replaceable === true && definition.liquid !== true && definition.solid !== true);
}

/**
 * True when a generated source/flowing cell can enter a neighbor right now.
 * Unloaded neighbor chunks are treated as unknown (not air) so we retry when they load.
 */
export function generatedFluidNeedsActivation(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const type = world.getBlock(x, y, z, false);
  if (!isFluidBlock(type)) return false;
  const opposite = otherFluid(type);
  if (y > 0) {
    const below = world.getBlock(x, y - 1, z, false);
    if (canReplaceWithFluid(below) || (opposite !== undefined && below === opposite)) return true;
  }
  for (const [dx, dz] of HORIZONTAL) {
    const nx = x + dx;
    const nz = z + dz;
    if (!chunkLoaded(world, nx, nz)) continue;
    const neighbor = world.getBlock(nx, y, nz, false);
    if (canReplaceWithFluid(neighbor) || (opposite !== undefined && neighbor === opposite)) return true;
  }
  return false;
}

function scheduleIfGeneratedBoundary(world: VoxelWorld, x: number, y: number, z: number): void {
  if (generatedFluidNeedsActivation(world, x, y, z)) world.scheduleFluid(x, y, z);
}

function activateEdgeFluidsToward(
  world: VoxelWorld,
  chunk: Chunk,
  towardDx: number,
  towardDz: number,
): void {
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  if (towardDx !== 0) {
    const localX = towardDx > 0 ? CHUNK_SIZE - 1 : 0;
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let y = 1; y < WORLD_HEIGHT; y += 1) {
        if (!isFluidBlock(chunk.get(localX, y, localZ) as BlockId)) continue;
        scheduleIfGeneratedBoundary(world, originX + localX, y, originZ + localZ);
      }
    }
    return;
  }
  const localZ = towardDz > 0 ? CHUNK_SIZE - 1 : 0;
  for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
    for (let y = 1; y < WORLD_HEIGHT; y += 1) {
      if (!isFluidBlock(chunk.get(localX, y, localZ) as BlockId)) continue;
      scheduleIfGeneratedBoundary(world, originX + localX, y, originZ + localZ);
    }
  }
}

/**
 * After worldgen, schedule only cells that can already flow. Interior pond
 * sources stay idle. Neighbor-chunk faces are rechecked when the adjacent
 * chunk appears, so x=15/16 lava is not frozen behind an unloaded neighbor.
 */
export function activateGeneratedFluidBoundaries(world: VoxelWorld, chunk: Chunk): void {
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      for (let y = 1; y < WORLD_HEIGHT; y += 1) {
        if (!isFluidBlock(chunk.get(localX, y, localZ) as BlockId)) continue;
        scheduleIfGeneratedBoundary(world, originX + localX, y, originZ + localZ);
      }
    }
  }
  for (const [dx, dz] of HORIZONTAL) {
    const neighbor = world.getChunk(chunk.x + dx, chunk.z + dz, false);
    if (!neighbor) continue;
    activateEdgeFluidsToward(world, neighbor, -dx, -dz);
  }
}

function otherFluid(type: BlockId): BlockId | undefined {
  if (type === BlockId.Water) return BlockId.Lava;
  if (type === BlockId.Lava) return BlockId.Water;
  return undefined;
}

function mixLavaCell(
  world: VoxelWorld,
  lavaX: number,
  lavaY: number,
  lavaZ: number,
  writes: FluidWrite[],
): void {
  writes.push({
    x: lavaX,
    y: lavaY,
    z: lavaZ,
    block: isFluidSource(world, lavaX, lavaY, lavaZ) ? BlockId.Obsidian : BlockId.Cobblestone,
  });
}

export interface FluidWrite {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  level?: number;
  falling?: boolean;
}

function hasDownDrop(world: VoxelWorld, x: number, y: number, z: number, type: BlockId): boolean {
  if (y <= 0) return false;
  const below = world.getBlock(x, y - 1, z, false);
  if (canReplaceWithFluid(below)) return true;
  return below === type && !isFluidSource(world, x, y - 1, z);
}

function canRouteFluidThrough(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  type: BlockId,
): boolean {
  if (!chunkLoaded(world, x, z)) return false;
  const block = world.getBlock(x, y, z, false);
  if (block === type) return !isFluidSource(world, x, y, z);
  return canReplaceWithFluid(block);
}

/** Builds a bounded reverse distance field to all local drops once per update. */
function optimalHorizontalMask(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  radius: number,
  type: BlockId,
): number {
  flowSearchTraversable.fill(0);
  flowSearchDistance.fill(255);
  const extent = radius + 1;
  let tail = 0;
  for (let offsetZ = -extent; offsetZ <= extent; offsetZ += 1) {
    const remainingX = extent - Math.abs(offsetZ);
    for (let offsetX = -remainingX; offsetX <= remainingX; offsetX += 1) {
      if (offsetX === 0 && offsetZ === 0) continue;
      const index = (offsetZ + FLOW_SEARCH_CENTER) * FLOW_SEARCH_DIAMETER
        + offsetX + FLOW_SEARCH_CENTER;
      const cellX = x + offsetX;
      const cellZ = z + offsetZ;
      if (!canRouteFluidThrough(world, cellX, y, cellZ, type)) continue;
      flowSearchTraversable[index] = 1;
      if (!hasDownDrop(world, cellX, y, cellZ, type)) continue;
      flowSearchDistance[index] = 0;
      flowSearchQueueX[tail] = offsetX;
      flowSearchQueueZ[tail] = offsetZ;
      tail += 1;
    }
  }

  let head = 0;
  while (head < tail) {
    const offsetX = flowSearchQueueX[head]!;
    const offsetZ = flowSearchQueueZ[head]!;
    const index = (offsetZ + FLOW_SEARCH_CENTER) * FLOW_SEARCH_DIAMETER
      + offsetX + FLOW_SEARCH_CENTER;
    const cost = flowSearchDistance[index]!;
    head += 1;
    if (cost >= radius) continue;

    for (const [stepX, stepZ] of HORIZONTAL) {
      const nextOffsetX = offsetX + stepX;
      const nextOffsetZ = offsetZ + stepZ;
      const indexX = nextOffsetX + FLOW_SEARCH_CENTER;
      const indexZ = nextOffsetZ + FLOW_SEARCH_CENTER;
      if (indexX < 0 || indexX >= FLOW_SEARCH_DIAMETER || indexZ < 0 || indexZ >= FLOW_SEARCH_DIAMETER) continue;
      const visitedIndex = indexZ * FLOW_SEARCH_DIAMETER + indexX;
      if (flowSearchTraversable[visitedIndex] === 0) continue;
      const nextCost = cost + 1;
      if (flowSearchDistance[visitedIndex]! <= nextCost) continue;
      flowSearchDistance[visitedIndex] = nextCost;
      if (tail >= FLOW_SEARCH_CAPACITY) continue;
      flowSearchQueueX[tail] = nextOffsetX;
      flowSearchQueueZ[tail] = nextOffsetZ;
      tail += 1;
    }
  }

  let minimumCost = FLOW_COST_NOT_FOUND;
  let selectedMask = 0;
  for (let index = 0; index < HORIZONTAL.length; index += 1) {
    const [dx, dz] = HORIZONTAL[index]!;
    const distanceIndex = (dz + FLOW_SEARCH_CENTER) * FLOW_SEARCH_DIAMETER
      + dx + FLOW_SEARCH_CENTER;
    const cost = flowSearchTraversable[distanceIndex] === 0
      ? FLOW_COST_NOT_FOUND
      : flowSearchDistance[distanceIndex]!;
    if (cost > radius || cost > minimumCost) continue;
    if (cost < minimumCost) {
      minimumCost = cost;
      selectedMask = 0;
    }
    selectedMask |= 1 << index;
  }
  return selectedMask;
}

function preferredHorizontalDirs(world: VoxelWorld, x: number, y: number, z: number, type: BlockId): ReadonlyArray<readonly [number, number]> {
  const radius = type === BlockId.Lava ? 2 : 4;
  const selectedMask = optimalHorizontalMask(world, x, y, z, radius, type);
  return selectedMask === 0 ? HORIZONTAL : HORIZONTAL_SELECTIONS[selectedMask]!;
}

function expectedFlowingLevel(world: VoxelWorld, x: number, y: number, z: number, type: BlockId): {
  level: number;
  falling: boolean;
} {
  const above = world.getBlock(x, y + 1, z, false);
  if (above === type) return { level: FLUID_SOURCE_LEVEL, falling: true };
  const decay = fluidDecay(type);
  let best = 0;
  for (const [dx, dz] of HORIZONTAL) {
    const nx = x + dx;
    const nz = z + dz;
    if (!chunkLoaded(world, nx, nz)) continue;
    if (world.getBlock(nx, y, nz, false) !== type) continue;
    if (readFluidFalling(world, nx, y, nz)) {
      best = Math.max(best, FLUID_SOURCE_LEVEL - decay);
      continue;
    }
    best = Math.max(best, readFluidLevel(world, nx, y, nz) - decay);
  }
  return { level: best, falling: false };
}

function tryMixNeighbors(
  world: VoxelWorld,
  type: BlockId,
  x: number,
  y: number,
  z: number,
  writes: FluidWrite[],
): boolean {
  const opposite = otherFluid(type);
  if (!opposite) return false;
  const neighbors: Array<readonly [number, number, number]> = [
    [x, y - 1, z],
    [x + 1, y, z],
    [x - 1, y, z],
    [x, y, z + 1],
    [x, y, z - 1],
    [x, y + 1, z],
  ];
  for (const [nx, ny, nz] of neighbors) {
    if (!chunkLoaded(world, nx, nz) || ny < 0 || ny >= WORLD_HEIGHT) continue;
    if (world.getBlock(nx, ny, nz, false) !== opposite) continue;
    if (type === BlockId.Lava) mixLavaCell(world, x, y, z, writes);
    else mixLavaCell(world, nx, ny, nz, writes);
    return true;
  }
  return false;
}

export function applyFluidWrites(world: VoxelWorld, writes: readonly FluidWrite[]): number {
  const mutations: Array<{ x: number; y: number; z: number; block: BlockId }> = [];
  const states: FluidWrite[] = [];
  for (const write of writes) {
    if (!chunkLoaded(world, write.x, write.z)) continue;
    if (write.y < 0 || write.y >= WORLD_HEIGHT) continue;
    const current = world.getBlock(write.x, write.y, write.z, false);
    if (write.block === BlockId.Air) {
      if (current !== BlockId.Air) mutations.push({ x: write.x, y: write.y, z: write.z, block: BlockId.Air });
      else world.noteFluidNoop();
      continue;
    }
    if (!isFluidBlock(write.block)) {
      if (current !== write.block) mutations.push({ x: write.x, y: write.y, z: write.z, block: write.block });
      else world.noteFluidNoop();
      continue;
    }
    const level = write.level ?? FLUID_SOURCE_LEVEL;
    const falling = write.falling === true;
    if (current !== write.block) {
      mutations.push({ x: write.x, y: write.y, z: write.z, block: write.block });
      states.push({ ...write, level, falling });
      continue;
    }
    const previousLevel = readFluidLevel(world, write.x, write.y, write.z);
    const previousFalling = readFluidFalling(world, write.x, write.y, write.z);
    if (previousLevel !== level || previousFalling !== falling) states.push({ ...write, level, falling });
    else world.noteFluidNoop();
  }
  let applied = 0;
  if (mutations.length > 0) {
    applied += world.applyBlockBatch(mutations, {
      updateLighting: true,
      deferLighting: true,
      scheduleNeighbors: false,
      lightOrigin: 'fluid',
    }).applied;
  }
  for (const write of states) {
    if (write.block === BlockId.Air || !isFluidBlock(write.block)) continue;
    const level = write.level ?? FLUID_SOURCE_LEVEL;
    const falling = write.falling === true;
    const state = falling || level < FLUID_SOURCE_LEVEL
      ? { fluidLevel: level, fluidFalling: falling }
      : { fluidLevel: FLUID_SOURCE_LEVEL };
    if (world.setBlockState(write.x, write.y, write.z, state)) applied += 1;
  }
  return applied;
}

function tryEnter(
  world: VoxelWorld,
  type: BlockId,
  originX: number,
  originY: number,
  originZ: number,
  x: number,
  y: number,
  z: number,
  level: number,
  falling: boolean,
  writes: FluidWrite[],
): boolean {
  if (!chunkLoaded(world, x, z) || y < 0 || y >= WORLD_HEIGHT) return false;
  const dest = world.getBlock(x, y, z, false);
  if (isFluidBlock(dest) && dest !== type) {
    if (dest === BlockId.Lava) mixLavaCell(world, x, y, z, writes);
    else mixLavaCell(world, originX, originY, originZ, writes);
    return true;
  }
  if (dest === type) {
    if (isFluidSource(world, x, y, z)) return false;
    const destLevel = readFluidLevel(world, x, y, z);
    const destFalling = readFluidFalling(world, x, y, z);
    if (level > destLevel || (falling && !destFalling)) {
      writes.push({ x, y, z, block: type, level, falling });
      return true;
    }
    return false;
  }
  if (!canReplaceWithFluid(dest)) return false;
  writes.push({ x, y, z, block: type, level, falling });
  return true;
}

export function computeFluidUpdate(world: VoxelWorld, x: number, y: number, z: number): FluidWrite[] {
  const type = world.getBlock(x, y, z, false);
  if (!isFluidBlock(type)) return [];
  const writes: FluidWrite[] = [];
  const source = isFluidSource(world, x, y, z);
  const currentLevel = readFluidLevel(world, x, y, z);
  const falling = readFluidFalling(world, x, y, z);

  if (!source) {
    const expected = expectedFlowingLevel(world, x, y, z, type);
    if (expected.level <= 0) {
      if (tryMixNeighbors(world, type, x, y, z, writes)) return writes;
      writes.push({ x, y, z, block: BlockId.Air });
      return writes;
    }
    if (expected.level !== currentLevel || expected.falling !== falling) {
      writes.push({ x, y, z, block: type, level: expected.level, falling: expected.falling });
    }
  }

  const effectiveLevel = source
    ? FLUID_SOURCE_LEVEL
    : (writes[0]?.level ?? currentLevel);

  const downwardRouteOpen = hasDownDrop(world, x, y, z, type);
  if (tryEnter(world, type, x, y, z, x, y - 1, z, FLUID_SOURCE_LEVEL, true, writes)
    || downwardRouteOpen) {
    return writes;
  }

  const next = effectiveLevel - fluidDecay(type);
  if (next <= 0) return writes;
  for (const [dx, dz] of preferredHorizontalDirs(world, x, y, z, type)) {
    tryEnter(world, type, x, y, z, x + dx, y, z + dz, next, false, writes);
  }
  return writes;
}

export function processFluidQueue(world: VoxelWorld): { updates: number; writes: number; ms: number } {
  const started = performance.now();
  world.beginFluidTick();
  const due = world.takeDueFluids(FLUID_UPDATES_PER_TICK);
  let updates = 0;
  let writes = 0;
  for (const next of due) {
    if (performance.now() - started >= FLUID_JOB_BUDGET_MS) {
      world.retryDueFluid(next);
      continue;
    }
    if (!world.consumeDueFluid(next)) continue;
    updates += 1;
    const produced = computeFluidUpdate(world, next.x, next.y, next.z);
    if (produced.length === 0) continue;
    const applied = applyFluidWrites(world, produced);
    writes += applied;
    if (applied <= 0) continue;
    // Each surviving/new receiver chooses its own material rate. The origin may
    // now be Air/Stone; never infer a lava follow-up delay from that replacement.
    for (const write of produced) world.scheduleFluidAround(write.x, write.y, write.z);
    world.scheduleFluidAround(next.x, next.y, next.z);
  }
  world.endFluidTick(updates, writes);
  return { updates, writes, ms: performance.now() - started };
}
