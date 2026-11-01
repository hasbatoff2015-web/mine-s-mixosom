import type { Inventory } from '../../../src/inventory';
import type { ItemStack } from '../../../src/inventory/types';

export function stackCount(stack: ItemStack | null | undefined, itemId?: string): number {
  if (!stack) return 0;
  if (itemId && stack.itemId !== itemId) return 0;
  return stack.count;
}

export function totalCount(stacks: readonly (ItemStack | null | undefined)[], itemId?: string): number {
  return stacks.reduce((sum, stack) => sum + stackCount(stack, itemId), 0);
}

/** Player storage, armor, offhand, and cursor. Craft grid is separate. */
export function inventoryTotal(inventory: Inventory, itemId: string, cursor?: ItemStack | null): number {
  return inventory.count(itemId) + stackCount(cursor, itemId);
}
