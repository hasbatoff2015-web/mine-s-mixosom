import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { findCraftingRecipe, findSmeltingRecipe } from '../src/crafting';
import {
  FarmingSystem,
  attachedStemDirection,
  cropTextureStage,
  farmingDropsForBlock,
} from '../src/farming';
import { performUseHeld, type UseSimulationContext } from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';
import { Vec3 } from '../src/math/vec3';
import { Chunk } from '../src/world/Chunk';
import { blockCollisionBoxes } from '../src/world/collision';
import { VoxelWorld, type VoxelHit } from '../src/world/World';

function worldWithChunk(seed = 'farming'): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  world.setViewCenter(0, 0, 0);
  return world;
}

function put(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  world.applyBlockBatch([{ x, y, z, block }], { updateLighting: false, scheduleNeighbors: false });
}

describe('FarmingSystem deterministic pulses', () => {
  it('hydrates in Chebyshev radius 4 at farmland Y or Y+1 and dries when water leaves', () => {
    const world = worldWithChunk();
    put(world, 4, 40, 4, BlockId.Farmland);
    put(world, 8, 41, 8, BlockId.Water);
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 100;
    expect(farming.tick().stateWrites).toBe(1);
    expect(world.getBlockState(4, 40, 4)?.hydrated).toBe(true);
    put(world, 8, 41, 8, BlockId.Air);
    world.tickNumber = 200;
    farming.tick();
    expect(world.getBlockState(4, 40, 4)?.hydrated).toBe(false);
    expect(world.getBlock(4, 40, 4, false)).toBe(BlockId.Farmland);
    farming.dispose();
  });

  it('grows only hydrated age 0..7 crops on the 1200-tick pulse', () => {
    const world = worldWithChunk();
    put(world, 4, 40, 4, BlockId.Farmland);
    world.setBlockState(4, 40, 4, { hydrated: true });
    put(world, 3, 40, 4, BlockId.Water);
    put(world, 4, 41, 4, BlockId.WheatCrop);
    world.setBlockState(4, 41, 4, { age: 0 });
    put(world, 12, 40, 4, BlockId.Farmland);
    world.setBlockState(12, 40, 4, { hydrated: false });
    put(world, 12, 41, 4, BlockId.CarrotCrop);
    world.setBlockState(12, 41, 4, { age: 0 });
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 1_200;
    farming.tick();
    expect(world.getBlockState(4, 41, 4)?.age).toBe(1);
    expect(world.getBlockState(12, 41, 4)?.age).toBe(0);
    world.tickNumber = 1_201;
    farming.tick();
    expect(world.getBlockState(4, 41, 4)?.age).toBe(1);
    farming.dispose();
  });

  it('grows one fruit on a valid cardinal substrate and never duplicates adjacent fruit', () => {
    const world = worldWithChunk();
    put(world, 4, 40, 4, BlockId.Farmland);
    world.setBlockState(4, 40, 4, { hydrated: true });
    put(world, 3, 40, 4, BlockId.Water);
    put(world, 4, 41, 4, BlockId.MelonStem);
    world.setBlockState(4, 41, 4, { age: 7 });
    put(world, 5, 40, 4, BlockId.Dirt);
    const farming = new FarmingSystem(world, { random: () => 0 });
    world.tickNumber = 1_200;
    expect(farming.tick().fruitWrites).toBe(1);
    expect(world.getBlock(5, 41, 4, false)).toBe(BlockId.Melon);
    world.tickNumber = 2_400;
    expect(farming.tick().fruitWrites).toBe(0);
    expect([...[-1, 1]].filter((dx) => world.getBlock(4 + dx, 41, 4, false) === BlockId.Melon)).toHaveLength(1);
    farming.dispose();
  });

  it('restores state without offline catch-up and lazily indexes restored chunks', () => {
    const first = worldWithChunk('persist-farm');
    put(first, 3, 40, 3, BlockId.Farmland);
    first.setBlockState(3, 40, 3, { hydrated: true });
    put(first, 3, 41, 3, BlockId.PotatoCrop);
    first.setBlockState(3, 41, 3, { age: 5 });
    const second = new VoxelWorld('persist-farm');
    second.restore({
      timeOfDay: first.timeOfDay,
      modifications: first.serializeModifications(),
      chests: {}, furnaces: {},
      blockStates: first.serializeBlockStates(),
    });
    second.setViewCenter(0, 0, 0);
    second.getChunk(0, 0, true);
    const farming = new FarmingSystem(second, { random: () => 0 });
    second.tickNumber = 60_001;
    expect(farming.tick().indexed).toBe(2);
    expect(second.getBlockState(3, 41, 3)?.age).toBe(5);
    farming.dispose();
  });
});

