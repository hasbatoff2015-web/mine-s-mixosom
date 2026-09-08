import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { RedstoneSystem } from '../src/redstone';
import {
  TNT_MAX_FALL_DESTRUCTIVE,
  TNT_MAX_FALL_ORDINARY,
  TNT_MAX_FALL_POWERFUL,
  tntFallDistance,
  tntMaxFall,
} from '../src/world/tnt';
import { VoxelWorld } from '../src/world/World';

function emptyColumn(world: VoxelWorld, x: number, z: number, radius = 1): void {
  world.deferredLighting = true;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const cx = x + dx;
      const cz = z + dz;
      world.getChunk(Math.floor(cx / CHUNK_SIZE), Math.floor(cz / CHUNK_SIZE));
      for (let y = 0; y < 256; y += 1) world.setBlock(cx, y, cz, BlockId.Air);
    }
  }
}

function stoneAt(world: VoxelWorld, x: number, y: number, z: number): void {
  world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
  world.setBlock(x, y, z, BlockId.Stone);
}

function simulatePlacedFall(
  blockId: number,
  originY: number,
  options: { readonly x?: number; readonly z?: number; readonly floorY?: number } = {},
): { startY: number; explosionY: number; deltaY: number; blockId: number; ticks: number } {
  const x = options.x ?? 8;
  const z = options.z ?? 8;
  const world = new VoxelWorld(`placed-fall-${blockId}-${originY}-${x}`);
  emptyColumn(world, x, z, 2);
  if (options.floorY !== undefined) stoneAt(world, x, options.floorY, z);
  world.setBlock(x, originY, z, blockId);
  const redstone = new RedstoneSystem(world);
  const primed = redstone.primeTnt(x, originY, z)!;
  expect(primed).toBeDefined();
  expect(primed.blockId).toBe(blockId);
  expect(primed.launchOriginY).toBe(originY);
  expect(primed.maxFallBlocks).toBe(tntMaxFall(blockId));
  const startY = primed.launchOriginY!;
  let ticks = 0;
  for (; ticks < 120; ticks += 1) {
    redstone.update(0.05);
    if (redstone.primedTntCount === 0) break;
  }
  expect(redstone.primedTntCount).toBe(0);
  expect(redstone.consumeExplosionEvents()).toHaveLength(1);
  const explosionY = primed.position.y;
  const deltaY = tntFallDistance(startY, explosionY);
  redstone.dispose();
  return { startY, explosionY, deltaY, blockId: primed.blockId, ticks };
}

describe('placed TNT fall distance', () => {
  it('ordinary TNT without a floor explodes after ~20 blocks of vertical fall', () => {
    const fall = simulatePlacedFall(BlockId.Tnt, 80);
    expect(fall.deltaY).toBeGreaterThanOrEqual(TNT_MAX_FALL_ORDINARY - 1.5);
    expect(fall.deltaY).toBeLessThan(TNT_MAX_FALL_ORDINARY + 2.5);
    expect(fall.ticks * 0.05).toBeLessThan(4);
  });

  it('powerful TNT without a floor explodes after ~30 blocks, not 20', () => {
    const fall = simulatePlacedFall(BlockId.TntPowerful, 90);
    expect(fall.deltaY).toBeGreaterThan(TNT_MAX_FALL_ORDINARY + 2);
    expect(fall.deltaY).toBeGreaterThanOrEqual(TNT_MAX_FALL_POWERFUL - 1.5);
    expect(fall.deltaY).toBeLessThan(TNT_MAX_FALL_POWERFUL + 2.5);
    expect(fall.ticks * 0.05).toBeLessThan(4);
  });

  it('destructive TNT without a floor explodes after ~30 blocks, not 20', () => {
    const fall = simulatePlacedFall(BlockId.TntDestructive, 90);
    expect(fall.deltaY).toBeGreaterThan(TNT_MAX_FALL_ORDINARY + 2);
    expect(fall.deltaY).toBeGreaterThanOrEqual(TNT_MAX_FALL_DESTRUCTIVE - 1.5);
    expect(fall.deltaY).toBeLessThan(TNT_MAX_FALL_DESTRUCTIVE + 2.5);
    expect(fall.ticks * 0.05).toBeLessThan(4);
  });

  it('explodes on a floor closer than the max fall instead of continuing to 20/30', () => {
    const fall = simulatePlacedFall(BlockId.Tnt, 68, { floorY: 60 });
    expect(fall.deltaY).toBeGreaterThan(2);
    expect(fall.deltaY).toBeLessThan(TNT_MAX_FALL_ORDINARY - 5);
    expect(fall.explosionY).toBeGreaterThan(59);
    expect(fall.explosionY).toBeLessThan(62);
    expect(fall.ticks * 0.05).toBeLessThan(4);
  });

  it('uses primed Y as startY, not a fixed world Y=20/30', () => {
    const high = simulatePlacedFall(BlockId.Tnt, 100);
    const low = simulatePlacedFall(BlockId.Tnt, 55);
    expect(high.startY).toBe(100);
    expect(low.startY).toBe(55);
    expect(high.deltaY).toBeGreaterThanOrEqual(TNT_MAX_FALL_ORDINARY - 1.5);
    expect(high.deltaY).toBeLessThan(TNT_MAX_FALL_ORDINARY + 2.5);
    expect(low.deltaY).toBeGreaterThanOrEqual(TNT_MAX_FALL_ORDINARY - 1.5);
    expect(low.deltaY).toBeLessThan(TNT_MAX_FALL_ORDINARY + 2.5);
    expect(Math.abs(high.deltaY - low.deltaY)).toBeLessThan(1);
    expect(high.explosionY).not.toBeCloseTo(20, 0);
    expect(low.explosionY).not.toBeCloseTo(20, 0);
  });

  it('sets startY/maxFallBlocks only for primeTnt, never for launchMinecartTnt', () => {
    const world = new VoxelWorld('placed-vs-cart-fall-fields');
    emptyColumn(world, 4, 4);
    world.setBlock(4, 70, 4, BlockId.TntPowerful);
    const redstone = new RedstoneSystem(world);
    const placed = redstone.primeTnt(4, 70, 4)!;
    expect(placed.launchOriginY).toBe(70);
    expect(placed.maxFallBlocks).toBe(TNT_MAX_FALL_POWERFUL);
    const cart = redstone.launchMinecartTnt(
      { x: 6.5, y: 70, z: 6.5 },
      { x: 0, y: 0, z: 0 },
      BlockId.TntDestructive,
    )!;
    expect(cart.blockId).toBe(BlockId.TntDestructive);
    expect(cart.launchOriginY).toBeUndefined();
    expect(cart.maxFallBlocks).toBeUndefined();
    redstone.dispose();
  });
});
