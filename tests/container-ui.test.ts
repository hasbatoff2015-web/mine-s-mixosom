import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPES, SMELTING_RECIPES, findSmeltingRecipe, getFuelBurnTicks } from '../src/crafting';
import { Inventory, createItemStack } from '../src/inventory';
import { VoxelWorld } from '../src/world/World';
import {
  clickFurnaceSlot,
  furnaceAccepts,
  ghostFromRecipe,
  hasRecipeBook,
  maxRecipeFill,
  placeCraftingRecipe,
  placeSmeltingIngredient,
  returnStacksToInventory,
  showsCreativeCatalog,
  takeCraftOutput,
} from '../src/ui/containerInteractions';
import {
  allCraftingBookEntries,
  allSmeltingBookEntries,
  inventoryAndGridCounts,
  inventoryItemCounts,
  isCraftingRecipeCraftable,
  isFuelItem,
  isSmeltableItem,
  queryRecipeBook,
  recipeBookTabIcon,
  recipeBookTabUsesText,
  recipeEntryCraftable,
  RECIPE_BOOK_TAB_ICONS,
  visibleRecipeBookTabs,
} from '../src/ui/recipeBook';
import { containerStageSize, containerUiScale, containerUiScaleWithClose, MC_BOOK_BUTTON_IN_CRAFT_ROW, MC_CLOSE_GUTTER, MC_CLOSE_HIT_MIN_PX, MC_CREATIVE_SCROLL_GUTTER } from '../src/ui/containerTheme';
import {
  applySlotSnapshots,
  armorSlotKind,
  catalogMustHideMainInventory,
  CREATIVE_ARMOR_SLOT_KEYS,
  CREATIVE_DEFAULT_TAB,
  creativeCatalogPlayerSlotKeys,
  creativeInventoryTabSlotKeys,
  patchContainerDynamic,
  patchInventoryDynamic,
  slotStateSignature,
} from '../src/ui/inventoryLayout';

