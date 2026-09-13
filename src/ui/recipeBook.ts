import { getItemDefinition, itemHasTag } from '../items';
import {
  CRAFTING_RECIPES,
  SMELTING_RECIPES,
  craftingNeedCounts,
  findSmeltingRecipe,
  getFuelBurnTicks,
  ingredientItemIds,
  ingredientMatches,
  inventoryAndGridCounts,
  inventoryItemCounts,
  isCraftingRecipeCraftable,
  pickIngredientItem,
  type Ingredient,
  type Recipe,
  type SmeltingRecipe,
} from '../crafting';

export type RecipeBookKind = 'crafting' | 'smelting';
export type CraftingBookCategory = 'all' | 'equipment' | 'building' | 'food' | 'redstone' | 'misc';
export type SmeltingBookCategory = 'all' | 'food' | 'building' | 'misc';
export type RecipeBookCategory = CraftingBookCategory | SmeltingBookCategory;

export interface RecipeBookEntry {
  readonly id: string;
  readonly kind: RecipeBookKind;
  readonly category: RecipeBookCategory;
  readonly resultId: string;
  readonly resultCount: number;
  readonly gridSize: 1 | 2 | 3;
  readonly recipe?: Recipe;
  readonly smelting?: SmeltingRecipe;
}

export interface RecipeBookQuery {
  readonly kind: RecipeBookKind;
  readonly gridSize: 2 | 3;
  readonly category: RecipeBookCategory;
  readonly search: string;
  readonly craftableOnly: boolean;
  readonly knownIds?: ReadonlySet<string>;
}

export interface RecipeBookPage {
  readonly entries: readonly RecipeBookEntry[];
  readonly page: number;
  readonly pageCount: number;
}

export const RECIPE_BOOK_PAGE_SIZE = 20;

const CRAFTING_TABS: readonly CraftingBookCategory[] = ['all', 'building', 'equipment', 'food', 'redstone', 'misc'];
const SMELTING_TABS: readonly SmeltingBookCategory[] = ['all', 'food', 'building', 'misc'];

/** Texture keys for category tabs. `all` stays a text label ("Все"). */
export const RECIPE_BOOK_TAB_ICONS: Readonly<Record<CraftingBookCategory, string | undefined>> = Object.freeze({
  all: undefined,
  building: 'block/bricks',
  equipment: 'item/iron_pickaxe',
  food: 'item/apple',
  redstone: 'item/redstone_dust',
  misc: 'item/gunpowder',
});

export function recipeBookTabIcon(tab: RecipeBookCategory): string | undefined {
  if (tab === 'all') return undefined;
  return RECIPE_BOOK_TAB_ICONS[tab as CraftingBookCategory];
}

export function recipeBookTabUsesText(tab: RecipeBookCategory): boolean {
  return tab === 'all';
}

export function categorizeCraftingRecipe(recipe: Recipe): CraftingBookCategory {
  const result = getItemDefinition(recipe.output.item);
  if (result.kind === 'tool' || result.kind === 'weapon' || result.kind === 'armor') return 'equipment';
  if (result.kind === 'food') return 'food';
  if (result.kind === 'block') {
    const key = result.id;
    if (
      key.includes('redstone')
      || key === 'lever'
      || key === 'stone_button'
      || key.endsWith('_pressure_plate')
      || key === 'tnt'
    ) return 'redstone';
    const tags = result.tags ?? [];
    if (
      tags.includes('planks')
      || tags.includes('slab')
      || tags.includes('stairs')
      || result.id === 'crafting_table'
      || result.id === 'chest'
      || result.id === 'portal_chest'
      || result.id === 'furnace'
      || result.id === 'glass'
      || result.id === 'bricks'
      || result.id === 'stone_bricks'
      || result.id.endsWith('_wool')
      || result.id === 'oak_door'
    ) return 'building';
  }
  if (result.id === 'redstone_dust' || result.id === 'redstone_torch') return 'redstone';
  return 'misc';
}

export function categorizeSmeltingRecipe(recipe: SmeltingRecipe): Exclude<SmeltingBookCategory, 'all'> {
  const output = getItemDefinition(recipe.output.item);
  if (output.kind === 'food') return 'food';
  if (output.kind === 'block' || output.id === 'glass') return 'building';
  return 'misc';
}

