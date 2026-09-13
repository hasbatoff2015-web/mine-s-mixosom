import { createItemStack, type Inventory } from '../inventory';
import { CRAFTING_RECIPES } from './recipes';
import {
  craftingNeedCounts,
  inventoryItemCounts,
  isCraftingRecipeCraftable,
} from './needs';
import type { Recipe, RecipeOutput } from './types';

export type CraftOnceFailure = 'unknown' | 'missing' | 'full';

export type CraftOnceResult =
  | { readonly ok: true; readonly recipeId: string; readonly output: RecipeOutput }
  | { readonly ok: false; readonly reason: CraftOnceFailure };

export const CRAFT_INVENTORY_FULL_MESSAGE = 'Инвентарь заполнен.';

export function findCraftingRecipeById(recipeId: string): Recipe | undefined {
  return CRAFTING_RECIPES.find((recipe) => recipe.id === recipeId);
}

export function findPrimaryRecipeForItem(itemId: string): Recipe | undefined {
  return CRAFTING_RECIPES.find((recipe) => recipe.output.item === itemId);
}

function remainderStacks(recipe: Recipe, consumed: ReadonlyMap<string, number>) {
  const remainders = recipe.remainders ?? {};
  const stacks = [];
  for (const [itemId, count] of consumed) {
    const leftover = remainders[itemId];
    if (!leftover || count <= 0) continue;
    stacks.push(createItemStack(leftover, count));
  }
  return stacks;
}

/** Atomic one-craft: consume ingredients and add the full result, or change nothing. */
export function craftOnceByRecipeId(inventory: Inventory, recipeId: string): CraftOnceResult {
  const recipe = findCraftingRecipeById(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown' };
  const counts = inventoryItemCounts(inventory);
  if (!isCraftingRecipeCraftable(recipe, counts)) return { ok: false, reason: 'missing' };
  const needs = craftingNeedCounts(recipe, counts);
  const trial = inventory.clone();
  for (const [itemId, need] of needs) {
    if (trial.remove(itemId, need) !== need) return { ok: false, reason: 'missing' };
  }
  const additions = [
    ...remainderStacks(recipe, needs),
    createItemStack(recipe.output.item, recipe.output.count),
  ];
  for (const stack of additions) {
    if (trial.add(stack) !== null) return { ok: false, reason: 'full' };
  }
  inventory.restore(trial.serialize());
  return { ok: true, recipeId: recipe.id, output: recipe.output };
}

export function canCraftOnce(inventory: Inventory, recipeId: string): CraftOnceFailure | true {
  const result = craftOnceByRecipeId(inventory.clone(), recipeId);
  return result.ok ? true : result.reason;
}
