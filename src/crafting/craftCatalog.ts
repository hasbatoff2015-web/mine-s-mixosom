import { getItemDefinition, obtainableItems, itemHasTag, type ItemDefinition } from '../items';
import type { Inventory } from '../inventory';
import { CRAFTING_RECIPES } from './recipes';
import { findPrimaryRecipeForItem } from './craftOnce';
import {
  craftingNeedCounts,
  inventoryItemCounts,
  isCraftingRecipeCraftable,
} from './needs';
import type { Recipe } from './types';

const TNT_IDS = new Set(['tnt', 'tnt_powerful', 'tnt_destructive']);

export interface CraftCatalogEntry {
  readonly itemId: string;
  readonly name: string;
  readonly recipeId?: string;
  readonly resultCount: number;
  readonly craftable: boolean;
}

export interface CraftIngredientLine {
  readonly itemId: string;
  readonly name: string;
  readonly have: number;
  readonly need: number;
  readonly enough: boolean;
}

export type CraftCatalogGroup = 'planks' | 'tools' | 'armor' | 'tnt' | 'logs' | 'sticks'
  | 'weapons' | 'food' | 'resources' | 'blocks' | 'other';

const GROUP_ORDER: readonly CraftCatalogGroup[] = [
  'planks', 'tools', 'armor', 'tnt', 'logs', 'sticks', 'weapons', 'food', 'resources', 'blocks', 'other',
];

export function craftCatalogGroup(item: ItemDefinition): CraftCatalogGroup {
  if (itemHasTag(item.id, 'planks')) return 'planks';
  if (item.kind === 'tool') return 'tools';
  if (item.kind === 'armor') return 'armor';
  if (TNT_IDS.has(item.id)) return 'tnt';
  if (itemHasTag(item.id, 'log')) return 'logs';
  if (item.id === 'stick' || itemHasTag(item.id, 'stick')) return 'sticks';
  if (item.kind === 'weapon') return 'weapons';
  if (item.kind === 'food') return 'food';
  if (item.kind === 'resource') return 'resources';
  if (item.kind === 'block') return 'blocks';
  return 'other';
}

function groupRank(group: CraftCatalogGroup): number {
  const index = GROUP_ORDER.indexOf(group);
  return index < 0 ? GROUP_ORDER.length : index;
}

export function compareCraftCatalogItems(a: ItemDefinition, b: ItemDefinition): number {
  const group = groupRank(craftCatalogGroup(a)) - groupRank(craftCatalogGroup(b));
  if (group !== 0) return group;
  return a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
}

export type CraftCatalogBand = 'available' | 'missing' | 'uncraftable';

export function craftCatalogBand(entry: CraftCatalogEntry): CraftCatalogBand {
  if (entry.craftable) return 'available';
  if (entry.recipeId) return 'missing';
  return 'uncraftable';
}

const BAND_ORDER: readonly CraftCatalogBand[] = ['available', 'missing', 'uncraftable'];

/** Available → has recipe but missing ingredients → no recipe. Groups stay inside each band. */
export function compareCraftCatalogEntries(a: CraftCatalogEntry, b: CraftCatalogEntry): number {
  const band = BAND_ORDER.indexOf(craftCatalogBand(a)) - BAND_ORDER.indexOf(craftCatalogBand(b));
  if (band !== 0) return band;
  return compareCraftCatalogItems(getItemDefinition(a.itemId), getItemDefinition(b.itemId));
}

export function sortedCraftCatalogItems(): readonly ItemDefinition[] {
  return [...obtainableItems()].sort(compareCraftCatalogItems);
}

export function recipeById(recipeId: string): Recipe | undefined {
  return CRAFTING_RECIPES.find((recipe) => recipe.id === recipeId);
}

export function matchesCraftSearch(name: string, itemId: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle) || itemId.toLowerCase().includes(needle);
}

export function craftCatalogEntries(
  inventory: Inventory,
  search = '',
): readonly CraftCatalogEntry[] {
  const counts = inventoryItemCounts(inventory);
  return sortedCraftCatalogItems()
    .filter((item) => matchesCraftSearch(item.name, item.id, search))
    .map((item) => {
      const recipe = findPrimaryRecipeForItem(item.id);
      return {
        itemId: item.id,
        name: item.name,
        recipeId: recipe?.id,
        resultCount: recipe?.output.count ?? 0,
        craftable: recipe !== undefined && isCraftingRecipeCraftable(recipe, counts),
      };
    })
    .sort(compareCraftCatalogEntries);
}

export function craftIngredientLines(recipe: Recipe, inventory: Inventory): readonly CraftIngredientLine[] {
  const counts = inventoryItemCounts(inventory);
  const needs = craftingNeedCounts(recipe, counts);
  return [...needs.entries()].map(([itemId, need]) => {
    const have = counts.get(itemId) ?? 0;
    return {
      itemId,
      name: getItemDefinition(itemId).name,
      have,
      need,
      enough: have >= need,
    };
  });
}

export const CRAFT_UNCRAFTABLE_HINT = 'Данный предмет невозможно скрафтить.';