export function allCraftingBookEntries(): readonly RecipeBookEntry[] {
  return CRAFTING_RECIPES.map((recipe) => ({
    id: recipe.id,
    kind: 'crafting' as const,
    category: categorizeCraftingRecipe(recipe),
    resultId: recipe.output.item,
    resultCount: recipe.output.count,
    gridSize: recipe.gridSize ?? 3,
    recipe,
  }));
}

export function allSmeltingBookEntries(): readonly RecipeBookEntry[] {
  return SMELTING_RECIPES.map((recipe) => ({
    id: recipe.id,
    kind: 'smelting' as const,
    category: categorizeSmeltingRecipe(recipe),
    resultId: recipe.output.item,
    resultCount: recipe.output.count,
    gridSize: 1 as const,
    smelting: recipe,
  }));
}

export function visibleRecipeBookTabs(kind: RecipeBookKind): readonly RecipeBookCategory[] {
  const entries = kind === 'crafting' ? allCraftingBookEntries() : allSmeltingBookEntries();
  const tabs = kind === 'crafting' ? CRAFTING_TABS : SMELTING_TABS;
  return tabs.filter((tab) => tab === 'all' || entries.some((entry) => entry.category === tab));
}

export function isSmeltingRecipeCraftable(recipe: SmeltingRecipe, counts: ReadonlyMap<string, number>): boolean {
  return ingredientItemIds(recipe.input).some((id) => (counts.get(id) ?? 0) > 0);
}

export function recipeEntryCraftable(entry: RecipeBookEntry, counts: ReadonlyMap<string, number>): boolean {
  if (entry.recipe) return isCraftingRecipeCraftable(entry.recipe, counts);
  if (entry.smelting) return isSmeltingRecipeCraftable(entry.smelting, counts);
  return false;
}

function matchesSearch(entry: RecipeBookEntry, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const definition = getItemDefinition(entry.resultId);
  return definition.name.toLowerCase().includes(needle)
    || entry.resultId.toLowerCase().includes(needle)
    || entry.id.toLowerCase().includes(needle);
}

export function queryRecipeBook(query: RecipeBookQuery, counts: ReadonlyMap<string, number>): readonly RecipeBookEntry[] {
  const source = query.kind === 'crafting' ? allCraftingBookEntries() : allSmeltingBookEntries();
  return source.filter((entry) => {
    if (query.knownIds && !query.knownIds.has(entry.id)) return false;
    if (query.kind === 'crafting' && entry.gridSize > query.gridSize) return false;
    if (query.category !== 'all' && entry.category !== query.category) return false;
    if (!matchesSearch(entry, query.search)) return false;
    if (query.craftableOnly && !recipeEntryCraftable(entry, counts)) return false;
    return true;
  });
}

export function paginateRecipeBook(
  entries: readonly RecipeBookEntry[],
  page: number,
  pageSize = RECIPE_BOOK_PAGE_SIZE,
): RecipeBookPage {
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const start = safePage * pageSize;
  return {
    entries: entries.slice(start, start + pageSize),
    page: safePage,
    pageCount,
  };
}

export function groupEntriesByResult(entries: readonly RecipeBookEntry[]): ReadonlyMap<string, readonly RecipeBookEntry[]> {
  const groups = new Map<string, RecipeBookEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.resultId) ?? [];
    list.push(entry);
    groups.set(entry.resultId, list);
  }
  return groups;
}

export function nextVariant(entries: readonly RecipeBookEntry[], currentId: string): RecipeBookEntry {
  const index = entries.findIndex((entry) => entry.id === currentId);
  return entries[(index + 1) % entries.length]!;
}

export function isSmeltableItem(itemId: string): boolean {
  return findSmeltingRecipe(itemId) !== undefined;
}

export function isFuelItem(itemId: string): boolean {
  return getFuelBurnTicks(itemId) > 0;
}

export function ingredientMatchesItem(ingredient: Ingredient, itemId: string): boolean {
  return ingredientMatches(ingredient, itemId);
}

export function itemMatchesTag(itemId: string, tag: string): boolean {
  return itemHasTag(itemId, tag);
}

export {
  craftingNeedCounts,
  ingredientItemIds,
  inventoryAndGridCounts,
  inventoryItemCounts,
  isCraftingRecipeCraftable,
  pickIngredientItem,
};
