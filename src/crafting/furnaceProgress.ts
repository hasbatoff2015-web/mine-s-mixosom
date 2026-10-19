import type { ItemStack } from '../inventory';
import { findSmeltingRecipe } from './matcher';

export interface FurnaceProgressInput {
  readonly slots: readonly (ItemStack | null)[];
  readonly burnTime: number;
  readonly burnTotal: number;
  readonly cookTime: number;
}

/** Flame fill. `burnTime / burnTotal`, or 0 when the furnace is not burning. */
export function furnaceBurnRatio(furnace: Pick<FurnaceProgressInput, 'burnTime' | 'burnTotal'>): number {
  if (furnace.burnTotal <= 0 || furnace.burnTime <= 0) return 0;
  return Math.max(0, Math.min(1, furnace.burnTime / furnace.burnTotal));
}

/**
 * Arrow fill from the current input's smelting recipe.
 * No input, no recipe, or a non-positive cook time reads as 0.
 */
export function furnaceCookRatio(furnace: Pick<FurnaceProgressInput, 'slots' | 'cookTime'>): number {
  const input = furnace.slots[0];
  if (!input || furnace.cookTime <= 0) return 0;
  const recipe = findSmeltingRecipe(input.itemId);
  if (!recipe || recipe.cookingTimeTicks <= 0) return 0;
  return Math.max(0, Math.min(1, furnace.cookTime / recipe.cookingTimeTicks));
}
