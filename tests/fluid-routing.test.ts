import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { computeFluidUpdate } from '../src/world/fluids';
import { VoxelWorld } from '../src/world/World';

const SOURCE_X = 8;
const SOURCE_Y = 31;
const SOURCE_Z = 8;

function loadRoutingFixture(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  for (let cz = -1; cz <= 1; cz += 1) {
    for (let cx = -1; cx <= 1; cx += 1) world.getChunk(cx, cz);
  }
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, SOURCE_Y - 1, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
  }
  world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z, BlockId.Water);
  return world;
}

function horizontalTargets(world: VoxelWorld): string[] {
  return computeFluidUpdate(world, SOURCE_X, SOURCE_Y, SOURCE_Z)
    .filter((write) => write.y === SOURCE_Y && write.block === BlockId.Water)
    .map((write) => `${write.x - SOURCE_X},${write.z - SOURCE_Z}`)
    .sort();
}

describe('bounded fluid flow-cost routing', () => {
  it('chooses only the lower-cost initial direction when drops have different costs', () => {
    const world = loadRoutingFixture('fluid-routing-cost');
    world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z - 1, BlockId.Stone);
    world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z + 1, BlockId.Stone);
    world.setBlock(SOURCE_X - 1, SOURCE_Y - 1, SOURCE_Z, BlockId.Air);
    world.setBlock(SOURCE_X + 3, SOURCE_Y - 1, SOURCE_Z, BlockId.Air);

    expect(horizontalTargets(world)).toEqual(['-1,0']);
  });

  it('keeps all equal-minimum initial directions', () => {
    const world = loadRoutingFixture('fluid-routing-tie');
    world.setBlock(SOURCE_X + 1, SOURCE_Y, SOURCE_Z, BlockId.Stone);
    world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z + 1, BlockId.Stone);
    world.setBlock(SOURCE_X - 3, SOURCE_Y - 1, SOURCE_Z, BlockId.Air);
    world.setBlock(SOURCE_X, SOURCE_Y - 1, SOURCE_Z - 3, BlockId.Air);

    expect(horizontalTargets(world)).toEqual(['-1,0', '0,-1']);
  });

  it('finds a cheaper drop around a corner instead of only scanning straight rays', () => {
    const world = loadRoutingFixture('fluid-routing-turn');
    world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z - 1, BlockId.Stone);
    world.setBlock(SOURCE_X, SOURCE_Y, SOURCE_Z + 1, BlockId.Stone);
    world.setBlock(SOURCE_X - 2, SOURCE_Y - 1, SOURCE_Z - 1, BlockId.Air);
    world.setBlock(SOURCE_X + 4, SOURCE_Y - 1, SOURCE_Z, BlockId.Air);

    expect(horizontalTargets(world)).toEqual(['-1,0']);
  });

  it('spreads in every enterable direction when no drop is reachable', () => {
    const world = loadRoutingFixture('fluid-routing-flat');
    expect(horizontalTargets(world)).toEqual(['-1,0', '0,-1', '0,1', '1,0']);
  });

  it('keeps downward flow exclusive while a vertical drop is open', () => {
    const world = loadRoutingFixture('fluid-routing-down');
    world.setBlock(SOURCE_X, SOURCE_Y - 1, SOURCE_Z, BlockId.Air);

    const writes = computeFluidUpdate(world, SOURCE_X, SOURCE_Y, SOURCE_Z);
    expect(writes).toEqual([{
      x: SOURCE_X,
      y: SOURCE_Y - 1,
      z: SOURCE_Z,
      block: BlockId.Water,
      level: 8,
      falling: true,
    }]);
  });
});