describe('container layout', () => {
  it('keeps furnace/crafting logical size near vanilla 176×166', () => {
    expect(containerStageSize('furnace', false)).toEqual({ width: 176, height: 166 });
    expect(containerStageSize('crafting-table', false).height).toBe(166);
    expect(containerStageSize('crafting-table', false).width).toBe(176);
    expect(containerStageSize('chest', false).width).toBe(176);
    const withBook = containerStageSize('crafting-table', true);
    expect(withBook.width).toBeGreaterThan(176);
    expect(containerStageSize('creative', false).width).toBe(195);
    expect(containerStageSize('creative', false).height).toBe(166);
    expect(MC_BOOK_BUTTON_IN_CRAFT_ROW).toBe(true);
    const creativeInner = 195 - 14;
    expect(9 * 18).toBeLessThanOrEqual(creativeInner);
    expect(9 * 18 + MC_CREATIVE_SCROLL_GUTTER).toBeLessThanOrEqual(creativeInner);
  });

  it('scales down to fit 1280×720 and does not explode on 2560×1440', () => {
    const small = containerUiScale(1280, 720, 176, 166);
    const large = containerUiScale(2560, 1440, 176, 166);
    expect(small).toBeGreaterThanOrEqual(1);
    expect(large).toBeLessThanOrEqual(4);
    expect(large * 176).toBeLessThanOrEqual(2560);
    expect(containerUiScale(320, 180, 327, 166)).toBeLessThan(1);
  });

  it('reserves outside-panel close space without shrinking the logical panel size', () => {
    expect(MC_CLOSE_GUTTER).toBeGreaterThanOrEqual(16);
    expect(MC_CLOSE_HIT_MIN_PX).toBe(44);
    const panel = containerStageSize('inventory', false);
    expect(panel.width).toBe(176);
    const withClose = containerUiScaleWithClose(667, 375, panel.width, panel.height);
    const without = containerUiScale(667, 375, panel.width, panel.height);
    expect(withClose).toBeLessThanOrEqual(without);
    for (const size of [
      [932, 430], [844, 390], [800, 360], [768, 360], [740, 360], [720, 360], [667, 375],
    ] as const) {
      const creative = containerStageSize('creative', false);
      const scale = containerUiScaleWithClose(size[0], size[1], creative.width, creative.height);
      expect(creative.width * scale + MC_CLOSE_HIT_MIN_PX).toBeLessThanOrEqual(size[0] - 24);
      expect(creative.height * scale).toBeLessThanOrEqual(size[1] - 24);
    }
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
    expect(hasRecipeBook('furnace')).toBe(false);
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
    expect(tabs).toContain('building');
    expect(recipeBookTabUsesText('all')).toBe(true);
    expect(recipeBookTabUsesText('building')).toBe(false);
    expect(recipeBookTabIcon('building')).toBe('block/bricks');
    expect(recipeBookTabIcon('equipment')).toBe('item/iron_pickaxe');
    expect(recipeBookTabIcon('food')).toBe('item/apple');
    expect(recipeBookTabIcon('redstone')).toBe('item/redstone_dust');
    expect(recipeBookTabIcon('misc')).toBe('item/gunpowder');
    expect(RECIPE_BOOK_TAB_ICONS.all).toBeUndefined();
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

describe('recipe book transactions', () => {
  it('clears recipe A before placing B and conserves items', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 8);
    const chest = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const table = CRAFTING_RECIPES.find((item) => item.id === 'crafting_table')!;
    const first = placeCraftingRecipe(chest, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    expect(first.placed).toBe(true);
    expect(first.grid.filter(Boolean)).toHaveLength(8);
    const second = placeCraftingRecipe(table, first.grid, inventory, 3, 1);
    expect(second.placed).toBe(true);
    expect(second.aborted).toBe(false);
    expect(second.grid.filter(Boolean)).toHaveLength(4);
    expect(inventory.count('oak_planks')).toBe(4);
    expect(second.grid.every((cell) => !cell || cell.itemId === 'oak_planks')).toBe(true);
  });

  it('returns real A and shows only a ghost when B is uncraftable', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 8);
    const chest = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const pickaxe = CRAFTING_RECIPES.find((item) => item.id === 'diamond_pickaxe')!;
    const first = placeCraftingRecipe(chest, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    const second = placeCraftingRecipe(pickaxe, first.grid, inventory, 3, 1);
    expect(second.placed).toBe(false);
    expect(second.aborted).toBe(false);
    expect(second.grid.every((cell) => cell === null)).toBe(true);
    expect(inventory.count('oak_planks')).toBe(8);
    expect(second.ghost?.recipeId).toBe('diamond_pickaxe');
    expect(inventory.count('diamond')).toBe(0);
  });

  it('aborts without loss when inventory cannot accept the previous grid', () => {
    const inventory = new Inventory();
    for (let index = 0; index < 36; index += 1) inventory.setSlot(index, createItemStack('cobblestone', 64));
    const grid = Array.from({ length: 9 }, () => null as ReturnType<typeof createItemStack> | null);
    grid[0] = createItemStack('oak_planks', 8);
    const table = CRAFTING_RECIPES.find((item) => item.id === 'crafting_table')!;
    const result = placeCraftingRecipe(table, grid, inventory, 3, 1);
    expect(result.aborted).toBe(true);
    expect(result.grid[0]).toEqual(createItemStack('oak_planks', 8));
    expect(inventory.count('oak_planks')).toBe(0);
  });

  it('does not duplicate when switching A→B→A', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 8);
    const chest = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const table = CRAFTING_RECIPES.find((item) => item.id === 'crafting_table')!;
    const a = placeCraftingRecipe(chest, Array.from({ length: 9 }, () => null), inventory, 3, 1);
    const b = placeCraftingRecipe(table, a.grid, inventory, 3, 1);
    const again = placeCraftingRecipe(chest, b.grid, inventory, 3, 1);
    expect(again.placed).toBe(true);
    const total = inventory.count('oak_planks') + again.grid.reduce((sum, cell) => sum + (cell?.count ?? 0), 0);
    expect(total).toBe(8);
  });

  it('counts split stacks for Show Craftable and shift fill', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('oak_planks', 4));
    inventory.setSlot(10, createItemStack('oak_planks', 4));
    const chest = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    const sticks = CRAFTING_RECIPES.find((item) => item.id === 'sticks')!;
    const counts = inventoryItemCounts(inventory);
    expect(isCraftingRecipeCraftable(chest, counts)).toBe(true);
    expect(isCraftingRecipeCraftable(sticks, counts)).toBe(true);
    inventory.setSlot(10, null);
    expect(isCraftingRecipeCraftable(chest, inventoryItemCounts(inventory))).toBe(false);
    expect(isCraftingRecipeCraftable(sticks, inventoryItemCounts(inventory))).toBe(true);
    expect(maxRecipeFill(sticks, inventoryItemCounts(inventory))).toBe(2);
  });

  it('includes grid contents when checking craftable status', () => {
    const inventory = new Inventory();
    const grid = Array.from({ length: 9 }, () => null as ReturnType<typeof createItemStack> | null);
    grid[0] = createItemStack('oak_planks', 8);
    const chest = CRAFTING_RECIPES.find((item) => item.id === 'chest')!;
    expect(isCraftingRecipeCraftable(chest, inventoryItemCounts(inventory))).toBe(false);
    expect(isCraftingRecipeCraftable(chest, inventoryAndGridCounts(inventory, grid))).toBe(true);
  });

  it('hides 3×3 recipes from the Survival 2×2 book', () => {
    const two = queryRecipeBook({
      kind: 'crafting', gridSize: 2, category: 'all', search: '', craftableOnly: false,
    }, new Map());
    const three = queryRecipeBook({
      kind: 'crafting', gridSize: 3, category: 'all', search: '', craftableOnly: false,
    }, new Map());
    expect(two.some((entry) => entry.id === 'chest')).toBe(false);
    expect(three.some((entry) => entry.id === 'chest')).toBe(true);
    expect(two.some((entry) => entry.id === 'crafting_table')).toBe(true);
  });
});

