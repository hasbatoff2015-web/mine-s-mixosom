import { Inventory } from '../../src/inventory/inventory';
import { cloneStack } from '../../src/inventory/stack';
import type { InventorySlotRef, ItemStack } from '../../src/inventory/types';

/** Target main inventory, then hotbar, then armor, then offhand. */
export const INVSEE_SLOT_COUNT = 41;

const ARMOR = ['head', 'chest', 'legs', 'feet'] as const;

export function invseeIndexToRef(index: number): InventorySlotRef | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= INVSEE_SLOT_COUNT) return undefined;
  if (index < 27) return index + 9;
  if (index < 36) return index - 27;
  if (index < 40) return { section: 'armor', slot: ARMOR[index - 36]! };
  return { section: 'offhand' };
}

export function readInvseeSlots(inventory: Inventory): Array<ItemStack | null> {
  return Array.from({ length: INVSEE_SLOT_COUNT }, (_, index) => {
    const ref = invseeIndexToRef(index);
    return ref === undefined ? null : inventory.getSlot(ref);
  });
}

/** Writes every slot. Throws if an armor cell rejects the stack, after no partial commit is guaranteed by the caller. */
export function writeInvseeSlots(inventory: Inventory, slots: readonly (ItemStack | null)[]): void {
  for (let index = 0; index < INVSEE_SLOT_COUNT; index += 1) {
    const ref = invseeIndexToRef(index);
    if (ref === undefined) continue;
    inventory.setSlot(ref, cloneStack(slots[index] ?? null));
  }
}
