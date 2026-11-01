import type { BlockRenderState } from '../blocks/types';
import { collectiblePaintingDropItemId, isCollectiblePaintingItemId } from '../items/collectiblePaintings';
import { ItemId } from '../items/types';
import type { Inventory } from './inventory';
import { createItemStack } from './stack';
import type { ItemMetadata, ItemStack } from './types';

/** Canonical field. One physical instance, not the catalog item id. */
export const ITEM_INSTANCE_METADATA_KEY = 'itemInstanceId';

const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Stage 3A tracks collectible paintings and the God Sword only.
 * maxStack 1 is not enough to qualify.
 */
export function requiresUniqueItemIdentity(itemId: string | undefined | null): boolean {
  return itemId === ItemId.GodSword || isCollectiblePaintingItemId(itemId ?? undefined);
}

export function isItemInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID.test(value);
}

export function readItemInstanceId(stack: { readonly metadata?: ItemMetadata } | null | undefined): string | undefined {
  const value = stack?.metadata?.[ITEM_INSTANCE_METADATA_KEY];
  return isItemInstanceId(value) ? value.toLowerCase() : undefined;
}

export function withItemInstanceId(stack: ItemStack, instanceId: string): ItemStack {
  return {
    ...stack,
    metadata: {
      ...stack.metadata,
      [ITEM_INSTANCE_METADATA_KEY]: instanceId.toLowerCase(),
    },
  };
}

/**
 * One fresh stack per physical instance. Ordinary items return undefined
 * so callers keep the existing bulk add path.
 */
export function createTrackedItemInstances(
  itemId: string,
  count: number,
  randomUUID: () => string,
): ItemStack[] | undefined {
  if (!requiresUniqueItemIdentity(itemId) || count < 1) return undefined;
  const stacks: ItemStack[] = [];
  for (let index = 0; index < count; index += 1) {
    stacks.push(withItemInstanceId(createItemStack(itemId, 1), randomUUID()));
  }
  return stacks;
}

/** Assigns an id only when this tracked stack does not already have one. */
export function ensureItemInstanceId(stack: ItemStack, randomUUID: () => string): ItemStack {
  if (!requiresUniqueItemIdentity(stack.itemId) || readItemInstanceId(stack)) return stack;
  return withItemInstanceId(stack, randomUUID());
}

export function ensureInventoryInstanceIds(inventory: Inventory, randomUUID: () => string): boolean {
  let changed = false;
  const visit = (stack: ItemStack | null, write: (next: ItemStack) => void): void => {
    if (!stack) return;
    const next = ensureItemInstanceId(stack, randomUUID);
    if (next === stack) return;
    write(next);
    changed = true;
  };
  for (let index = 0; index < inventory.slots.length; index += 1) {
    visit(inventory.getSlot(index), (next) => inventory.setSlot(index, next));
  }
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    visit(inventory.getSlot({ section: 'armor', slot }), (next) => inventory.setSlot({ section: 'armor', slot }, next));
  }
  visit(inventory.getSlot({ section: 'offhand' }), (next) => inventory.setSlot({ section: 'offhand' }, next));
  return changed;
}

export function collectiblePaintingDroppedStack(
  block: number,
  state: Pick<BlockRenderState, 'paintingItemId' | 'paintingInstanceId'> | undefined,
): ItemStack | undefined {
  const itemId = collectiblePaintingDropItemId(block, state);
  if (!itemId) return undefined;
  const stack = createItemStack(itemId, 1);
  return isItemInstanceId(state?.paintingInstanceId)
    ? withItemInstanceId(stack, state.paintingInstanceId)
    : stack;
}
