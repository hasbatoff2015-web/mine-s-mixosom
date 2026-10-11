import { cloneStack } from '../src/inventory/stack';
import type { ItemStack } from '../src/inventory/types';

export interface CarryHolder {
  cursor: ItemStack | null;
  craftSlots: Array<ItemStack | null>;
  /** Absent on test doubles that do not publish an inventory revision. */
  carryRevision?: number;
}

function stackToken(stack: ItemStack | null | undefined): string {
  if (!stack) return '';
  return `${stack.itemId}:${stack.count}:${stack.durability ?? ''}:${JSON.stringify(stack.metadata ?? null)}`;
}

function carryToken(cursor: ItemStack | null, craftSlots: readonly (ItemStack | null | undefined)[]): string {
  return `${stackToken(cursor)}|${craftSlots.map((stack) => stackToken(stack)).join(',')}`;
}

/**
 * One logical cursor and crafting-grid replacement. The published revision
 * moves once when the content changes, and stays put when the assignment matches.
 */
export function replaceCarryState(
  player: CarryHolder,
  cursor: ItemStack | null,
  craftSlots: readonly (ItemStack | null)[],
): boolean {
  const nextCursor = cloneStack(cursor);
  const nextGrid = craftSlots.map((stack) => cloneStack(stack));
  const changed = carryToken(player.cursor, player.craftSlots) !== carryToken(nextCursor, nextGrid);
  player.cursor = nextCursor;
  player.craftSlots = nextGrid;
  if (changed && typeof player.carryRevision === 'number') player.carryRevision += 1;
  return changed;
}

/** Session restore. The published revision stays at zero until a later runtime change. */
export function loadCarryState(player: CarryHolder, cursor: ItemStack | null): void {
  player.cursor = cloneStack(cursor);
  if (typeof player.carryRevision === 'number') player.carryRevision = 0;
}

export function clearCarryState(player: CarryHolder): void {
  replaceCarryState(player, null, player.craftSlots.map(() => null));
}
