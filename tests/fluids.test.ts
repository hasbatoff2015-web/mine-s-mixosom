import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import {
  FLUID_SOURCE_LEVEL,
  computeFluidUpdate,
  isFluidSource,
  readFluidLevel,
} from '../src/world/fluids';
import { VoxelWorld } from '../src/world/World';

function loadFlat(world: VoxelWorld, floorY = 40): void {
  world.getChunk(0, 0);
  world.getChunk(1, 0);
  world.getChunk(-1, 0);
  world.getChunk(0, 1);
  world.getChunk(0, -1);
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
  }
}

function tickWorld(world: VoxelWorld, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) world.tick();
}

describe('fluid flow', () => {
  it('lets water fall downward before spreading', () => {
    const world = new VoxelWorld('fluid-fall');
    loadFlat(world, 20);
    for (let y = 21; y <= 28; y += 1) world.setBlock(8, y, 8, BlockId.Air);
    world.setBlock(8, 28, 8, BlockId.Water);
    world.scheduleFluidAround(8, 28, 8, 1);
    tickWorld(world, 80);
    expect(world.getBlock(8, 21, 8)).toBe(BlockId.Water);
    expect(isFluidSource(world, 8, 28, 8)).toBe(true);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      expect(world.getBlock(8 + dx, 27, 8 + dz)).toBe(BlockId.Air);
    }
  });

  it('spreads water horizontally up to seven cells from a source', () => {
    const world = new VoxelWorld('fluid-water-spread');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 200);
    for (let distance = 1; distance <= 7; distance += 1) {
      expect(world.getBlock(8 + distance, 31, 8)).toBe(BlockId.Water);
      expect(readFluidLevel(world, 8 + distance, 31, 8)).toBe(FLUID_SOURCE_LEVEL - distance);
    }
    expect(world.getBlock(8 + 8, 31, 8)).toBe(BlockId.Air);
  });

  it('spreads lava a shorter distance than water', () => {
    const world = new VoxelWorld('fluid-lava-spread');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 400);
    for (let distance = 1; distance <= 3; distance += 1) {
      expect(world.getBlock(8 + distance, 31, 8)).toBe(BlockId.Lava);
      expect(readFluidLevel(world, 8 + distance, 31, 8)).toBe(FLUID_SOURCE_LEVEL - distance * 2);
    }
    expect(world.getBlock(8 + 4, 31, 8)).toBe(BlockId.Air);
  });

  it('lets lava fall downward', () => {
    const world = new VoxelWorld('fluid-lava-fall');
    loadFlat(world, 20);
    for (let y = 21; y <= 24; y += 1) world.setBlock(4, y, 4, BlockId.Air);
    world.setBlock(4, 24, 4, BlockId.Lava);
    world.scheduleFluidAround(4, 24, 4, 1);
    tickWorld(world, 120);
    expect(world.getBlock(4, 21, 4)).toBe(BlockId.Lava);
  });

  it('removes flowing water after the source is taken away', () => {
    const world = new VoxelWorld('fluid-dry');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 120);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Water);
    world.setBlock(8, 31, 8, BlockId.Air);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 160);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Air);
    tickWorld(world, 200);
    expect(world.fluidQueueSize).toBe(0);
    let lateWrites = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      world.tick();
      lateWrites += world.fluidWrites;
    }
    expect(lateWrites).toBe(0);
  });

  it('starts a new horizontal range after landing without a global source-distance cap', () => {
    const water = new VoxelWorld('fluid-water-terrace-range');
    loadFlat(water, 30);
    water.setBlock(8, 35, 8, BlockId.Water);
    water.scheduleFluidAround(8, 35, 8, 1);
    tickWorld(water, 320);
    expect(water.getBlock(15, 31, 8)).toBe(BlockId.Water);
    expect(Math.abs(15 - 8) + Math.abs(31 - 35)).toBeGreaterThan(7);

    const lava = new VoxelWorld('fluid-lava-terrace-range');
    loadFlat(lava, 30);
    lava.setBlock(8, 35, 8, BlockId.Lava);
    lava.scheduleFluidAround(8, 35, 8, 1);
    tickWorld(lava, 700);
    expect(lava.getBlock(11, 31, 8)).toBe(BlockId.Lava);
    expect(Math.abs(11 - 8) + Math.abs(31 - 35)).toBeGreaterThan(3);
  });

  it('does not treat an unloaded neighboring chunk as air', () => {
    const world = new VoxelWorld('fluid-unloaded-border');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) chunk.set(x, 30, z, BlockId.Stone);
    }
    world.setBlock(15, 31, 8, BlockId.Water);
    const writes = computeFluidUpdate(world, 15, 31, 8);
    expect(writes.some((write) => write.x === 16)).toBe(false);
    expect(world.getChunk(1, 0, false)).toBeUndefined();
  });

  it('turns water + lava source into obsidian and flowing lava into cobblestone', () => {
    const world = new VoxelWorld('fluid-mix');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.setBlock(7, 31, 8, BlockId.Water);
    const sourceMix = computeFluidUpdate(world, 7, 31, 8);
    expect(sourceMix.some((write) => write.x === 8 && write.y === 31 && write.z === 8 && write.block === BlockId.Obsidian)).toBe(true);

    world.setBlock(8, 31, 8, BlockId.Lava);
    world.setBlockState(8, 31, 8, { fluidLevel: 4, fluidFalling: false });
    const flowingMix = computeFluidUpdate(world, 8, 31, 8);
    expect(flowingMix.some((write) => write.x === 8 && write.y === 31 && write.z === 8 && write.block === BlockId.Cobblestone)).toBe(true);

    world.setBlock(10, 31, 8, BlockId.Lava);
    world.setBlockState(10, 31, 8, { fluidLevel: 4, fluidFalling: false });
    world.setBlock(9, 31, 8, BlockId.Water);
    world.scheduleFluid(10, 31, 8, 1);
    tickWorld(world, 8);
    expect(world.getBlock(10, 31, 8)).toBe(BlockId.Cobblestone);
  });

  it('continues flow across a loaded chunk border', () => {
    const world = new VoxelWorld('fluid-border');
    loadFlat(world, 30);
    world.setBlock(15, 31, 8, BlockId.Water);
    world.scheduleFluidAround(15, 31, 8, 1);
    tickWorld(world, 200);
    expect(world.getBlock(16, 31, 8)).toBe(BlockId.Water);
    expect(world.getBlock(18, 31, 8)).toBe(BlockId.Water);
  });

  it('keeps a large water flood inside the fluid queue cap', () => {
    const world = new VoxelWorld('fluid-budget');
    loadFlat(world, 25);
    world.setBlock(8, 26, 8, BlockId.Water);
    world.scheduleFluidAround(8, 26, 8, 1);
    let peak = 0;
    for (let tick = 0; tick < 120; tick += 1) {
      world.tick();
      peak = Math.max(peak, world.fluidQueueSize);
    }
    expect(peak).toBeLessThanOrEqual(2048);
    expect(world.fluidUpdates).toBeLessThanOrEqual(48);
  });

  it('exposes fluid HUD counters after a tick', () => {
    const world = new VoxelWorld('fluid-hud');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 8);
    const hud = world.fluidHudStats();
    expect(hud.q + hud.updates + hud.writes + hud.dedupe).toBeGreaterThan(0);
    expect(hud.dedupe).toBeGreaterThanOrEqual(0);
    expect(world.lightOriginCounts.stream).toBeGreaterThanOrEqual(0);
  });
});
