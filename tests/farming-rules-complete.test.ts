import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { findCraftingRecipe, findSmeltingRecipe } from '../src/crafting';
import {
  FARMING_FRUIT_CHANCE,
  FarmingSystem,
  attachedStemDirection,
  farmingDropsForBlock,
  growthChance,
} from '../src/farming';
import { performUseHeld, seededRandomFn, type UseSimulationContext } from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';
import { Vec3 } from '../src/math/vec3';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld, type VoxelHit } from '../src/world/World';

function worldWithChunk(seed = 'farming-complete'): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  world.setViewCenter(8, 8, 0);
  return world;
}

function put(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  world.applyBlockBatch([{ x, y, z, block }], { updateLighting: false, scheduleNeighbors: false });
}

function hit(x: number, y: number, z: number, block: BlockId): VoxelHit {
  return { x, y, z, block, normal: new Vec3(0, 1, 0), distance: 2, point: new Vec3(x + 0.5, y + 1, z + 0.5) };
}

function context(
  world: VoxelWorld,
  inventory: Inventory,
  target: VoxelHit,
  mode: 'survival' | 'creative' = 'survival',
  random = () => 0,
): UseSimulationContext {
  return {
    world, inventory, selectedSlot: 0, gamemode: mode, reach: 6, hit: target,
    eyePosition: () => new Vec3(8, 42, 8), viewDirection: () => new Vec3(0, -1, 0),
    yaw: 0, position: new Vec3(8, 40, 8), intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false, foodUseTicks: 0, bowUseTicks: 0, random,
    minecarts: {
      raycast: () => undefined, cartAt: () => undefined, nearest: () => undefined,
      isRideable: () => false, handleFlintUse: () => 'none', insertTnt: () => false, spawn: () => undefined,
    } as UseSimulationContext['minecarts'],
    redstone: {
      toggleLever: () => undefined, pressButton: () => false,
      setButtonOrientation: () => false, setLeverOrientation: () => false,
      primeTnt: () => undefined, notifyBlockChanged: () => undefined,
    },
  };
}

describe('Farming V1 complete tilling and planting matrix', () => {
  it('tills Dirt and Grass, rejects invalid/blocked targets, and applies mode durability rules', () => {
    const world = worldWithChunk();
    const inventory = new Inventory();

    put(world, 2, 40, 2, BlockId.Dirt);
    inventory.setSlot(0, createItemStack(ItemId.WoodenHoe));
    performUseHeld(context(world, inventory, hit(2, 40, 2, BlockId.Dirt)));
    expect(world.getBlock(2, 40, 2, false)).toBe(BlockId.Farmland);
    expect(world.getBlockState(2, 40, 2)).toEqual({ hydrated: false });
    expect(inventory.getSlot(0)?.durability).toBe(58);

    put(world, 4, 40, 2, BlockId.GrassBlock);
    inventory.setSlot(0, createItemStack(ItemId.DiamondHoe));
    performUseHeld(context(world, inventory, hit(4, 40, 2, BlockId.GrassBlock), 'creative'));
    expect(world.getBlock(4, 40, 2, false)).toBe(BlockId.Farmland);
    expect(inventory.getSlot(0)?.durability).toBeUndefined();

    put(world, 6, 40, 2, BlockId.Stone);
    inventory.setSlot(0, createItemStack(ItemId.WoodenHoe));
    performUseHeld(context(world, inventory, hit(6, 40, 2, BlockId.Stone)));
    expect(world.getBlock(6, 40, 2, false)).toBe(BlockId.Stone);
    expect(inventory.getSlot(0)?.durability).toBeUndefined();

    put(world, 8, 40, 2, BlockId.Dirt);
    put(world, 8, 41, 2, BlockId.Stone);
    performUseHeld(context(world, inventory, hit(8, 40, 2, BlockId.Dirt)));
    expect(world.getBlock(8, 40, 2, false)).toBe(BlockId.Dirt);
    expect(inventory.getSlot(0)?.durability).toBeUndefined();
  });

  it.each([
    [ItemId.WheatSeeds, BlockId.WheatCrop],
    [ItemId.Carrot, BlockId.CarrotCrop],
    [ItemId.Potato, BlockId.PotatoCrop],
    [ItemId.MelonSeeds, BlockId.MelonStem],
    [ItemId.PumpkinSeeds, BlockId.PumpkinStem],
  ] as const)('plants %s only on farmland and consumes exactly one', (itemId, crop) => {
    const world = worldWithChunk(itemId);
    const inventory = new Inventory();
    put(world, 5, 40, 5, BlockId.Farmland);
    inventory.setSlot(0, createItemStack(itemId, 2));
    const ctx = context(world, inventory, hit(5, 40, 5, BlockId.Farmland));
    performUseHeld(ctx);
    expect(world.getBlock(5, 41, 5, false)).toBe(crop);
    expect(world.getBlockState(5, 41, 5)).toEqual({ age: 0 });
    expect(inventory.getSlot(0)?.count).toBe(1);
    expect(ctx.foodUseTicks).toBe(0);

    put(world, 8, 40, 5, BlockId.Dirt);
    performUseHeld(context(world, inventory, hit(8, 40, 5, BlockId.Dirt)));
    expect(world.getBlock(8, 41, 5, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.count).toBe(1);
  });

  it('does not consume a planting item in Creative', () => {
    const world = worldWithChunk();
    const inventory = new Inventory();
    put(world, 5, 40, 5, BlockId.Farmland);
    inventory.setSlot(0, createItemStack(ItemId.PumpkinSeeds, 3));
    performUseHeld(context(world, inventory, hit(5, 40, 5, BlockId.Farmland), 'creative'));
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.PumpkinStem);
    expect(inventory.getSlot(0)?.count).toBe(3);
  });
});

