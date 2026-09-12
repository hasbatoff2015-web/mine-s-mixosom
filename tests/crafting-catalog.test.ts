import { describe, expect, it } from 'vitest';
import {
  CRAFTING_RECIPES,
  CRAFT_UNCRAFTABLE_HINT,
  compareCraftCatalogItems,
  craftCatalogEntries,
  craftCatalogGroup,
  craftIngredientLines,
  craftOnceByRecipeId,
  findPrimaryRecipeForItem,
  matchesCraftSearch,
  sortedCraftCatalogItems,
} from '../src/crafting';
import { Inventory } from '../src/inventory';
import { getItemDefinition, obtainableItems } from '../src/items';

const GROUP_ORDER = ['planks', 'tools', 'armor', 'tnt', 'logs', 'sticks', 'weapons', 'food', 'resources', 'blocks', 'other'] as const;

describe('craft catalog', () => {
  it('lists every obtainable item, including those without a recipe', () => {
    const obtainable = obtainableItems();
    const catalog = sortedCraftCatalogItems();
    expect(catalog.map((item) => item.id).sort()).toEqual(obtainable.map((item) => item.id).sort());
    expect(catalog.length).toBe(obtainable.length);
    const dirt = catalog.find((item) => item.id === 'dirt');
    expect(dirt).toBeDefined();
    expect(findPrimaryRecipeForItem('dirt')).toBeUndefined();
    const empty = new Inventory();
    const dirtEntry = craftCatalogEntries(empty).find((entry) => entry.itemId === 'dirt');
    expect(dirtEntry?.recipeId).toBeUndefined();
    expect(dirtEntry?.craftable).toBe(false);
    expect(CRAFT_UNCRAFTABLE_HINT).toBe('Данный предмет невозможно скрафтить.');
  });

  it('orders planks, tools, armor, then every TNT type before the rest', () => {
    const items = sortedCraftCatalogItems();
    const ranks = items.map((item) => GROUP_ORDER.indexOf(craftCatalogGroup(item)));
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]!).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
    const firstOf = (group: (typeof GROUP_ORDER)[number]) => items.findIndex((item) => craftCatalogGroup(item) === group);
    expect(firstOf('planks')).toBe(0);
    expect(firstOf('planks')).toBeLessThan(firstOf('tools'));
    expect(firstOf('tools')).toBeLessThan(firstOf('armor'));
    expect(firstOf('armor')).toBeLessThan(firstOf('tnt'));
    const tntIds = items.filter((item) => craftCatalogGroup(item) === 'tnt').map((item) => item.id);
    expect(tntIds.sort()).toEqual(['tnt', 'tnt_destructive', 'tnt_powerful'].sort());
    expect(items.some((item) => item.id === 'oak_planks' && craftCatalogGroup(item) === 'planks')).toBe(true);
    expect(items.some((item) => item.id === 'iron_pickaxe' && craftCatalogGroup(item) === 'tools')).toBe(true);
    expect(items.some((item) => item.id === 'iron_chestplate' && craftCatalogGroup(item) === 'armor')).toBe(true);
  });

  it('keeps the same relative order for equal groups by Russian name', () => {
    const oak = getItemDefinition('oak_planks');
    const birch = getItemDefinition('birch_planks');
    expect(craftCatalogGroup(oak)).toBe('planks');
    expect(craftCatalogGroup(birch)).toBe('planks');
    const ordered = [oak, birch].sort(compareCraftCatalogItems).map((item) => item.id);
    expect(ordered).toEqual(
      [oak, birch].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)).map((item) => item.id),
    );
  });

  it('filters the catalog by item name without dropping uncraftable matches', () => {
    const inventory = new Inventory();
    const dirtName = getItemDefinition('dirt').name;
    expect(matchesCraftSearch(dirtName, 'dirt', dirtName.slice(0, 3))).toBe(true);
    expect(matchesCraftSearch(dirtName, 'dirt', 'zzzz-no-such-item')).toBe(false);
    const found = craftCatalogEntries(inventory, dirtName);
    expect(found.some((entry) => entry.itemId === 'dirt')).toBe(true);
    expect(found.every((entry) => matchesCraftSearch(entry.name, entry.itemId, dirtName))).toBe(true);
  });

  it('marks a recipe available only when every ingredient is present in full', () => {
    const recipe = CRAFTING_RECIPES.find((entry) => entry.id === 'oak_planks_from_log')!;
    const missing = new Inventory();
    missing.addItem('oak_log', 1);
    missing.addItem('stick', 1);
    const sticks = CRAFTING_RECIPES.find((entry) => entry.id === 'sticks')!;
    expect(craftCatalogEntries(missing).find((entry) => entry.itemId === 'oak_planks')?.craftable).toBe(true);
    expect(craftCatalogEntries(missing).find((entry) => entry.itemId === 'stick')?.craftable).toBe(false);
    const enough = new Inventory();
    enough.addItem('oak_planks', 2);
    expect(craftCatalogEntries(enough).find((entry) => entry.itemId === 'stick')?.craftable).toBe(true);
    const short = new Inventory();
    short.addItem('oak_planks', 1);
    expect(craftCatalogEntries(short).find((entry) => entry.itemId === 'stick')?.craftable).toBe(false);
    const stickLines = craftIngredientLines(sticks, short);
    expect(stickLines.some((line) => line.need === 2 && line.have === 1 && line.enough === false)).toBe(true);
    const plankLines = craftIngredientLines(recipe, missing);
    expect(plankLines).toEqual([expect.objectContaining({ itemId: 'oak_log', have: 1, need: 1, enough: true })]);
    const after = new Inventory();
    after.addItem('oak_log', 1);
    expect(craftCatalogEntries(after).find((entry) => entry.itemId === 'oak_planks')?.craftable).toBe(true);
    expect(craftOnceByRecipeId(after, 'oak_planks_from_log').ok).toBe(true);
    expect(craftCatalogEntries(after).find((entry) => entry.itemId === 'oak_planks')?.craftable).toBe(false);
  });
});
