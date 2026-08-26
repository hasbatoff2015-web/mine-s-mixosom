import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { resolvePlayerAttackTarget } from '../src/combat';
import { PLAYER_REACH } from '../src/core/constants';
import {
  DroppedItemManager,
  MinecartManager,
  TNT_MINECART_FUSE_TICKS,
  dropsForBrokenMinecart,
} from '../src/entities';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MINECART_HEIGHT, MINECART_HIT_HEIGHT } from '../src/rendering/minecartGeometry';
import { selectionLocalBoxes } from '../src/rendering/specialBlockGeometry';
import { VoxelWorld } from '../src/world/World';
import { blockSelectionBoxes } from '../src/world/selection';

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  for (const [cx, cz] of [[1, 0], [0, 1]] as const) {
    const extra = world.getChunk(cx, cz)!;
    extra.blocks.fill(BlockId.Air);
  }
  return world;
}

function place(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  expect(world.setBlock(x, y, z, block)).toBe(true);
}

describe('canonical block selection raycast', () => {
  it('does not select a rail when the ray passes through the empty upper cell', () => {
    const world = emptyWorld('rail-overshoot');
    place(world, 0, 40, 0, BlockId.Rail);
    world.setBlockState(0, 40, 0, { railShape: 'north_south' });
    place(world, 0, 40, 2, BlockId.Dirt);
    const locals = selectionLocalBoxes(BlockId.Rail, { railShape: 'north_south' });
    expect(locals[0]?.maxY).toBeLessThanOrEqual(3 / 16);
    const boxes = blockSelectionBoxes(world, 0, 40, 0);
    expect(boxes[0]?.maxY).toBeLessThan(40.2);
    const missRail = world.raycast(new THREE.Vector3(0.5, 40.5, 0.15), new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(missRail).toMatchObject({ x: 0, y: 40, z: 2, block: BlockId.Dirt });
    expect(missRail?.block).not.toBe(BlockId.Rail);
  });

  it('still selects a rail when the ray actually hits the low strip', () => {
    const world = emptyWorld('rail-direct');
    place(world, 0, 40, 0, BlockId.Rail);
    world.setBlockState(0, 40, 0, { railShape: 'north_south' });
    place(world, 0, 40, 2, BlockId.Dirt);
    const hit = world.raycast(new THREE.Vector3(0.5, 40.06, 0.15), new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(hit).toMatchObject({ x: 0, y: 40, z: 0, block: BlockId.Rail });
    expect(hit!.distance).toBeLessThan(1);
  });

  it('lets a ray above a pressure plate hit the block behind', () => {
    const world = emptyWorld('plate-overshoot');
    place(world, 2, 40, 2, BlockId.OakPressurePlate);
    place(world, 2, 40, 4, BlockId.Stone);
    const over = world.raycast(new THREE.Vector3(2.5, 40.4, 1), new THREE.Vector3(0, 0, 1), 6);
    expect(over).toMatchObject({ x: 2, y: 40, z: 4, block: BlockId.Stone });
    const on = world.raycast(new THREE.Vector3(2.5, 40.02, 1), new THREE.Vector3(0, 0, 1), 6);
    expect(on).toMatchObject({ x: 2, y: 40, z: 2, block: BlockId.OakPressurePlate });
  });

  it('lets a ray through the empty center of a ladder hit the block behind', () => {
    const world = emptyWorld('ladder-overshoot');
    place(world, 4, 41, 4, BlockId.Ladder);
    world.setBlockState(4, 41, 4, { facing: 'east' });
    place(world, 4, 41, 6, BlockId.Dirt);
    const center = world.raycast(new THREE.Vector3(4.5, 41.5, 3), new THREE.Vector3(0, 0, 1), 6);
    expect(center).toMatchObject({ x: 4, y: 41, z: 6, block: BlockId.Dirt });
    const wall = world.raycast(new THREE.Vector3(3.5, 41.5, 4.5), new THREE.Vector3(1, 0, 0), 2);
    expect(wall).toMatchObject({ x: 4, y: 41, z: 4, block: BlockId.Ladder });
  });

  it('uses the empty half of a bottom slab as pass-through', () => {
    const world = emptyWorld('slab-behind');
    place(world, 5, 40, 5, BlockId.OakSlab);
    world.setBlockState(5, 40, 5, { slabType: 'bottom' });
    place(world, 5, 40, 7, BlockId.Dirt);
    const upper = world.raycast(new THREE.Vector3(5.5, 40.75, 4), new THREE.Vector3(0, 0, 1), 6);
    expect(upper).toMatchObject({ x: 5, y: 40, z: 7, block: BlockId.Dirt });
    const lower = world.raycast(new THREE.Vector3(5.5, 40.25, 4), new THREE.Vector3(0, 0, 1), 6);
    expect(lower).toMatchObject({ x: 5, y: 40, z: 5, block: BlockId.OakSlab });
  });

  it('lets a ray through the empty half of a top slab hit the block behind', () => {
    const world = emptyWorld('top-slab-behind');
    place(world, 5, 40, 5, BlockId.OakSlab);
    world.setBlockState(5, 40, 5, { slabType: 'top' });
    place(world, 5, 40, 7, BlockId.Dirt);
    const lower = world.raycast(new THREE.Vector3(5.5, 40.25, 4), new THREE.Vector3(0, 0, 1), 6);
    expect(lower).toMatchObject({ x: 5, y: 40, z: 7, block: BlockId.Dirt });
    const upper = world.raycast(new THREE.Vector3(5.5, 40.75, 4), new THREE.Vector3(0, 0, 1), 6);
    expect(upper).toMatchObject({ x: 5, y: 40, z: 5, block: BlockId.OakSlab });
  });

  it('uses stair decomposition instead of a full cube', () => {
    const world = emptyWorld('stairs-empty');
    place(world, 9, 40, 9, BlockId.OakStairs);
    world.setBlockState(9, 40, 9, { facing: 'east', stairHalf: 'bottom' });
    place(world, 9, 40, 11, BlockId.Dirt);
    const emptyUpperWest = world.raycast(new THREE.Vector3(9.25, 40.75, 8), new THREE.Vector3(0, 0, 1), 6);
    expect(emptyUpperWest).toMatchObject({ x: 9, y: 40, z: 11, block: BlockId.Dirt });
    const upperStep = world.raycast(new THREE.Vector3(9.75, 40.75, 8), new THREE.Vector3(0, 0, 1), 6);
    expect(upperStep).toMatchObject({ x: 9, y: 40, z: 9, block: BlockId.OakStairs });
  });

  it('selects a fence post without filling the whole cell', () => {
    const world = emptyWorld('fence-post');
    place(world, 3, 40, 3, BlockId.OakFence);
    place(world, 3, 40, 5, BlockId.Dirt);
    const corner = world.raycast(new THREE.Vector3(3.1, 40.5, 2), new THREE.Vector3(0, 0, 1), 6);
    expect(corner).toMatchObject({ x: 3, y: 40, z: 5, block: BlockId.Dirt });
    const post = world.raycast(new THREE.Vector3(3.5, 40.5, 2), new THREE.Vector3(0, 0, 1), 6);
    expect(post).toMatchObject({ x: 3, y: 40, z: 3, block: BlockId.OakFence });
    const locals = selectionLocalBoxes(BlockId.OakFence, undefined);
    expect(Math.max(...locals.map((box) => box.maxY))).toBe(1);
  });

  it('picks the nearest actual shape, not the first occupied voxel', () => {
    const world = emptyWorld('nearest-shape');
    place(world, 8, 40, 8, BlockId.Rail);
    world.setBlockState(8, 40, 8, { railShape: 'north_south' });
    place(world, 8, 40, 9, BlockId.OakPressurePlate);
    const hit = world.raycast(new THREE.Vector3(8.5, 40.5, 7), new THREE.Vector3(0, 0, 1), 6);
    expect(hit).toBeUndefined();
    const low = world.raycast(new THREE.Vector3(8.5, 40.03, 7), new THREE.Vector3(0, 0, 1), 6);
    expect(low).toMatchObject({ x: 8, y: 40, z: 8, block: BlockId.Rail });
  });

  it('keeps chunk-border coordinates in world space', () => {
    const world = emptyWorld('rail-border');
    place(world, 15, 40, 0, BlockId.Rail);
    world.setBlockState(15, 40, 0, { railShape: 'east_west' });
    place(world, 16, 40, 0, BlockId.Stone);
    const boxes = blockSelectionBoxes(world, 15, 40, 0);
    expect(boxes[0]?.minX).toBeCloseTo(15, 5);
    expect(boxes[0]?.maxX).toBeCloseTo(16, 5);
    const over = world.raycast(new THREE.Vector3(14, 40.5, 0.5), new THREE.Vector3(1, 0, 0), 6);
    expect(over).toMatchObject({ x: 16, y: 40, z: 0, block: BlockId.Stone });
    const on = world.raycast(new THREE.Vector3(14, 40.05, 0.5), new THREE.Vector3(1, 0, 0), 6);
    expect(on).toMatchObject({ x: 15, y: 40, z: 0, block: BlockId.Rail });
  });

  it('uses actual AABB face normals for placement', () => {
    const world = emptyWorld('rail-normal');
    place(world, 3, 40, 3, BlockId.Rail);
    const hit = world.raycast(new THREE.Vector3(3.5, 41.2, 3.5), new THREE.Vector3(0, -1, 0), 3);
    expect(hit).toMatchObject({ x: 3, y: 40, z: 3, block: BlockId.Rail });
    expect(hit?.normal.y).toBeCloseTo(1, 5);
  });

  it('gives ordinary cubes a full-block default and air nothing', () => {
    expect(selectionLocalBoxes(BlockId.Air, undefined)).toEqual([]);
    expect(selectionLocalBoxes(BlockId.Dirt, undefined)).toEqual([
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    ]);
  });

  it('covers torch, lever, fence and fire with non-full boxes', () => {
    const torch = selectionLocalBoxes(BlockId.Torch, { attachment: 'floor', facing: 'north' });
    expect(torch[0]!.maxY).toBeLessThan(1);
    expect(torch[0]!.maxX - torch[0]!.minX).toBeLessThan(0.5);
    const wall = selectionLocalBoxes(BlockId.Torch, { attachment: 'wall', facing: 'east' });
    expect(wall[0]!.maxX).toBeLessThan(0.5);
    const plate = selectionLocalBoxes(BlockId.StonePressurePlate, undefined);
    expect(plate[0]!.maxY).toBeLessThan(0.1);
    const fire = selectionLocalBoxes(BlockId.Fire, undefined);
    expect(fire[0]!.maxX - fire[0]!.minX).toBeLessThan(1);
    const cobweb = selectionLocalBoxes(BlockId.Cobweb, undefined);
    expect(cobweb[0]!.maxY).toBe(1);
    const ascending = selectionLocalBoxes(BlockId.Rail, { railShape: 'ascending_south' });
    expect(ascending.length).toBe(2);
    expect(Math.max(...ascending.map((box) => box.maxY))).toBe(1);
  });
});

describe('attack target shares the same raycast as outline/use', () => {
  it('resolves dirt behind a rail as the block target', () => {
    const world = emptyWorld('shared-target');
    place(world, 1, 40, 1, BlockId.Rail);
    place(world, 1, 40, 3, BlockId.Dirt);
    const hit = world.raycast(new THREE.Vector3(1.5, 40.5, 0), new THREE.Vector3(0, 0, 1), PLAYER_REACH)!;
    expect(hit.block).toBe(BlockId.Dirt);
    const attack = resolvePlayerAttackTarget(hit, undefined, undefined);
    expect(attack).toMatchObject({ kind: 'block', hit: { block: BlockId.Dirt, x: 1, y: 40, z: 3 } });
  });
});

describe('minecart LMB break', () => {
  it('removes a normal cart and reports a Minecart item drop', () => {
    const world = emptyWorld('cart-break');
    place(world, 5, 40, 5, BlockId.Stone);
    place(world, 5, 41, 5, BlockId.Rail);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, 41, 5)!;
    const broken = manager.breakCart(cart);
    expect(broken?.items).toEqual(['minecart']);
    expect(manager.count).toBe(0);
    manager.dispose();
  });

  it('does not break the cart the player is riding', () => {
    const world = emptyWorld('cart-ridden');
    place(world, 5, 40, 5, BlockId.Stone);
    place(world, 5, 41, 5, BlockId.Rail);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, 41, 5)!;
    expect(manager.breakCart(cart, cart.id)).toBeUndefined();
    expect(manager.count).toBe(1);
    manager.dispose();
  });

  it('drops minecart + TNT from an unprimed TNT cart and refuses primed LMB', () => {
    const world = emptyWorld('cart-tnt-break');
    place(world, 5, 40, 5, BlockId.Stone);
    place(world, 5, 41, 5, BlockId.Rail);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, 41, 5)!;
    manager.insertTnt(cart);
    const unprimed = manager.breakCart(cart);
    expect(unprimed?.items).toEqual(['minecart', 'tnt']);
    const primed = manager.spawn(5, 41, 5)!;
    manager.insertTnt(primed);
    manager.primeTnt(primed);
    expect(primed.fuseTicks).toBe(TNT_MINECART_FUSE_TICKS);
    expect(manager.breakCart(primed)).toBeUndefined();
    expect(manager.count).toBe(1);
    manager.dispose();
  });

  it('prefers a nearer minecart over a farther block and ignores the ridden cart', () => {
    const world = emptyWorld('cart-priority');
    place(world, 6, 41, 8, BlockId.Dirt);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    place(world, 6, 40, 6, BlockId.Stone);
    place(world, 6, 41, 6, BlockId.Rail);
    const cart = manager.spawn(6, 41, 6)!;
    const origin = new THREE.Vector3(6.5, 41.3, 4);
    const blockHit = world.raycast(origin, new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    const cartHit = manager.raycast(origin, new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(cartHit?.cart).toBe(cart);
    expect(resolvePlayerAttackTarget(blockHit, cartHit, undefined)?.kind).toBe('minecart');
    expect(resolvePlayerAttackTarget(blockHit, cartHit, undefined, cart.id)?.kind).toBe('block');
    expect(manager.raycast(origin, new THREE.Vector3(0, 0, 1), PLAYER_REACH, cart.id)).toBeUndefined();
    manager.dispose();
  });

  it('keeps a normal cart hitbox near the 3D body and a taller TNT cargo box', () => {
    const world = emptyWorld('cart-hitbox');
    place(world, 5, 40, 5, BlockId.Stone);
    place(world, 5, 41, 5, BlockId.Rail);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, 41, 5)!;
    const aboveRim = new THREE.Vector3(5.5, cart.position.y + MINECART_HEIGHT + 0.15, 4.2);
    expect(manager.raycast(aboveRim, new THREE.Vector3(0, 0, 1), 3)).toBeUndefined();
    manager.insertTnt(cart);
    expect(manager.raycast(aboveRim, new THREE.Vector3(0, 0, 1), 3)?.cart).toBe(cart);
    expect(MINECART_HIT_HEIGHT).toBeGreaterThan(MINECART_HEIGHT);
    expect(MINECART_HIT_HEIGHT).toBeLessThan(2);
    manager.dispose();
  });

  it('spawns a pickupable Minecart drop through the canonical drop manager', () => {
    const world = emptyWorld('cart-pickup');
    const scene = new THREE.Scene();
    const inventory = new Inventory();
    const drops = new DroppedItemManager(scene, world, {
      visualFactory: new ItemVisualFactory(),
      pickupDelaySeconds: 0,
    });
    const origin = new THREE.Vector3(4.5, 41, 4.5);
    drops.spawn(createItemStack(ItemId.Minecart), origin, { pickupDelaySeconds: 0 });
    expect(drops.count).toBe(1);
    const taken = drops.collectNearby(origin, (stack) => {
      inventory.addItem(stack.itemId, stack.count);
      return true;
    });
    expect(taken).toBe(1);
    expect(drops.count).toBe(0);
    expect(inventory.count(ItemId.Minecart)).toBe(1);
    drops.dispose();
  });

  it('drops loot only in Survival, never from a Creative break', () => {
    expect(dropsForBrokenMinecart('survival', ['minecart'])).toEqual(['minecart']);
    expect(dropsForBrokenMinecart('survival', ['minecart', 'tnt'])).toEqual(['minecart', 'tnt']);
    expect(dropsForBrokenMinecart('creative', ['minecart'])).toEqual([]);
    expect(dropsForBrokenMinecart('creative', ['minecart', 'tnt'])).toEqual([]);
  });
});

describe('reach stays actual intersection distance', () => {
  it('does not extend interaction past PLAYER_REACH', () => {
    const world = emptyWorld('reach');
    place(world, 0, 40, Math.ceil(PLAYER_REACH) + 2, BlockId.Stone);
    const hit = world.raycast(new THREE.Vector3(0.5, 40.5, 0.5), new THREE.Vector3(0, 0, 1), PLAYER_REACH);
    expect(hit).toBeUndefined();
  });
});
