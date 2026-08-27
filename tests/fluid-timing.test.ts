import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { VoxelWorld } from '../src/world/World';

function corridor(): VoxelWorld {
  const world = new VoxelWorld('fluid-causal-timing');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Stone);
  for (const z of [4, 10]) {
    for (let x = 2; x <= 12; x += 1) chunk.set(x, 41, z, BlockId.Air);
  }
  // Isolate gameplay tick deadlines from CPU budget jitter, never from FPS.
  vi.spyOn(performance, 'now').mockReturnValue(0);
  return world;
}

function arrivals(world: VoxelWorld, block: BlockId, count: number, z = 4): number[] {
  const first = Array<number>(count).fill(-1);
  for (let tick = 0; tick < 150; tick += 1) {
    world.tick();
    for (let index = 0; index < count; index += 1) {
      if (first[index] === -1 && world.getBlock(3 + index, 41, z, false) === block) {
        first[index] = world.tickNumber;
      }
    }
  }
  return first;
}

afterEach(() => vi.restoreAllMocks());

describe('fluid causal timing at 20 TPS', () => {
  it.each([
    ['Water', BlockId.Water, [5, 10, 15, 20]],
    ['Lava', BlockId.Lava, [30, 60, 90]],
  ] as const)('%s front advances only after its material delay', (name, block, expected) => {
    const world = corridor();
    world.setBlock(2, 41, 4, block);
    const actual = arrivals(world, block, expected.length);
    console.info(`${name} first-arrival ticks: ${actual.join(', ')}`);
    expect(actual).toEqual(expected);
  });

  it.each([[BlockId.Water, 5], [BlockId.Lava, 30]] as const)('runs independent %s fronts in parallel without a global speed throttle', (block, delay) => {
    const world = corridor();
    world.setBlock(2, 41, 4, block);
    world.setBlock(2, 41, 10, block);
    for (let tick = 1; tick <= delay * 3; tick += 1) {
      world.tick();
      for (const z of [4, 10]) {
        for (let distance = 1; distance <= 3; distance += 1) {
          expect(world.getBlock(2 + distance, 41, z, false)).toBe(tick >= distance * delay ? block : BlockId.Air);
        }
      }
    }
  });

  it('generic edits and legacy +1 requests neither accelerate nor postpone lava', () => {
    const world = corridor();
    world.setBlock(2, 41, 4, BlockId.Lava);
    for (let tick = 1; tick <= 30; tick += 1) {
      world.setBlock(2, 42, 4, tick % 2 ? BlockId.Air : BlockId.Stone);
      world.scheduleFluidAround(2, 41, 4, 1);
      world.tick();
      expect(world.getBlock(3, 41, 4, false)).toBe(tick === 30 ? BlockId.Lava : BlockId.Air);
    }
  });

  it('never prequeues air or inherits a water deadline when replacing with lava', () => {
    const world = corridor();
    world.scheduleFluid(3, 41, 4, 1);
    expect(world.fluidQueueSize).toBe(0);
    world.setBlock(2, 41, 4, BlockId.Water);
    world.tick();
    world.setBlock(2, 41, 4, BlockId.Lava);
    expect(arrivals(world, BlockId.Lava, 3)).toEqual([31, 61, 91]);
  });

  it('a removed/recreated source invalidates even an extracted due ticket', () => {
    const world = corridor();
    world.setBlock(2, 41, 4, BlockId.Lava);
    world.tickNumber = 30;
    const ticket = world.takeDueFluids(48)[0]!;
    world.setBlock(2, 41, 4, BlockId.Air);
    world.setBlock(2, 41, 4, BlockId.Lava);
    expect(world.consumeDueFluid(ticket)).toBe(false);
    expect(arrivals(world, BlockId.Lava, 1)).toEqual([60]);
  });

  it('only an already-due ticket may retry at +1 after the CPU budget', () => {
    const world = corridor();
    world.setBlock(2, 41, 4, BlockId.Lava);
    world.tickNumber = 30;
    const ticket = world.takeDueFluids(48)[0]!;
    world.retryDueFluid(ticket);
    expect(arrivals(world, BlockId.Lava, 3)).toEqual([31, 61, 91]);
  });

  it('lava removal schedules remaining lava at 30 ticks, never the Air→Water fallback', () => {
    const world = corridor();
    world.setBlock(2, 41, 4, BlockId.Lava);
    arrivals(world, BlockId.Lava, 3);
    expect(world.fluidQueueSize).toBe(0);
    world.setBlock(2, 41, 4, BlockId.Air);
    for (let tick = 1; tick < 30; tick += 1) {
      world.tick();
      expect(world.fluidWrites).toBe(0);
    }
    world.tick();
    expect(world.fluidWrites).toBeGreaterThan(0);
    for (let tick = 0; tick < 400; tick += 1) world.tick();
    expect(world.fluidQueueSize).toBe(0);
    expect(world.getBlock(3, 41, 4, false)).toBe(BlockId.Air);
  });
});
