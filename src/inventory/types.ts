import type { ArmorSlot, ItemId } from '../items';

export type ItemMetadataPrimitive = string | number | boolean | null;
export type ItemMetadataValue =
  | ItemMetadataPrimitive
  | readonly ItemMetadataValue[]
  | { readonly [key: string]: ItemMetadataValue };
export type ItemMetadata = Readonly<Record<string, ItemMetadataValue>>;

export interface ItemStack {
  readonly itemId: ItemId;
  readonly count: number;
  /** Remaining durability. Omitted means a pristine item. */
  readonly durability?: number;
  readonly metadata?: ItemMetadata;
}

export type InventorySlotRef =
  | number
  | { readonly section: 'armor'; readonly slot: ArmorSlot }
  | { readonly section: 'offhand' };

export type InventoryClickButton = 'left' | 'right';

export interface SlotClickResult {
  readonly slot: ItemStack | null;
  readonly cursor: ItemStack | null;
}

export interface SerializedInventory {
  readonly version: 1;
  readonly slots: readonly (ItemStack | null)[];
  readonly armor: Readonly<Record<ArmorSlot, ItemStack | null>>;
  readonly offhand: ItemStack | null;
}
