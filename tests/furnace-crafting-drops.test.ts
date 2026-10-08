import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  CRAFTING_RECIPES,
  SMELTING_RECIPES,
  consumeFurnaceFuel,
  findSmeltingRecipe,
  furnaceBurnRatio,
  furnaceCookRatio,
  getFuelBurnTicks,
  matchCraftingRecipe,
} from '../src/crafting';
import {
  LEAF_APPLE_INTERVAL,
  applesForBrokenLeaves,
  isLeafBlock,
} from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { applyInventoryUiAction } from '../src/inventory/inventoryUiAction';
import { ItemId } from '../src/items';
import {
  applyFurnaceSync,
  applyAuthoritativeContainerSlots,
} from '../src/net/onlineContainerSync';
import {
  clickFurnaceSlot,
  furnaceAccepts,
  furnaceShiftRoute,
  placeCraftingRecipe,
  takeCraftOutput,
} from '../src/ui/containerInteractions';
import {
  allCraftingBookEntries,
  allSmeltingBookEntries,
  queryRecipeBook,
} from '../src/ui/recipeBook';
import { VoxelWorld } from '../src/world/World';
import { parseServerMessage } from '../shared/protocol';

const GAME_UI = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/GameUI.ts'), 'utf8');

function fillInventory(inventory: Inventory, itemId: string, count = 64): void {
  for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
    inventory.setSlot(slot, createItemStack(itemId, count));
  }
}

describe('leaf apple counter', () => {
  it('awards one apple per five leaves and keeps the remainder', () => {
    expect(LEAF_APPLE_INTERVAL).toBe(5);
    expect(applesForBrokenLeaves(0, 4)).toEqual({ apples: 0, next: 4 });
    expect(applesForBrokenLeaves(4, 1)).toEqual({ apples: 1, next: 0 });
    expect(applesForBrokenLeaves(0, 5)).toEqual({ apples: 1, next: 0 });
    expect(applesForBrokenLeaves(0, 9)).toEqual({ apples: 1, next: 4 });
    expect(applesForBrokenLeaves(2, 8)).toEqual({ apples: 2, next: 0 });
  });

  it('counts a batch the same as that many single breaks', () => {
    const batch = applesForBrokenLeaves(3, 12);
    let previous = 3;
    let apples = 0;
    for (let index = 0; index < 12; index += 1) {
      const step = applesForBrokenLeaves(previous, 1);
      previous = step.next;
      apples += step.apples;
    }
    expect(batch).toEqual({ apples, next: previous });
    expect(batch.apples).toBe(3);
    expect(isLeafBlock(BlockId.OakLeaves)).toBe(true);
    expect(isLeafBlock(BlockId.BirchLeaves)).toBe(true);
    expect(isLeafBlock(BlockId.SpruceLeaves)).toBe(true);
    expect(isLeafBlock(BlockId.OakLog)).toBe(false);
  });
});

