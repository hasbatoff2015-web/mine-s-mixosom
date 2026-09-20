import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PLAYER_WIDTH, chunkKey, floorDiv } from '../src/core/constants';
import { HeadlessEntityHost, MinecartManager } from '../src/entities';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import {
  isPlayerCenterInsidePlayableWorld,
  playerAabbAt,
  WORLD_BORDER_MAX,
  WORLD_BORDER_MIN,
} from '../src/world/worldBorder';

function putChunk(world: VoxelWorld, x: number, z: number): void {
  const cx = floorDiv(x, 16);
  const cz = floorDiv(z, 16);
  const key = chunkKey(cx, cz);
  if (!world.chunks.has(key)) {
    const chunk = new Chunk(cx, cz);
    chunk.generated = true;
    world.chunks.set(key, chunk);
  }
}

function platform(world: VoxelWorld, x0: number, z0: number, x1: number, z1: number, y = 40): void {
  for (let x = x0; x <= x1; x += 1) {
    for (let z = z0; z <= z1; z += 1) {
      putChunk(world, x, z);
      world.setBlock(x, y, z, BlockId.Stone);
      world.setBlock(x, y + 1, z, BlockId.Air);
      world.setBlock(x, y + 2, z, BlockId.Air);
    }
  }
}

function wallColumn(world: VoxelWorld, x: number, z: number, y = 41): void {
  putChunk(world, x, z);
  world.setBlock(x, y, z, BlockId.Stone);
  world.setBlock(x, y + 1, z, BlockId.Stone);
  world.setBlock(x, y + 2, z, BlockId.Stone);
}

function carts(world: VoxelWorld): MinecartManager {
  return new MinecartManager(new HeadlessEntityHost(), world);
}

describe('minecart dismount and enter vs world border', () => {
  it('east-border cart dismounts with the full player AABB inside', () => {
    const world = new VoxelWorld('cart-east');
    platform(world, 9_997, -2, 10_002, 2);
    const manager = carts(world);
    world.setBlock(9_999, 41, 0, BlockId.Rail);
    world.setBlockState(9_999, 41, 0, { railShape: 'east_west' });
    const cart = manager.spawn(9_999, 41, 0)!;
    const exit = manager.findDismountPosition(cart);
    expect(isPlayerCenterInsidePlayableWorld(exit.x, exit.z)).toBe(true);
    const box = playerAabbAt(exit.x, exit.z);
    expect(box.maxX).toBeLessThanOrEqual(WORLD_BORDER_MAX);
    manager.dispose();
  });

  it('west-border cart dismounts with the full player AABB inside', () => {
    const world = new VoxelWorld('cart-west');
    platform(world, -10_002, -2, -9_997, 2);
    const manager = carts(world);
    world.setBlock(-10_000, 41, 0, BlockId.Rail);
    const cart = manager.spawn(-10_000, 41, 0)!;
    const exit = manager.findDismountPosition(cart);
    expect(isPlayerCenterInsidePlayableWorld(exit.x, exit.z)).toBe(true);
    expect(playerAabbAt(exit.x, exit.z).minX).toBeGreaterThanOrEqual(WORLD_BORDER_MIN);
    manager.dispose();
  });

  it('north and south border carts dismount inside', () => {
    const south = new VoxelWorld('cart-south');
    platform(south, -2, 9_997, 2, 10_002);
    const southManager = carts(south);
    south.setBlock(0, 41, 9_999, BlockId.Rail);
    const southCart = southManager.spawn(0, 41, 9_999)!;
    const southExit = southManager.findDismountPosition(southCart);
    expect(isPlayerCenterInsidePlayableWorld(southExit.x, southExit.z)).toBe(true);
    southManager.dispose();

    const north = new VoxelWorld('cart-north');
    platform(north, -2, -10_002, 2, -9_997);
    const northManager = carts(north);
    north.setBlock(0, 41, -10_000, BlockId.Rail);
    const northCart = northManager.spawn(0, 41, -10_000)!;
    const northExit = northManager.findDismountPosition(northCart);
    expect(isPlayerCenterInsidePlayableWorld(northExit.x, northExit.z)).toBe(true);
    northManager.dispose();
  });

  it('corner cart dismount keeps the full AABB inside both planes', () => {
    const world = new VoxelWorld('cart-corner');
    platform(world, 9_997, 9_997, 10_002, 10_002);
    const manager = carts(world);
    world.setBlock(9_999, 41, 9_999, BlockId.Rail);
    const cart = manager.spawn(9_999, 41, 9_999)!;
    const exit = manager.findDismountPosition(cart);
    const box = playerAabbAt(exit.x, exit.z, PLAYER_WIDTH);
    expect(box.maxX).toBeLessThanOrEqual(WORLD_BORDER_MAX);
    expect(box.maxZ).toBeLessThanOrEqual(WORLD_BORDER_MAX);
    expect(isPlayerCenterInsidePlayableWorld(exit.x, exit.z)).toBe(true);
    manager.dispose();
  });

  it('fallback stays inside when preferred sides are outside or blocked', () => {
    const world = new VoxelWorld('cart-fallback');
    platform(world, 9_996, -2, 10_002, 2);
    const manager = carts(world);
    world.setBlock(9_999, 41, 0, BlockId.Rail);
    const cart = manager.spawn(9_999, 41, 0)!;
    wallColumn(world, 9_998, 0);
    wallColumn(world, 9_999, 1);
    wallColumn(world, 9_999, -1);
    wallColumn(world, 9_998, 1);
    wallColumn(world, 9_998, -1);
    wallColumn(world, 10_000, 1);
    wallColumn(world, 10_000, -1);
    const exit = manager.findDismountPosition(cart);
    expect(isPlayerCenterInsidePlayableWorld(exit.x, exit.z)).toBe(true);
    expect(exit.x).toBeLessThan(WORLD_BORDER_MAX - PLAYER_WIDTH * 0.5 + 1e-6);
    manager.dispose();
  });
});