describe('Farming V1 hydration and growth boundaries', () => {
  it('uses Chebyshev radius four at water Y/Y+1, dries, and hydrates again', () => {
    const world = worldWithChunk();
    const farmland = [[4, 8], [8, 4], [4, 4], [3, 8], [7, 8]] as const;
    for (const [x, z] of farmland) put(world, x, 40, z, BlockId.Farmland);
    put(world, 8, 40, 8, BlockId.Water);
    const farming = new FarmingSystem(world, { random: () => 1 });
    world.tickNumber = 100;
    farming.tick();
    expect(farmland.map(([x, z]) => world.getBlockState(x, 40, z)?.hydrated === true))
      .toEqual([true, true, true, false, true]);

    put(world, 8, 40, 8, BlockId.Air);
    world.tickNumber = 200;
    farming.tick();
    expect(farmland.map(([x, z]) => world.getBlockState(x, 40, z)?.hydrated === true))
      .toEqual([false, false, false, false, false]);

    put(world, 8, 41, 8, BlockId.Water);
    world.tickNumber = 300;
    farming.tick();
    expect(world.getBlockState(4, 40, 4)?.hydrated).toBe(true);
    farming.dispose();
  });

  it('keeps exact advancement chances, caps age, and skips inactive chunks', () => {
    expect(growthChance(BlockId.WheatCrop)).toBe(7 / 8);
    expect(growthChance(BlockId.CarrotCrop)).toBe(7 / 9);
    expect(growthChance(BlockId.PotatoCrop)).toBe(0.7);
    expect(growthChance(BlockId.MelonStem)).toBe(0.7);
    expect(growthChance(BlockId.PumpkinStem)).toBe(0.7);
    expect(FARMING_FRUIT_CHANCE).toBe(1 / 6);

    const world = worldWithChunk();
    put(world, 5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: true });
    put(world, 4, 40, 5, BlockId.Water);
    put(world, 5, 41, 5, BlockId.WheatCrop);
    world.setBlockState(5, 41, 5, { age: 6 });
    const farming = new FarmingSystem(world, { random: seededRandomFn('farming-growth') });
    world.tickNumber = 1_200;
    farming.tick([{ x: 10_000, z: 10_000 }]);
    expect(world.getBlockState(5, 41, 5)?.age).toBe(6);
    farming.tick([{ x: 5, z: 5 }]);
    expect(world.getBlockState(5, 41, 5)?.age).toBeLessThanOrEqual(7);
    world.setBlockState(5, 41, 5, { age: 7 });
    world.tickNumber = 2_400;
    farming.tick([{ x: 5, z: 5 }]);
    expect(world.getBlockState(5, 41, 5)?.age).toBe(7);
    farming.dispose();
  });

  it('pauses server farming when there are no connected active centers', () => {
    const world = worldWithChunk();
    put(world, 5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: true });
    put(world, 4, 40, 5, BlockId.Water);
    put(world, 5, 41, 5, BlockId.WheatCrop);
    world.setBlockState(5, 41, 5, { age: 0 });
    const farming = new FarmingSystem(world, { random: () => 0 });

    world.tickNumber = 1_200;
    expect(farming.tick([]).visited).toBe(0);
    expect(world.getBlockState(5, 41, 5)?.age).toBe(0);

    farming.tick();
    expect(world.getBlockState(5, 41, 5)?.age).toBe(1);
    farming.dispose();
  });
});

