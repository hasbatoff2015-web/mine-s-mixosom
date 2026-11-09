import { Inventory } from '../../src/inventory';
import type { KitStack } from '../services/kit';

function stackOptions(item: KitStack): { durability?: number } {
  return item.durability !== undefined ? { durability: item.durability } : {};
}

/** True only when every stack fits. The live inventory is not changed. */
export function kitFits(inventory: Inventory, items: readonly KitStack[]): boolean {
  if (items.length === 0) return false;
  const copy = inventory.clone();
  for (const item of items) {
    if (copy.addItem(item.itemId, item.count, stackOptions(item)) > 0) return false;
  }
  return true;
}

/** Inserts every stack or leaves the inventory untouched. Never drops the overflow. */
export function applyKit(inventory: Inventory, items: readonly KitStack[]): boolean {
  if (!kitFits(inventory, items)) return false;
  const copy = inventory.clone();
  for (const item of items) copy.addItem(item.itemId, item.count, stackOptions(item));
  inventory.restore(copy.serialize());
  return true;
}
