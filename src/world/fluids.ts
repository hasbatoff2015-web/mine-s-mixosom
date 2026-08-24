import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, FLUID_JOB_BUDGET_MS, WORLD_HEIGHT, floorDiv } from '../core/constants';
import type { VoxelWorld } from './World';

export const FLUID_SOURCE_LEVEL = 8;
export const WATER_TICK_DELAY = 5;
export const LAVA_TICK_DELAY = 30;
export const FLUID_UPDATES_PER_TICK = 48;
export const FLUID_QUEUE_CAP = 2048;

const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

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

function canReplaceWithFluid(block: BlockId): boolean {
  if (block === BlockId.Air || block === BlockId.Fire) return true;
  const definition = getBlockDefinition(block);
  return definition.replaceable === true && definition.liquid !== true && definition.solid !== true;
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

function pathHasDrop(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  type: BlockId,
): boolean {
  let cx = x;
  let cz = z;
  for (let step = 1; step <= radius; step += 1) {
    cx += dx;
    cz += dz;
    if (!chunkLoaded(world, cx, cz)) return false;
    const block = world.getBlock(cx, y, cz, false);
    if (block === type) {
      if (hasDownDrop(world, cx, y, cz, type)) return true;
      continue;
    }
    if (!canReplaceWithFluid(block)) return false;
    if (hasDownDrop(world, cx, y, cz, type)) return true;
  }
  return false;
}

function preferredHorizontalDirs(world: VoxelWorld, x: number, y: number, z: number, type: BlockId): ReadonlyArray<readonly [number, number]> {
  const radius = type === BlockId.Lava ? 2 : 4;
  const drops: Array<readonly [number, number]> = [];
  for (const dir of HORIZONTAL) {
    if (pathHasDrop(world, x, y, z, dir[0], dir[1], radius, type)) drops.push(dir);
  }
  return drops.length > 0 ? drops : HORIZONTAL;
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

function enqueueNeighbors(world: VoxelWorld, x: number, y: number, z: number, delay: number): void {
  world.scheduleFluid(x, y, z, delay);
  world.scheduleFluid(x, y + 1, z, delay);
  world.scheduleFluid(x, y - 1, z, delay);
  for (const [dx, dz] of HORIZONTAL) world.scheduleFluid(x + dx, y, z + dz, delay);
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

  if (tryEnter(world, type, x, y, z, x, y - 1, z, FLUID_SOURCE_LEVEL, true, writes)) {
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
      world.scheduleFluid(next.x, next.y, next.z, 1);
      continue;
    }
    updates += 1;
    const produced = computeFluidUpdate(world, next.x, next.y, next.z);
    if (produced.length === 0) continue;
    const applied = applyFluidWrites(world, produced);
    writes += applied;
    if (applied <= 0) continue;
    const delay = fluidTickDelay(world.getBlock(next.x, next.y, next.z, false) || BlockId.Water);
    for (const write of produced) enqueueNeighbors(world, write.x, write.y, write.z, delay);
    enqueueNeighbors(world, next.x, next.y, next.z, delay);
  }
  world.endFluidTick(updates, writes);
  return { updates, writes, ms: performance.now() - started };
}
