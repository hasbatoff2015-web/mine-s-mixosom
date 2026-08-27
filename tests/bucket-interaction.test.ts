import { Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { PLAYER_REACH } from '../src/core/constants';
import { Inventory, createItemStack, type ItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';
import { pickupFluidSource, placeBucketFluid, restoreBucketInventory, type BucketContext } from '../src/items/bucketInteraction';
import { Chunk } from '../src/world/Chunk';
import { isFluidSource } from '../src/world/fluids';
import { VoxelWorld } from '../src/world/World';

function fixture(mode: 'survival' | 'creative' = 'survival', count = 1) {
  const world = new VoxelWorld('bucket-integration');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Stone);
  for (let x = 2; x <= 12; x += 1) {
    chunk.set(x, 41, 4, BlockId.Air);
    chunk.set(x, 42, 4, BlockId.Air);
  }
  const inventory = new Inventory();
  inventory.setSlot(0, createItemStack(ItemId.Bucket, count));
  const drops: ItemStack[] = [];
  const context: BucketContext = { world, inventory, selectedSlot: 0, mode, onDrop: (stack) => drops.push(stack) };
  const eye = new Vector3(2.5, 41.5, 4.5);
  const direction = new Vector3(1, 0, 0);
  const pickup = () => pickupFluidSource(context, eye, direction, PLAYER_REACH);
  const tick = (count: number) => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    for (let i = 0; i < count; i += 1) world.tick();
    clock.mockRestore();
  };
  return { context, world, chunk, inventory, drops, eye, direction, pickup, tick };
}

afterEach(() => vi.restoreAllMocks());