describe('golden apple and fire arrow recipes', () => {
  it('crafts eight gold ingots around an apple into one golden apple', () => {
    const recipe = CRAFTING_RECIPES.find((entry) => entry.id === 'golden_apple');
    expect(recipe).toMatchObject({
      type: 'shaped',
      pattern: ['GGG', 'GAG', 'GGG'],
      output: { item: ItemId.GoldenApple, count: 1 },
      gridSize: 3,
    });
    const grid = [
      ItemId.GoldIngot, ItemId.GoldIngot, ItemId.GoldIngot,
      ItemId.GoldIngot, ItemId.Apple, ItemId.GoldIngot,
      ItemId.GoldIngot, ItemId.GoldIngot, ItemId.GoldIngot,
    ];
    expect(matchCraftingRecipe(grid, 3, 3)?.output).toEqual(createItemStack(ItemId.GoldenApple));
    const inventory = new Inventory();
    inventory.addItem(ItemId.GoldIngot, 8);
    inventory.addItem(ItemId.Apple, 1);
    const placed = placeCraftingRecipe(recipe!, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    expect(placed.placed).toBe(true);
    expect(placed.grid.filter((cell) => cell?.itemId === ItemId.GoldIngot)).toHaveLength(8);
    expect(placed.grid.some((cell) => cell?.itemId === ItemId.Apple)).toBe(true);
    const taken = takeCraftOutput(placed.grid, null, 3, false, inventory);
    expect(taken.cursor).toEqual(createItemStack(ItemId.GoldenApple));
  });

  it('shows the new recipes in the recipe book', () => {
    expect(allCraftingBookEntries().some((entry) => entry.id === 'golden_apple' && entry.resultCount === 1)).toBe(true);
    expect(allCraftingBookEntries().some((entry) => entry.id === 'fire_arrow' && entry.resultCount === 8)).toBe(true);
    expect(allSmeltingBookEntries().some((entry) => entry.id === 'stone' && entry.resultId === 'stone')).toBe(true);
    const counts = new Map<string, number>();
    const crafting = queryRecipeBook({
      kind: 'crafting', gridSize: 3, category: 'all', search: 'golden_apple', craftableOnly: false,
    }, counts);
    expect(crafting.map((entry) => entry.id)).toContain('golden_apple');
    const smelting = queryRecipeBook({
      kind: 'smelting', gridSize: 2, category: 'all', search: 'stone', craftableOnly: false,
    }, counts);
    expect(smelting.map((entry) => entry.id)).toContain('stone');
  });

  it('turns 8 arrows and a lava bucket into 8 fire arrows plus an empty bucket', () => {
    const recipe = CRAFTING_RECIPES.find((entry) => entry.id === 'fire_arrow')!;
    const inventory = new Inventory();
    inventory.addItem(ItemId.Arrow, 8);
    inventory.addItem(ItemId.LavaBucket, 1);
    const placed = placeCraftingRecipe(recipe, Array.from({ length: 4 }, () => null), inventory, 2, 1);
    expect(placed.grid.some((cell) => cell?.itemId === ItemId.Arrow && cell.count === 8)).toBe(true);
    expect(placed.grid.some((cell) => cell?.itemId === ItemId.LavaBucket)).toBe(true);
    const taken = takeCraftOutput(placed.grid, null, 2, false, inventory);
    expect(taken.cursor).toEqual(createItemStack(ItemId.FireArrow, 8));
    expect(taken.grid.some((cell) => cell?.itemId === ItemId.Bucket && cell.count === 1)).toBe(true);
    expect(taken.grid.some((cell) => cell?.itemId === ItemId.LavaBucket)).toBe(false);
    expect(inventory.count(ItemId.Arrow)).toBe(0);
  });

  it('does not consume the fire-arrow craft when the inventory cannot hold the result and bucket', () => {
    const inventory = new Inventory();
    fillInventory(inventory, 'dirt');
    inventory.setSlot(0, createItemStack(ItemId.Arrow, 16));
    inventory.setSlot(1, createItemStack(ItemId.LavaBucket));
    const before = inventory.serialize();
    const result = applyInventoryUiAction({
      inventory,
      cursor: null,
      craftSlots: [null, null, null, null],
      window: { kind: 'inventory' },
      gamemode: 'survival',
    }, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'fire_arrow',
      count: 64,
    });
    expect(result.ok).toBe(false);
    expect(inventory.serialize()).toEqual(before);
    expect(inventory.count(ItemId.FireArrow)).toBe(0);
    expect(inventory.count(ItemId.Bucket)).toBe(0);
  });

  it('does not consume a full-inventory shift take of fire arrows', () => {
    const inventory = new Inventory();
    fillInventory(inventory, 'dirt');
    const grid = [
      createItemStack(ItemId.Arrow, 8),
      createItemStack(ItemId.LavaBucket),
      null,
      null,
    ];
    const taken = takeCraftOutput(grid, null, 2, true, inventory);
    expect(taken.cursor).toBeNull();
    expect(taken.grid[0]).toEqual(createItemStack(ItemId.Arrow, 8));
    expect(taken.grid[1]?.itemId).toBe(ItemId.LavaBucket);
    expect(inventory.count(ItemId.FireArrow)).toBe(0);
    expect(inventory.count('dirt')).toBe(64 * Inventory.SLOT_COUNT);
  });
});