describe('Farming V1 bone meal, harvest, and stems', () => {
  it('adds 2..5 stages, clamps at 7, and does nothing on dry/mature crops or mature stems', () => {
    const world = worldWithChunk();
    const inventory = new Inventory();
    put(world, 5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: true });
    put(world, 5, 41, 5, BlockId.WheatCrop);
    world.setBlockState(5, 41, 5, { age: 5 });
    inventory.setSlot(0, createItemStack(ItemId.BoneMeal, 4));
    performUseHeld(context(world, inventory, hit(5, 41, 5, BlockId.WheatCrop), 'survival', () => 0.999));
    expect(world.getBlockState(5, 41, 5)?.age).toBe(7);
    expect(inventory.getSlot(0)?.count).toBe(3);

    performUseHeld(context(world, inventory, hit(5, 41, 5, BlockId.WheatCrop)));
    expect(inventory.getSlot(0)?.count).toBe(3);
    world.setBlockState(5, 40, 5, { hydrated: false });
    world.setBlockState(5, 41, 5, { age: 0 });
    performUseHeld(context(world, inventory, hit(5, 41, 5, BlockId.WheatCrop)));
    expect(world.getBlockState(5, 41, 5)?.age).toBe(0);
    expect(inventory.getSlot(0)?.count).toBe(3);

    world.setBlockState(5, 40, 5, { hydrated: true });
    put(world, 5, 41, 5, BlockId.MelonStem);
    world.setBlockState(5, 41, 5, { age: 7 });
    performUseHeld(context(world, inventory, hit(5, 41, 5, BlockId.MelonStem)));
    expect(inventory.getSlot(0)?.count).toBe(3);
    expect(([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).some(([dx, dz]) =>
      world.getBlock(5 + dx, 41, 5 + dz, false) === BlockId.Melon)).toBe(false);
  });

  it('implements the complete canonical harvest table at both random bounds', () => {
    expect(farmingDropsForBlock(BlockId.WheatCrop, { age: 0 }, () => 0)).toEqual([{ item: ItemId.WheatSeeds, count: 1 }]);
    expect(farmingDropsForBlock(BlockId.WheatCrop, { age: 7 }, () => 0.999)).toEqual([
      { item: ItemId.Wheat, count: 1 }, { item: ItemId.WheatSeeds, count: 4 },
    ]);
    expect(farmingDropsForBlock(BlockId.CarrotCrop, { age: 0 }, () => 0.999)).toEqual([{ item: ItemId.Carrot, count: 1 }]);
    expect(farmingDropsForBlock(BlockId.CarrotCrop, { age: 7 }, () => 0)).toEqual([{ item: ItemId.Carrot, count: 2 }]);
    expect(farmingDropsForBlock(BlockId.CarrotCrop, { age: 7 }, () => 0.999)).toEqual([{ item: ItemId.Carrot, count: 5 }]);
    expect(farmingDropsForBlock(BlockId.PotatoCrop, { age: 0 }, () => 0)).toEqual([{ item: ItemId.Potato, count: 1 }]);
    expect(farmingDropsForBlock(BlockId.PotatoCrop, { age: 7 }, () => 0.999)).toEqual([{ item: ItemId.Potato, count: 5 }]);
    expect(farmingDropsForBlock(BlockId.Melon, undefined, () => 0)).toEqual([{ item: ItemId.MelonSlice, count: 3 }]);
    expect(farmingDropsForBlock(BlockId.Melon, undefined, () => 0.999)).toEqual([{ item: ItemId.MelonSlice, count: 7 }]);
    expect(farmingDropsForBlock(BlockId.Pumpkin, undefined, () => 0)).toEqual([{ item: 'pumpkin', count: 1 }]);
    expect(farmingDropsForBlock(BlockId.MelonStem, { age: 4 }, () => 0)).toEqual([{ item: ItemId.MelonSeeds, count: 1 }]);
    expect(farmingDropsForBlock(BlockId.PumpkinStem, { age: 7 }, () => 0)).toEqual([{ item: ItemId.PumpkinSeeds, count: 1 }]);
  });

  it('requires wet active farmland, valid support, and produces only the matching fruit', () => {
    const world = worldWithChunk();
    put(world, 5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: true });
    put(world, 4, 40, 5, BlockId.Water);
    put(world, 5, 41, 5, BlockId.PumpkinStem);
    world.setBlockState(5, 41, 5, { age: 7 });
    put(world, 5, 40, 4, BlockId.Dirt);
    put(world, 6, 41, 5, BlockId.Stone);
    put(world, 5, 41, 6, BlockId.Stone);
    put(world, 4, 41, 5, BlockId.Stone);
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 1_200;
    expect(farming.tick([{ x: 5, z: 5 }]).fruitWrites).toBe(1);
    expect(world.getBlock(5, 41, 4, false)).toBe(BlockId.Pumpkin);
    expect(attachedStemDirection(world, 5, 41, 5, BlockId.PumpkinStem)).toBe('north');
    world.tickNumber = 2_400;
    expect(farming.tick([{ x: 5, z: 5 }]).fruitWrites).toBe(0);
    farming.dispose();
  });

  it('does not grow fruit while dry, inactive, or surrounded by blocked cells', () => {
    const world = worldWithChunk();
    put(world, 5, 40, 5, BlockId.Farmland);
    world.setBlockState(5, 40, 5, { hydrated: false });
    put(world, 5, 41, 5, BlockId.MelonStem);
    world.setBlockState(5, 41, 5, { age: 7 });
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(world, 5 + dx, 41, 5 + dz, BlockId.Stone);
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 1_200;
    expect(farming.tick([{ x: 5, z: 5 }]).fruitWrites).toBe(0);
    world.setBlockState(5, 40, 5, { hydrated: true });
    world.tickNumber = 2_400;
    expect(farming.tick([{ x: 10_000, z: 10_000 }]).visited).toBe(0);
    world.tickNumber = 3_600;
    expect(farming.tick([{ x: 5, z: 5 }]).fruitWrites).toBe(0);
    farming.dispose();
  });
});

