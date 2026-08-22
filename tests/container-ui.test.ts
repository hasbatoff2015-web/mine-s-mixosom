import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPES, SMELTING_RECIPES, findSmeltingRecipe, getFuelBurnTicks } from '../src/crafting';
import { Inventory, createItemStack } from '../src/inventory';
import { VoxelWorld } from '../src/world/World';
import {
  clickFurnaceSlot,
  furnaceAccepts,
  ghostFromRecipe,
  hasRecipeBook,
  placeCraftingRecipe,
  placeSmeltingIngredient,
  returnStacksToInventory,
  showsCreativeCatalog,
  takeCraftOutput,
} from '../src/ui/containerInteractions';
import {
  allCraftingBookEntries,
  allSmeltingBookEntries,
  inventoryItemCounts,
  isFuelItem,
  isSmeltableItem,
  queryRecipeBook,
  recipeEntryCraftable,
  visibleRecipeBookTabs,
} from '../src/ui/recipeBook';
import { containerStageSize, containerUiScale } from '../src/ui/containerTheme';
import { patchContainerDynamic, patchInventoryDynamic } from '../src/ui/inventoryLayout';

describe('container layout', () => {
  it('keeps furnace/crafting logical size near vanilla 176×166', () => {
    expect(containerStageSize('furnace', false)).toEqual({ width: 176, height: 166 });
    expect(containerStageSize('crafting-table', false)).toEqual({ width: 176, height: 166 });
    expect(containerStageSize('chest', false).width).toBe(176);
    const withBook = containerStageSize('crafting-table', true);
    expect(withBook.width).toBeGreaterThan(176);
  });

  it('scales down to fit 1280×720 and does not explode on 2560×1440', () => {
    const small = containerUiScale(1280, 720, 176, 166);
    const large = containerUiScale(2560, 1440, 176, 166);
    expect(small).toBeGreaterThanOrEqual(1);
    expect(large).toBeLessThanOrEqual(4);
    expect(large * 176).toBeLessThanOrEqual(2560);
    expect(containerUiScale(320, 180, 327, 166)).toBeLessThan(1);
  });

  it('patches container panels without a Creative catalog node', () => {
    const body = { innerHTML: 'old' };
    const player = { innerHTML: 'inv' };
    const cursor = { innerHTML: '' };
    const root = {
      querySelector(selector: string) {
        if (selector === '[data-container-body]') return body;
        if (selector === '[data-player-inventory]') return player;
        if (selector === '#cursor-stack') return cursor;
        if (selector === '[data-creative-catalog]') return { innerHTML: 'should-not-touch' };
        return null;
      },
    };
    expect(patchContainerDynamic(root, { body: 'chest', player: 'player', cursor: 'held' })).toBe(true);
    expect(body.innerHTML).toBe('chest');
    expect(patchInventoryDynamic(root, 'nope', 'x')).toBe(false);
  });
});

describe('furnace slot rules', () => {
  it('accepts smeltable input and fuel, and rejects output inserts', () => {
    expect(isSmeltableItem('iron_ore')).toBe(true);
    expect(isFuelItem('coal')).toBe(true);
    expect(furnaceAccepts(0, createItemStack('iron_ore'))).toBe(true);
    expect(furnaceAccepts(0, createItemStack('cobblestone'))).toBe(false);
    expect(furnaceAccepts(1, createItemStack('coal'))).toBe(true);
    expect(furnaceAccepts(2, createItemStack('iron_ingot'))).toBe(false);
    const clicked = clickFurnaceSlot([null, null, createItemStack('iron_ingot')], 2, createItemStack('dirt'), 'left');
    expect(clicked.slots[2]).toEqual(createItemStack('iron_ingot'));
    expect(clicked.cursor).toEqual(createItemStack('dirt'));
  });

  it('reads burn/cook from furnace state independently of GUI', () => {
    expect(findSmeltingRecipe('iron_ore')?.cookingTimeTicks).toBe(200);
    expect(getFuelBurnTicks('coal')).toBe(1_600);
    const burn = 800 / 1600;
    const cook = 50 / 200;
    expect(burn).toBeCloseTo(0.5);
    expect(cook).toBeCloseTo(0.25);
    const world = new VoxelWorld('furnace-no-gui');
    const furnace = world.getFurnace(3, 8, 1);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack('coal');
    for (let tick = 0; tick < 50; tick += 1) world.tick();
    expect(furnace.cookTime).toBe(50);
    expect(furnace.burnTime).toBeGreaterThan(0);
    expect(furnace.slots[2]).toBeNull();
  });
});

