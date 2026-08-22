import { getItemDefinition, getItemsWithTag, itemHasTag } from '../items';
import type { Inventory } from '../inventory';
import {
  CRAFTING_RECIPES,
  SMELTING_RECIPES,
  findSmeltingRecipe,
  getFuelBurnTicks,
  ingredientMatches,
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

const CRAFTING_TABS: readonly CraftingBookCategory[] = ['all', 'equipment', 'building', 'food', 'redstone', 'misc'];
const SMELTING_TABS: readonly SmeltingBookCategory[] = ['all', 'food', 'building', 'misc'];

function ingredientItemIds(ingredient: Ingredient): readonly string[] {
  if (typeof ingredient === 'string') return [ingredient];
  if ('item' in ingredient) return [ingredient.item];
  if ('anyOf' in ingredient) return ingredient.anyOf;
  return getItemsForTag(ingredient.tag);
}

function getItemsForTag(tag: string): readonly string[] {
  return getItemsWithTag(tag).map((item) => item.id);
}

function recipeIngredients(recipe: Recipe): readonly Ingredient[] {
  if (recipe.type === 'shapeless') return recipe.ingredients;
  return Object.values(recipe.key);
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

export function inventoryItemCounts(inventory: Inventory): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const stack of inventory.slots) {
    if (!stack) continue;
    counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + stack.count);
  }
  const offhand = inventory.offhand;
  if (offhand) counts.set(offhand.itemId, (counts.get(offhand.itemId) ?? 0) + offhand.count);
  return counts;
}

export function pickIngredientItem(
  ingredient: Ingredient,
  counts: ReadonlyMap<string, number>,
): string {
  const ids = ingredientItemIds(ingredient);
  return ids.find((id) => (counts.get(id) ?? 0) > 0) ?? ids[0]!;
}

export function craftingNeedCounts(recipe: Recipe, counts: ReadonlyMap<string, number>): Map<string, number> {
  const needs = new Map<string, number>();
  if (recipe.type === 'shapeless') {
    for (const ingredient of recipe.ingredients) {
      const id = pickIngredientItem(ingredient, counts);
      const amount = typeof ingredient === 'string' ? 1 : ingredient.count ?? 1;
      needs.set(id, (needs.get(id) ?? 0) + amount);
    }
    return needs;
  }
  for (const row of recipe.pattern) {
    for (const char of row) {
      if (char === ' ') continue;
      const ingredient = recipe.key[char];
      if (!ingredient) continue;
      const id = pickIngredientItem(ingredient, counts);
      needs.set(id, (needs.get(id) ?? 0) + 1);
    }
  }
  return needs;
}

export function isCraftingRecipeCraftable(recipe: Recipe, counts: ReadonlyMap<string, number>): boolean {
  for (const [itemId, need] of craftingNeedCounts(recipe, counts)) {
    if ((counts.get(itemId) ?? 0) < need) return false;
  }
  return true;
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

export { ingredientItemIds };