describe('furnace smelting, lava fuel and progress', () => {
  it('smelts cobblestone into stone in 200 ticks', () => {
    expect(findSmeltingRecipe('cobblestone')).toMatchObject({
      id: 'stone',
      output: { item: 'stone', count: 1 },
      cookingTimeTicks: 200,
    });
    expect(SMELTING_RECIPES.filter((recipe) => (
      typeof recipe.input !== 'string' && 'item' in recipe.input && recipe.input.item === 'cobblestone'
    ))).toHaveLength(1);
    const world = new VoxelWorld('cobble-stone');
    const furnace = world.getFurnace(1, 2, 3);
    furnace.slots[0] = createItemStack('cobblestone', 2);
    furnace.slots[1] = createItemStack(ItemId.Coal);
    for (let tick = 0; tick < 199; tick += 1) world.tick();
    expect(furnace.slots[2]).toBeNull();
    expect(furnace.cookTime).toBe(199);
    world.tick();
    expect(furnace.slots[0]?.count).toBe(1);
    expect(furnace.slots[2]).toEqual(createItemStack('stone'));
    expect(furnace.cookTime).toBe(0);
  });

  it('burns one lava bucket for 16000 ticks and leaves the empty bucket', () => {
    expect(getFuelBurnTicks(ItemId.Coal)).toBe(1_600);
    expect(getFuelBurnTicks(ItemId.LavaBucket)).toBe(16_000);
    expect(getFuelBurnTicks(ItemId.Bucket)).toBe(0);
    expect(consumeFurnaceFuel(createItemStack(ItemId.LavaBucket))).toEqual(createItemStack(ItemId.Bucket));
    const world = new VoxelWorld('lava-fuel');
    const furnace = world.getFurnace(2, 3, 4);
    furnace.slots[0] = createItemStack('cobblestone', 2);
    furnace.slots[1] = createItemStack(ItemId.LavaBucket);
    world.tick();
    expect(furnace.burnTotal).toBe(16_000);
    expect(furnace.burnTime).toBe(15_999);
    expect(furnace.cookTime).toBe(1);
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    for (let tick = 0; tick < 199; tick += 1) world.tick();
    expect(furnace.slots[2]).toEqual(createItemStack('stone'));
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(furnace.burnTime).toBe(16_000 - 200);
    expect(furnace.cookTime).toBe(0);
  });

  it('does not spend lava when the output is full, and does not burn the empty bucket', () => {
    const world = new VoxelWorld('lava-full');
    const furnace = world.getFurnace(0, 1, 0);
    furnace.slots[0] = createItemStack('cobblestone', 4);
    furnace.slots[1] = createItemStack(ItemId.LavaBucket);
    furnace.slots[2] = createItemStack('stone', 64);
    world.tick();
    expect(furnace.slots[1]?.itemId).toBe(ItemId.LavaBucket);
    expect(furnace.burnTime).toBe(0);
    expect(furnace.cookTime).toBe(0);
    expect(furnace.slots[0]?.count).toBe(4);
    expect(furnace.slots[2]?.count).toBe(64);

    furnace.slots[2] = createItemStack('stone', 63);
    world.tick();
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(furnace.burnTotal).toBe(16_000);
    expect(furnace.cookTime).toBe(1);

    furnace.burnTime = 1;
    world.tick();
    world.tick();
    expect(furnace.burnTime).toBe(0);
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
  });

  it('keeps the empty bucket when the player inventory is already full', () => {
    const inventory = new Inventory();
    fillInventory(inventory, 'dirt');
    const world = new VoxelWorld('lava-full-inv');
    const furnace = world.getFurnace(4, 5, 6);
    const state = {
      inventory,
      cursor: createItemStack(ItemId.LavaBucket),
      craftSlots: [null, null, null, null],
      window: { kind: 'furnace' as const, x: 4, y: 5, z: 6 },
      gamemode: 'survival' as const,
      furnace,
    };
    furnace.slots[0] = createItemStack('cobblestone');
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action', action: 'click', key: 'furnace-1', button: 'left',
    }).ok).toBe(true);
    expect(furnace.slots[1]?.itemId).toBe(ItemId.LavaBucket);
    expect(state.cursor).toBeNull();
    world.tick();
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(inventory.count(ItemId.Bucket)).toBe(0);
    expect(inventory.count(ItemId.LavaBucket)).toBe(0);
    expect(inventory.count('dirt')).toBe(64 * Inventory.SLOT_COUNT);
    const shifted = applyInventoryUiAction(state, {
      type: 'inventory_action', action: 'click', key: 'furnace-1', button: 'left', shift: true,
    });
    expect(shifted.ok).toBe(true);
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(inventory.count(ItemId.Bucket)).toBe(0);
  });

  it('accepts lava in the fuel slot by click and by shift, and rejects a forged non-fuel', () => {
    expect(furnaceAccepts(1, createItemStack(ItemId.LavaBucket))).toBe(getFuelBurnTicks(ItemId.LavaBucket) > 0);
    expect(furnaceAccepts(1, createItemStack(ItemId.Bucket))).toBe(false);
    expect(furnaceAccepts(0, createItemStack('cobblestone'))).toBe(true);
    expect(furnaceAccepts(0, createItemStack(ItemId.LavaBucket))).toBe(false);
    expect(furnaceShiftRoute(createItemStack(ItemId.LavaBucket), 'inventory')).toBe('fuel');
    expect(furnaceShiftRoute(createItemStack('cobblestone'), 'inventory')).toBe('input');

    const world = new VoxelWorld('fuel-accept');
    const furnace = world.getFurnace(1, 1, 1);
    const rejected = clickFurnaceSlot(furnace.slots, 1, createItemStack('dirt'), 'left');
    expect(rejected.slots[1]).toBeNull();
    expect(rejected.cursor?.itemId).toBe('dirt');

    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.LavaBucket));
    const state = {
      inventory,
      cursor: null,
      craftSlots: [null, null, null, null],
      window: { kind: 'furnace' as const, x: 1, y: 1, z: 1 },
      gamemode: 'survival' as const,
      furnace,
    };
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left', shift: true,
    }).ok).toBe(true);
    expect(furnace.slots[1]?.itemId).toBe(ItemId.LavaBucket);
    expect(inventory.getSlot(0)).toBeNull();
  });

  it('does not apply legacy cookTime to an input when cookInputId was never stored', () => {
    const saved = new VoxelWorld('legacy-cook-save');
    const stored = saved.getFurnace(4, 5, 6);
    stored.slots = [null, createItemStack(ItemId.Coal), null];
    stored.burnTime = 500;
    stored.burnTotal = 1_600;
    stored.cookTime = 199;
    delete stored.cookInputId;
    const snapshot = JSON.parse(JSON.stringify({
      timeOfDay: 1_000,
      modifications: {},
      chests: {},
      furnaces: Object.fromEntries(saved.furnaces),
      blockStates: {},
      signs: {},
    })) as Parameters<VoxelWorld['restore']>[0];
    expect(snapshot.furnaces['4,5,6']).not.toHaveProperty('cookInputId');

    const world = new VoxelWorld('legacy-cook');
    world.restore(snapshot);
    const furnace = world.getFurnace(4, 5, 6);
    expect(furnace.cookInputId).toBeUndefined();
    expect(furnace.cookTime).toBe(199);
    furnace.slots[0] = createItemStack('gold_ore');
    world.tick();
    expect(furnace.slots[2]).toBeNull();
    expect(furnace.slots[0]).toEqual(createItemStack('gold_ore'));
    expect(furnace.cookTime).toBe(1);
    expect(furnace.cookInputId).toBe('gold_ore');
  });

  it('resets cook progress when the input changes and does not light with nothing to cook', () => {
    const world = new VoxelWorld('cook-edges');
    const furnace = world.getFurnace(8, 8, 8);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack(ItemId.Coal, 1);
    for (let tick = 0; tick < 50; tick += 1) world.tick();
    expect(furnace.cookTime).toBe(50);
    furnace.slots[0] = createItemStack('gold_ore');
    world.tick();
    expect(furnace.cookTime).toBe(1);
    expect(furnace.slots[2]).toBeNull();

    const idle = world.getFurnace(8, 9, 8);
    idle.slots[1] = createItemStack(ItemId.LavaBucket);
    world.tick();
    expect(idle.slots[1]?.itemId).toBe(ItemId.LavaBucket);
    expect(idle.burnTime).toBe(0);

    const dry = world.getFurnace(8, 10, 8);
    dry.slots[0] = createItemStack('cobblestone');
    world.tick();
    expect(dry.cookTime).toBe(0);
    expect(dry.slots[0]?.itemId).toBe('cobblestone');
  });

  it('finishes the item on the last burn tick and switches to the next fuel', () => {
    const world = new VoxelWorld('fuel-edge');
    const furnace = world.getFurnace(3, 3, 3);
    furnace.slots[0] = createItemStack('iron_ore', 2);
    furnace.burnTime = 1;
    furnace.burnTotal = 1_600;
    furnace.cookTime = 199;
    furnace.cookInputId = 'iron_ore';
    furnace.slots[1] = createItemStack(ItemId.LavaBucket);
    world.tick();
    expect(furnace.slots[2]).toEqual(createItemStack(ItemId.IronIngot));
    expect(furnace.burnTime).toBe(0);
    expect(furnace.slots[1]?.itemId).toBe(ItemId.LavaBucket);
    world.tick();
    expect(furnace.burnTotal).toBe(16_000);
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(furnace.cookTime).toBe(1);
  });

  it('derives flame and arrow progress from burn total and the current recipe', () => {
    expect(GAME_UI).not.toContain('cookTime / 200');
    expect(GAME_UI).toContain('furnaceCookRatio');
    expect(GAME_UI).toContain('furnaceBurnRatio');
    const burning = {
      slots: [createItemStack('cobblestone'), createItemStack(ItemId.Bucket), null] as const,
      burnTime: 16_000,
      burnTotal: 16_000,
      cookTime: 50,
    };
    expect(furnaceBurnRatio(burning)).toBe(1);
    expect(furnaceCookRatio(burning)).toBeCloseTo(50 / 200);
    expect(furnaceBurnRatio({ burnTime: 0, burnTotal: 16_000 })).toBe(0);
    expect(furnaceCookRatio({
      slots: [null, null, null],
      cookTime: 40,
    })).toBe(0);
    expect(furnaceCookRatio({
      slots: [createItemStack('dirt'), null, null],
      cookTime: 40,
    })).toBe(0);
    expect(furnaceCookRatio({
      slots: [createItemStack('iron_ore'), null, createItemStack(ItemId.IronIngot, 64)],
      cookTime: 0,
    })).toBe(0);
    const world = new VoxelWorld('progress-sync');
    const furnace = world.getFurnace(9, 9, 9);
    applyFurnaceSync(world, {
      x: 9, y: 9, z: 9,
      slots: [createItemStack('cobblestone', 3), createItemStack(ItemId.Bucket), createItemStack('stone', 1)],
      burnTime: 8_000,
      burnTotal: 16_000,
      cookTime: 100,
    });
    expect(furnace.slots[1]).toEqual(createItemStack(ItemId.Bucket));
    expect(furnace.burnTime).toBe(8_000);
    expect(furnace.cookTime).toBe(100);
    expect(furnaceBurnRatio(furnace)).toBeCloseTo(0.5);
    expect(furnaceCookRatio(furnace)).toBeCloseTo(0.5);
    applyAuthoritativeContainerSlots(world, {
      kind: 'furnace',
      x: 9, y: 9, z: 9,
      slots: furnace.slots,
      burnTime: 7_000,
      burnTotal: 16_000,
      cookTime: 110,
    });
    expect(furnace.burnTime).toBe(7_000);
    expect(furnace.cookTime).toBe(110);
    expect(parseServerMessage({
      type: 'furnace_sync',
      x: 1, y: 2, z: 3,
      slots: [null, null, null],
      burnTime: 4, burnTotal: 8, cookTime: 1,
    })).toMatchObject({ type: 'furnace_sync', burnTime: 4, cookTime: 1 });
    expect(parseServerMessage({ type: 'furnace_sync', x: 1, y: 2, z: 3 })).toEqual({ error: 'furnace_sync invalid' });
  });
});