describe('crafting grid', () => {
  it('maps a 3×3 recipe, consumes on take, and returns leftovers', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 8);
    const recipe = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const placed = placeCraftingRecipe(recipe, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    expect(placed.placed).toBe(true);
    expect(placed.grid.filter(Boolean)).toHaveLength(8);
    const taken = takeCraftOutput(placed.grid, null, 3, false, inventory);
    expect(taken.cursor?.itemId).toBe('chest');
    expect(taken.grid.every((cell) => cell === null)).toBe(true);
    inventory.addItem('oak_planks', 8);
    const leftover = placeCraftingRecipe(recipe, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    const returned = returnStacksToInventory(inventory, leftover.grid);
    expect(returned.returned).toBe(true);
    expect(inventory.count('oak_planks')).toBe(8);
  });

  it('does not duplicate when taking the result', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 1);
    const recipe = CRAFTING_RECIPES.find((item) => item.id === 'oak_planks_from_log')!;
    const placed = placeCraftingRecipe(recipe, Array.from({ length: 4 }, () => null), inventory, 2, 1);
    const first = takeCraftOutput(placed.grid, null, 2, false, inventory);
    const second = takeCraftOutput(first.grid, first.cursor, 2, false, inventory);
    expect(second.cursor?.count).toBe(4);
    expect(inventory.count('oak_log')).toBe(0);
  });
});

describe('recipe book', () => {
  it('reads canonical registries rather than a UI copy', () => {
    expect(allCraftingBookEntries().map((entry) => entry.id).sort())
      .toEqual([...CRAFTING_RECIPES].map((recipe) => recipe.id).sort());
    expect(allSmeltingBookEntries().map((entry) => entry.id).sort())
      .toEqual([...SMELTING_RECIPES].map((recipe) => recipe.id).sort());
    expect(hasRecipeBook('crafting-table')).toBe(true);
    expect(hasRecipeBook('furnace')).toBe(true);
    expect(hasRecipeBook('inventory')).toBe(true);
    expect(hasRecipeBook('chest')).toBe(false);
  });

  it('filters search, categories, craftable, and hides empty tabs', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 8);
    const counts = inventoryItemCounts(inventory);
    const found = queryRecipeBook({
      kind: 'crafting', gridSize: 2, category: 'all', search: 'planks', craftableOnly: false,
    }, counts);
    expect(found.some((entry) => entry.id === 'oak_planks_from_log')).toBe(true);
    const craftable = queryRecipeBook({
      kind: 'crafting', gridSize: 2, category: 'all', search: '', craftableOnly: true,
    }, counts);
    expect(craftable.every((entry) => recipeEntryCraftable(entry, counts))).toBe(true);
    const tabs = visibleRecipeBookTabs('crafting');
    expect(tabs[0]).toBe('all');
    const furnaceOnly = queryRecipeBook({
      kind: 'smelting', gridSize: 3, category: 'all', search: '', craftableOnly: false,
    }, counts);
    expect(furnaceOnly.every((entry) => entry.kind === 'smelting')).toBe(true);
    expect(furnaceOnly.some((entry) => entry.recipe)).toBe(false);
    const known = queryRecipeBook({
      kind: 'crafting', gridSize: 3, category: 'all', search: '', craftableOnly: false,
      knownIds: new Set(['chest']),
    }, new Map());
    expect(known.map((entry) => entry.id)).toEqual(['chest']);
  });

  it('places craftable recipes and ghosts uncraftable ones without mutating inventory', () => {
    const inventory = new Inventory();
    const before = inventory.serialize();
    const recipe = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const ghost = ghostFromRecipe(recipe, 3, inventoryItemCounts(inventory));
    expect(ghost.missing.some(Boolean)).toBe(true);
    expect(inventory.serialize()).toEqual(before);
    inventory.addItem('oak_planks', 8);
    const placed = placeCraftingRecipe(recipe, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    expect(placed.placed).toBe(true);
    expect(inventory.count('oak_planks')).toBe(0);
    inventory.addItem('oak_planks', 24);
    const shifted = placeCraftingRecipe(recipe, placed.grid, inventory, 3, 64);
    expect(shifted.placed).toBe(true);
    expect(shifted.grid.find((cell) => cell)?.count).toBeGreaterThan(1);
    expect(inventory.count('oak_planks') + (shifted.grid.reduce((sum, cell) => sum + (cell?.count ?? 0), 0))).toBe(32);
  });

  it('moves a furnace ingredient into input and never auto-fills fuel', () => {
    const inventory = new Inventory();
    inventory.addItem('iron_ore', 3);
    inventory.addItem('coal', 4);
    const recipe = SMELTING_RECIPES.find((item) => item.id === 'iron_ingot')!;
    const placed = placeSmeltingIngredient(recipe, null, inventory);
    expect(placed.placed).toBe(true);
    expect(placed.input).toEqual(createItemStack('iron_ore'));
    expect(inventory.count('coal')).toBe(4);
    const empty = new Inventory();
    const before = empty.serialize();
    const missing = placeSmeltingIngredient(recipe, null, empty);
    expect(missing.placed).toBe(false);
    expect(missing.input).toBeNull();
    expect(empty.serialize()).toEqual(before);
  });

  it('does not show Creative catalog on block containers', () => {
    expect(showsCreativeCatalog('chest', 'creative')).toBe(false);
  });
});
