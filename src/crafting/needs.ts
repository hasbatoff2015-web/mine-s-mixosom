import { getItemsWithTag } from '../items';
import type { Inventory } from '../inventory';
import type { Ingredient, Recipe } from './types';

export function ingredientItemIds(ingredient: Ingredient): readonly string[] {
  if (typeof ingredient === 'string') return [ingredient];
  if ('item' in ingredient) return [ingredient.item];
  if ('anyOf' in ingredient) return ingredient.anyOf;
  return getItemsWithTag(ingredient.tag).map((item) => item.id);
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

export function inventoryAndGridCounts(
  inventory: Inventory,
  grid: readonly ({ itemId: string; count: number } | null)[],
): Map<string, number> {
  const counts = new Map(inventoryItemCounts(inventory));
  for (const stack of grid) {
    if (!stack) continue;
    counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + stack.count);
  }
  return counts;
}