describe('bucket interaction through canonical world/inventory', () => {
  it('uses 16 empty buckets and non-stackable filled buckets', () => {
    expect(getItemDefinition(ItemId.Bucket).maxStack).toBe(16);
    expect(getItemDefinition(ItemId.WaterBucket).maxStack).toBe(1);
    expect(getItemDefinition(ItemId.LavaBucket).maxStack).toBe(1);
  });

  it('restores legacy player bucket stacks without discarding the inventory', () => {
    const inventory = new Inventory();
    inventory.setSlot(2, createItemStack('diamond', 3));
    const saved = inventory.serialize();
    const slots = [...saved.slots];
    slots[0] = { itemId: ItemId.Bucket, count: 64 };
    slots[1] = { itemId: ItemId.WaterBucket, count: 4 };
    const legacy = { ...saved, slots, offhand: { itemId: ItemId.LavaBucket, count: 2 } };
    const restored = restoreBucketInventory(legacy);
    expect(restored.inventory.count(ItemId.Bucket)).toBe(64);
    expect(restored.inventory.count(ItemId.WaterBucket)).toBe(4);
    expect(restored.inventory.count(ItemId.LavaBucket)).toBe(2);
    expect(restored.inventory.getSlot(2)).toEqual(createItemStack('diamond', 3));
    expect(restored.overflow).toHaveLength(0);
    expect(legacy.slots[0]?.count).toBe(64);
    expect(() => Inventory.deserialize(restored.inventory.serialize())).not.toThrow();
  });

  it('returns legacy bucket overflow for canonical drops, never deletes other saved items', () => {
    const f = fixture();
    for (let slot = 1; slot < Inventory.SLOT_COUNT; slot += 1) f.inventory.setSlot(slot, createItemStack('stone', 64));
    const saved = f.inventory.serialize();
    const slots = [...saved.slots];
    slots[0] = { itemId: ItemId.LavaBucket, count: 3 };
    const restored = restoreBucketInventory({ ...saved, slots });
    expect(restored.inventory.count('stone')).toBe(35 * 64);
    expect(restored.inventory.count(ItemId.LavaBucket)).toBe(1);
    expect(restored.overflow).toEqual([createItemStack(ItemId.LavaBucket), createItemStack(ItemId.LavaBucket)]);
    expect(() => restoreBucketInventory({ ...saved, slots: [{ itemId: ItemId.Bucket, count: 65 }, ...slots.slice(1)] })).toThrow();
  });

  it.each([[BlockId.Water, ItemId.WaterBucket], [BlockId.Lava, ItemId.LavaBucket]] as const)(
    'picks up source %s, clears state, records save delta and dirties mesh', (block, filled) => {
      const f = fixture();
      f.world.setBlock(4, 41, 4, block);
      f.world.setBlockState(4, 41, 4, { fluidLevel: 8 });
      f.world.pendingMesh.clear();
      expect(f.pickup()?.block).toBe(block);
      expect(f.world.getBlock(4, 41, 4, false)).toBe(BlockId.Air);
      expect(f.world.getBlockState(4, 41, 4)).toBeUndefined();
      expect(f.world.modifications.get('0,0')?.get(Chunk.index(4, 41, 4))).toBe(BlockId.Air);
      expect(f.world.pendingMesh.has('0,0')).toBe(true);
      expect(f.inventory.getSlot(0)).toEqual(createItemStack(filled));
      expect(f.drops).toHaveLength(0);
      expect(f.pickup()).toBeUndefined();
    },
  );

  it.each([
    [BlockId.Water, 4, false], [BlockId.Water, 8, true],
    [BlockId.Lava, 4, false], [BlockId.Lava, 8, true],
  ] as const)('rejects non-source block=%s level=%s falling=%s', (block, level, falling) => {
    const f = fixture();
    f.world.setBlock(4, 41, 4, block);
    f.world.setBlockState(4, 41, 4, { fluidLevel: level, fluidFalling: falling });
    expect(f.pickup()).toBeUndefined();
    expect(f.world.getBlock(4, 41, 4, false)).toBe(block);
    expect(f.inventory.getSlot(0)).toEqual(createItemStack(ItemId.Bucket));
  });

  it('ordinary targeting still skips fluids; bucket targeting stops at the first fluid', () => {
    const f = fixture();
    f.world.setBlock(4, 41, 4, BlockId.Water);
    f.world.setBlock(5, 41, 4, BlockId.Stone);
    expect(f.world.raycast(f.eye, f.direction, PLAYER_REACH)?.x).toBe(5);
    expect(f.world.raycast(f.eye, f.direction, PLAYER_REACH, { stopOnLiquids: true })?.x).toBe(4);
  });

  it.each([BlockId.Water, BlockId.Lava])('cannot collect %s through a solid wall', (block) => {
    const f = fixture();
    f.world.setBlock(4, 41, 4, block);
    f.world.setBlock(3, 41, 4, BlockId.Stone);
    expect(f.pickup()).toBeUndefined();
    expect(isFluidSource(f.world, 4, 41, 4)).toBe(true);
  });

  it.each([BlockId.Water, BlockId.Lava])('cannot skip flowing %s in front of a source', (block) => {
    const f = fixture();
    f.world.setBlock(4, 41, 4, block);
    f.world.setBlock(3, 41, 4, block);
    f.world.setBlockState(3, 41, 4, { fluidLevel: 4 });
    expect(f.pickup()).toBeUndefined();
    expect(isFluidSource(f.world, 4, 41, 4)).toBe(true);
  });

  it('does not collect beyond reach or on empty-space use', () => {
    const f = fixture();
    expect(f.pickup()).toBeUndefined();
    f.world.setBlock(10, 41, 4, BlockId.Water);
    expect(f.pickup()).toBeUndefined();
    expect(isFluidSource(f.world, 10, 41, 4)).toBe(true);
  });

  it.each([ItemId.WaterBucket, ItemId.LavaBucket])('survival stack pickup preserves empties and inserts %s', (filled) => {
    const f = fixture('survival', 16);
    f.world.setBlock(4, 41, 4, filled === ItemId.WaterBucket ? BlockId.Water : BlockId.Lava);
    expect(f.pickup()).toBeDefined();
    expect(f.inventory.getSlot(0)).toEqual(createItemStack(ItemId.Bucket, 15));
    expect(f.inventory.count(filled)).toBe(1);
    expect(f.drops).toHaveLength(0);
  });

  it('full inventory drops exactly one filled bucket without losing empty buckets', () => {
    const f = fixture('survival', 16);
    for (let slot = 1; slot < Inventory.SLOT_COUNT; slot += 1) f.inventory.setSlot(slot, createItemStack('stone', 64));
    f.world.setBlock(4, 41, 4, BlockId.Lava);
    expect(f.pickup()).toBeDefined();
    expect(f.inventory.count(ItemId.Bucket)).toBe(15);
    expect(f.inventory.count('stone')).toBe(35 * 64);
    expect(f.drops).toEqual([createItemStack(ItemId.LavaBucket)]);
  });

  it('one empty bucket can become filled even when every other slot is full', () => {
    const f = fixture();
    for (let slot = 1; slot < Inventory.SLOT_COUNT; slot += 1) f.inventory.setSlot(slot, createItemStack('stone', 64));
    f.world.setBlock(4, 41, 4, BlockId.Water);
    expect(f.pickup()).toBeDefined();
    expect(f.inventory.getSlot(0)?.itemId).toBe(ItemId.WaterBucket);
    expect(f.drops).toHaveLength(0);
  });

  it.each([BlockId.Water, BlockId.Lava])('creative pickup puts %s bucket in active slot and preserves remaining empties', (block) => {
    const f = fixture('creative', 4);
    f.world.setBlock(4, 41, 4, block);
    expect(f.pickup()).toBeDefined();
    expect(f.inventory.getSlot(0)?.itemId).toBe(block === BlockId.Water ? ItemId.WaterBucket : ItemId.LavaBucket);
    expect(f.inventory.count(ItemId.Bucket)).toBe(3);
  });

  it.each([
    [BlockId.Water, ItemId.WaterBucket, 5, 'survival'],
    [BlockId.Lava, ItemId.LavaBucket, 30, 'survival'],
    [BlockId.Water, ItemId.WaterBucket, 5, 'creative'],
    [BlockId.Lava, ItemId.LavaBucket, 30, 'creative'],
  ] as const)('places source %s with %s delay=%s in %s', (block, filled, delay, mode) => {
    const f = fixture(mode);
    f.inventory.setSlot(0, createItemStack(filled));
    const hit = f.world.raycast(new Vector3(2.5, 42.5, 4.5), new Vector3(0, -1, 0), PLAYER_REACH);
    expect(placeBucketFluid(f.context, hit)).toMatchObject({ x: 2, y: 41, z: 4, block });
    expect(isFluidSource(f.world, 2, 41, 4)).toBe(true);
    expect(f.world.getBlockState(2, 41, 4)?.fluidFalling).not.toBe(true);
    expect(f.inventory.getSlot(0)?.itemId).toBe(mode === 'survival' ? ItemId.Bucket : filled);
    f.tick(delay - 1);
    expect(f.world.getBlock(3, 41, 4, false)).toBe(BlockId.Air);
    f.tick(1);
    expect(f.world.getBlock(3, 41, 4, false)).toBe(block);
  });

  it('failed placement does not consume the filled bucket', () => {
    const f = fixture();
    f.inventory.setSlot(0, createItemStack(ItemId.LavaBucket));
    expect(placeBucketFluid(f.context, undefined)).toBeUndefined();
    expect(f.inventory.getSlot(0)?.itemId).toBe(ItemId.LavaBucket);
  });

  it.each([[BlockId.Water, ItemId.WaterBucket, 5], [BlockId.Lava, ItemId.LavaBucket, 30]] as const)(
    'pouring into existing %s flow creates a source with a fresh %s deadline', (block, filled, delay) => {
      const f = fixture();
      f.world.setBlock(2, 41, 4, block);
      f.world.setBlockState(2, 41, 4, { fluidLevel: 4, fluidFalling: true });
      f.tick(delay - 1);
      f.inventory.setSlot(0, createItemStack(filled));
      const hit = f.world.raycast(new Vector3(2.5, 42.5, 4.5), new Vector3(0, -1, 0), PLAYER_REACH);
      expect(placeBucketFluid(f.context, hit)).toBeDefined();
      expect(isFluidSource(f.world, 2, 41, 4)).toBe(true);
      f.tick(delay - 1);
      expect(f.world.getBlock(3, 41, 4, false)).toBe(BlockId.Air);
      f.tick(1);
      expect(f.world.getBlock(3, 41, 4, false)).toBe(block);
    },
  );

  it.each([BlockId.Water, BlockId.Lava])('pickup drains %s gradually and reaches zero late writes', (block) => {
    const f = fixture();
    f.world.setBlock(2, 41, 4, block);
    f.tick(400);
    expect(f.world.getBlock(4, 41, 4, false)).toBe(block);
    expect(f.pickup()).toBeDefined();
    expect(f.world.getBlock(4, 41, 4, false)).toBe(block);
    f.tick(600);
    expect(f.world.getBlock(4, 41, 4, false)).toBe(BlockId.Air);
    expect(f.world.fluidQueueSize).toBe(0);
    f.tick(100);
    expect(f.world.fluidWrites).toBe(0);
  });

  it('lava pickup queues bounded lighting and removes emission without a synchronous region flush', () => {
    const f = fixture();
    f.world.ensureChunkLighting(f.chunk);
    f.world.setBlock(4, 41, 4, BlockId.Lava);
    expect(f.world.blockLightAt(4, 41, 4)).toBe(15);
    const flush = vi.spyOn(f.world, 'flushLighting');
    expect(f.pickup()).toBeDefined();
    expect(flush).not.toHaveBeenCalled();
    expect(f.world.pendingLightJobs).toBeGreaterThan(0);
    for (let frame = 0; frame < 300 && f.world.pendingLightJobs > 0; frame += 1) f.world.processLighting(2, 4, 4);
    expect(f.world.pendingLightJobs).toBe(0);
    expect(f.world.blockLightAt(4, 41, 4)).toBe(0);
    expect(f.world.blockLightAt(5, 41, 4)).toBe(0);
  });
});