describe('creative inventory contract', () => {
  it('defaults to Catalog with only 9 hotbar player slots', () => {
    expect(CREATIVE_DEFAULT_TAB).toBe('catalog');
    expect(catalogMustHideMainInventory('catalog')).toBe(true);
    expect(catalogMustHideMainInventory('inventory')).toBe(false);
    const hotbar = creativeCatalogPlayerSlotKeys();
    expect(hotbar).toHaveLength(9);
    expect(hotbar).toEqual(Array.from({ length: 9 }, (_value, index) => `inventory-${index}`));
    expect(hotbar.some((key) => key === 'inventory-9')).toBe(false);
    const inventoryTab = creativeInventoryTabSlotKeys();
    expect(inventoryTab.filter((key) => key.startsWith('inventory-'))).toHaveLength(36);
    expect(inventoryTab).toEqual(expect.arrayContaining([...CREATIVE_ARMOR_SLOT_KEYS]));
    expect(inventoryTab).not.toContain('offhand');
    expect(armorSlotKind('armor-head')).toBe('head');
    expect(armorSlotKind('offhand')).toBeUndefined();
    expect(armorSlotKind('inventory-0')).toBeUndefined();
  });

  it('keeps slot DOM identity across content patches', () => {
    const slot = { key: 'inventory-5', signature: slotStateSignature({ itemId: 'dirt', count: 64 }), className: 'slot', title: '', innerHTML: '64' };
    const existing = [slot];
    const result = applySlotSnapshots(existing, [{
      key: 'inventory-5',
      signature: slotStateSignature({ itemId: 'dirt', count: 63 }),
      className: 'slot',
      title: '',
      innerHTML: '63',
    }]);
    expect(result.preserved).toBe(true);
    expect(result.identity).toBe(true);
    expect(existing[0]).toBe(slot);
    expect(slot.innerHTML).toBe('63');
  });
});

