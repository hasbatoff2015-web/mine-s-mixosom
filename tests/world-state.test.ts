import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { PlayerController } from '../src/player';
import { VoxelWorld } from '../src/world/World';

describe('world furnace and persistence state', () => {
  it('consumes fuel, advances at 20 TPS and stacks smelting output', () => {
    const world = new VoxelWorld('furnace-flow');
    const oreFurnace = world.getFurnace(0, 64, 0);
    oreFurnace.slots[0] = createItemStack('iron_ore', 2);
    oreFurnace.slots[1] = createItemStack(ItemId.Coal);

    const foodFurnace = world.getFurnace(1, 64, 0);
    foodFurnace.slots[0] = createItemStack(ItemId.Chicken);
    foodFurnace.slots[1] = createItemStack('oak_planks');

    for (let tick = 0; tick < 400; tick += 1) world.tick();

    expect(oreFurnace.slots).toEqual([
      null,
      null,
      { itemId: ItemId.IronIngot, count: 2 },
    ]);
    expect(oreFurnace).toMatchObject({ burnTotal: 1_600, burnTime: 1_200, cookTime: 0 });
    expect(foodFurnace.slots[0]).toBeNull();
    expect(foodFurnace.slots[1]).toBeNull();
    expect(foodFurnace.slots[2]).toEqual({ itemId: ItemId.CookedChicken, count: 1 });
    expect(foodFurnace).toMatchObject({ burnTotal: 300, burnTime: 0, cookTime: 0 });
  });

  it('round-trips modified blocks, negative chunk keys, chests and active furnaces', () => {
    const original = new VoxelWorld('persistent-world');
    original.timeOfDay = 13_337;
    original.setBlock(-1, 74, -17, BlockId.Tnt);
    original.setBlock(16, 73, 16, BlockId.Glass);
    original.getChest(-2, 65, -3).slots[5] = createItemStack(ItemId.Diamond, 3);
    const furnace = original.getFurnace(20, 64, -20);
    furnace.slots = [createItemStack('gold_ore'), null, createItemStack(ItemId.GoldIngot, 4)];
    furnace.burnTime = 87;
    furnace.burnTotal = 300;
    furnace.cookTime = 42;

    const snapshot = JSON.parse(JSON.stringify({
      timeOfDay: original.timeOfDay,
      modifications: original.serializeModifications(),
      chests: Object.fromEntries(original.chests),
      furnaces: Object.fromEntries(original.furnaces),
    })) as Parameters<VoxelWorld['restore']>[0];

    const restored = new VoxelWorld('persistent-world');
    restored.restore(snapshot);

    expect(restored.timeOfDay).toBe(13_337);
    expect(restored.getBlock(-1, 74, -17)).toBe(BlockId.Tnt);
    expect(restored.getBlock(16, 73, 16)).toBe(BlockId.Glass);
    expect(restored.serializeModifications()).toEqual(snapshot.modifications);
    expect(restored.getChest(-2, 65, -3).slots[5]).toEqual(createItemStack(ItemId.Diamond, 3));
    expect(restored.getFurnace(20, 64, -20)).toEqual({
      slots: [createItemStack('gold_ore'), null, createItemStack(ItemId.GoldIngot, 4)],
      burnTime: 87,
      burnTotal: 300,
      cookTime: 42,
    });
  });
});

describe('placement collision guard', () => {
  it('rejects blocks intersecting the standing player and permits adjacent cells', () => {
    const player = new PlayerController({ position: [0.5, 64, 0.5] });

    expect(player.intersectsBlock(0, 64, 0)).toBe(true);
    expect(player.intersectsBlock(0, 65, 0)).toBe(true);
    expect(player.intersectsBlock(0, 66, 0)).toBe(false);
    expect(player.intersectsBlock(1, 64, 0)).toBe(false);
    expect(player.intersectsBlock(-1, 64, 0)).toBe(false);
  });
});
