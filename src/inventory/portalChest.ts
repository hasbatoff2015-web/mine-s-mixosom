import { BlockId } from '../blocks';
import type { ContainerKind } from '../../shared/protocol';
import { createItemStack } from './stack';
import type { ItemStack } from './types';

export const PORTAL_CHEST_SLOT_COUNT = 27;
export const PORTAL_CHEST_ITEM_ID = 'portal_chest';

export interface PortalChestInventory {
  slots: Array<ItemStack | null>;
}

export function emptyPortalChestSlots(): Array<ItemStack | null> {
  return Array.from({ length: PORTAL_CHEST_SLOT_COUNT }, () => null);
}

export function createPortalChestInventory(): PortalChestInventory {
  return { slots: emptyPortalChestSlots() };
}

export function normalizePortalChestSlots(raw: unknown): Array<ItemStack | null> {
  const slots = emptyPortalChestSlots();
  if (!Array.isArray(raw)) return slots;
  for (let index = 0; index < PORTAL_CHEST_SLOT_COUNT; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { itemId?: unknown; count?: unknown };
    if (typeof record.itemId !== 'string' || typeof record.count !== 'number') continue;
    try {
      slots[index] = createItemStack(record.itemId, record.count);
    } catch {
      slots[index] = null;
    }
  }
  return slots;
}

export function assignPortalChestSlots(target: PortalChestInventory, raw: unknown): void {
  target.slots = normalizePortalChestSlots(raw);
}

export function isChestWindowKind(kind: ContainerKind | undefined): boolean {
  return kind === 'chest' || kind === 'portal-chest';
}

export function isChestLikeBlock(block: BlockId): boolean {
  return block === BlockId.Chest || block === BlockId.PortalChest;
}
