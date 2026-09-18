import type { Inventory } from '../inventory';
import { ItemId } from '../items';

/** Death protection checks the authoritative offhand slot, regardless of held presentation. */
export function consumeOffhandTotem(inventory: Inventory): boolean {
  const slot = { section: 'offhand' as const };
  const stack = inventory.getSlot(slot);
  if (stack?.itemId !== ItemId.TotemOfUndying || stack.count < 1) return false;
  inventory.setSlot(slot, stack.count === 1 ? null : { ...stack, count: stack.count - 1 });
  return true;
}