describe('farming interaction authority rules', () => {
  function context(
    world: VoxelWorld,
    inventory: Inventory,
    hit: VoxelHit,
    mode: 'survival' | 'creative' = 'survival',
  ): UseSimulationContext {
    return {
      world, inventory, selectedSlot: 0, gamemode: mode, reach: 6, hit,
      eyePosition: () => new Vec3(2, 42, 2), viewDirection: () => new Vec3(1, 0, 0),
      yaw: 0, position: new Vec3(2, 40, 2), intersectsBlock: () => false,
      intersectsCollisionBoxes: () => false, foodUseTicks: 0, bowUseTicks: 0, random: () => 0,
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

  function hit(x: number, y: number, z: number, block: BlockId): VoxelHit {
    return { x, y, z, block, normal: new Vec3(0, 1, 0), distance: 2, point: new Vec3(x + 0.5, y + 1, z + 0.5) };
  }

  it('tills, plants once, and bone-meals +2..5 only on hydrated farmland', () => {
    const world = worldWithChunk();
    const inventory = new Inventory();
    put(world, 5, 40, 5, BlockId.Dirt);
    put(world, 6, 40, 5, BlockId.Water);
    inventory.setSlot(0, createItemStack(ItemId.WoodenHoe));
    performUseHeld(context(world, inventory, hit(5, 40, 5, BlockId.Dirt)));
    expect(world.getBlock(5, 40, 5, false)).toBe(BlockId.Farmland);
    expect(world.getBlockState(5, 40, 5)?.hydrated).toBe(true);
    expect(inventory.getSlot(0)?.durability).toBe(58);

    inventory.setSlot(0, createItemStack(ItemId.WheatSeeds, 2));
    performUseHeld(context(world, inventory, hit(5, 40, 5, BlockId.Farmland)));
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.WheatCrop);
    expect(inventory.getSlot(0)?.count).toBe(1);

    inventory.setSlot(0, createItemStack(ItemId.BoneMeal, 2));
    performUseHeld(context(world, inventory, hit(5, 41, 5, BlockId.WheatCrop)));
    expect(world.getBlockState(5, 41, 5)?.age).toBe(2);
    expect(inventory.getSlot(0)?.count).toBe(1);
  });

  it('does not consume or wear farming items in Creative', () => {
    const world = worldWithChunk();
    const inventory = new Inventory();
    put(world, 5, 40, 5, BlockId.GrassBlock);
    inventory.setSlot(0, createItemStack(ItemId.DiamondHoe));
    performUseHeld(context(world, inventory, hit(5, 40, 5, BlockId.GrassBlock), 'creative'));
    expect(inventory.getSlot(0)?.durability).toBeUndefined();
    inventory.setSlot(0, createItemStack(ItemId.Carrot, 3));
    performUseHeld(context(world, inventory, hit(5, 40, 5, BlockId.Farmland), 'creative'));
    expect(inventory.getSlot(0)?.count).toBe(3);
  });
});

describe('farming drops, recipes, visuals, and geometry', () => {
  it('uses canonical immature/mature crop and fruit drops', () => {
    expect(farmingDropsForBlock(BlockId.WheatCrop, { age: 0 }, () => 0)).toEqual([
      { item: ItemId.WheatSeeds, count: 1 },
    ]);
    expect(farmingDropsForBlock(BlockId.WheatCrop, { age: 7 }, () => 0.999)).toEqual([
      { item: ItemId.Wheat, count: 1 }, { item: ItemId.WheatSeeds, count: 4 },
    ]);
    expect(farmingDropsForBlock(BlockId.Melon, undefined, () => 0.999)).toEqual([
      { item: ItemId.MelonSlice, count: 7 },
    ]);
  });

  it('preserves crop age when water detaches a planted block', () => {
    const world = worldWithChunk();
    put(world, 4, 40, 4, BlockId.WheatCrop);
    world.setBlockState(4, 40, 4, { age: 7 });
    put(world, 4, 40, 4, BlockId.Water);
    const detached = world.consumeDetachedBlocks();
    expect(detached).toMatchObject([{ block: BlockId.WheatCrop, state: { age: 7 }, reason: 'water' }]);
    expect(farmingDropsForBlock(detached[0]!.block, detached[0]!.state, () => 0)).toEqual([
      { item: ItemId.Wheat, count: 1 }, { item: ItemId.WheatSeeds, count: 1 },
    ]);
  });

  it('registers foods, exact hoe durability, crafting, and baking', () => {
    expect(getItemDefinition(ItemId.GoldenHoe)).toMatchObject({ durability: 32, tool: 'hoe' });
    expect(getItemDefinition(ItemId.DiamondHoe)).toMatchObject({ durability: 1561, tool: 'hoe' });
    expect(getItemDefinition(ItemId.PumpkinPie)).toMatchObject({ food: { nutrition: 8, saturation: 4.8 } });
    expect(findCraftingRecipe([ItemId.Wheat, ItemId.Wheat, ItemId.Wheat], 3, 1)?.id).toBe('bread');
    expect(findCraftingRecipe([ItemId.Bread, 'pumpkin'], 2, 1)?.id).toBe('pumpkin_pie');
    expect(findCraftingRecipe([ItemId.Bone, null, null, null], 2, 2)?.output.count).toBe(3);
    expect(findSmeltingRecipe(ItemId.Potato)?.output.item).toBe(ItemId.BakedPotato);
  });

  it('maps stages, resolves attached stems N/E/S/W, and uses 15/16 farmland collision', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((age) => cropTextureStage(BlockId.CarrotCrop, { age })))
      .toEqual([0, 0, 1, 1, 2, 2, 2, 3]);
    const world = worldWithChunk();
    put(world, 5, 41, 5, BlockId.PumpkinStem);
    put(world, 5, 41, 4, BlockId.Pumpkin);
    expect(attachedStemDirection(world, 5, 41, 5, BlockId.PumpkinStem)).toBe('north');
    put(world, 4, 40, 4, BlockId.Farmland);
    expect(blockCollisionBoxes(world, 4, 40, 4)[0]?.maxY).toBe(40 + 15 / 16);
    expect(getBlockDefinition(BlockId.Farmland).renderShape).toBe('farmland');
  });
});