describe('Farming V1 recipes and food matrix', () => {
  it('registers all food values without changing the hunger scale', () => {
    expect(getItemDefinition(ItemId.Carrot)).toMatchObject({ food: { nutrition: 3, saturation: 3.6 } });
    expect(getItemDefinition(ItemId.Potato)).toMatchObject({ food: { nutrition: 1, saturation: 0.6 } });
    expect(getItemDefinition(ItemId.BakedPotato)).toMatchObject({ food: { nutrition: 5, saturation: 6 } });
    expect(getItemDefinition(ItemId.MelonSlice)).toMatchObject({ food: { nutrition: 2, saturation: 1.2 } });
    expect(getItemDefinition(ItemId.Bread)).toMatchObject({ food: { nutrition: 5, saturation: 6 } });
    expect(getItemDefinition(ItemId.PumpkinPie)).toMatchObject({ food: { nutrition: 8, saturation: 4.8 } });
  });

  it('covers food/resource conversions, the custom pie, furnace, and mirrored hoes', () => {
    expect(findCraftingRecipe([ItemId.Wheat, ItemId.Wheat, ItemId.Wheat], 3, 1)?.output).toEqual({ item: ItemId.Bread, count: 1 });
    expect(findCraftingRecipe([ItemId.Bone, null, null, null], 2, 2)?.output).toEqual({ item: ItemId.BoneMeal, count: 3 });
    expect(findCraftingRecipe([ItemId.MelonSlice, null, null, null], 2, 2)?.output).toEqual({ item: ItemId.MelonSeeds, count: 1 });
    expect(findCraftingRecipe(['pumpkin', null, null, null], 2, 2)?.output).toEqual({ item: ItemId.PumpkinSeeds, count: 4 });
    expect(findCraftingRecipe(Array(9).fill(ItemId.MelonSlice), 3, 3)?.output).toEqual({ item: 'melon', count: 1 });
    expect(findCraftingRecipe([ItemId.Bread, 'pumpkin'], 2, 1)?.output).toEqual({ item: ItemId.PumpkinPie, count: 1 });
    expect(findSmeltingRecipe(ItemId.Potato)?.output).toEqual({ item: ItemId.BakedPotato, count: 1 });

    const materials = ['oak_planks', 'cobblestone', ItemId.IronIngot, ItemId.GoldIngot, ItemId.Diamond] as const;
    const hoes = [ItemId.WoodenHoe, ItemId.StoneHoe, ItemId.IronHoe, ItemId.GoldenHoe, ItemId.DiamondHoe] as const;
    materials.forEach((material, index) => {
      expect(findCraftingRecipe([material, material, null, null, ItemId.Stick, null, null, ItemId.Stick, null], 3, 3)?.output.item)
        .toBe(hoes[index]);
      expect(findCraftingRecipe([null, material, material, null, ItemId.Stick, null, null, ItemId.Stick, null], 3, 3)?.output.item)
        .toBe(hoes[index]);
    });
    expect(findCraftingRecipe(['pumpkin', ItemId.BoneMeal, ItemId.Book], 3, 1)?.output.item).not.toBe(ItemId.PumpkinPie);
  });
});
