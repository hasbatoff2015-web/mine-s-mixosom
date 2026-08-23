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
  });

  it('spreads water horizontally up to seven cells from a source', () => {
    const world = new VoxelWorld('fluid-water-spread');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 200);
    expect(world.getBlock(8 + 7, 31, 8)).toBe(BlockId.Water);
    expect(world.getBlock(8 + 8, 31, 8)).toBe(BlockId.Air);
    expect(readFluidLevel(world, 8 + 7, 31, 8)).toBeGreaterThan(0);
    expect(readFluidLevel(world, 8 + 7, 31, 8)).toBeLessThan(FLUID_SOURCE_LEVEL);
  });

  it('spreads lava a shorter distance than water', () => {
    const world = new VoxelWorld('fluid-lava-spread');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.scheduleFluidAround(8, 31, 8, 1);
    tickWorld(world, 400);
    expect(world.getBlock(8 + 1, 31, 8)).toBe(BlockId.Lava);
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
});
