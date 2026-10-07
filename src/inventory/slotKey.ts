import type { ArmorSlot } from '../items';
import { Inventory } from './inventory';
import type { InventorySlotRef } from './types';

/** Highest container index the UI can address. Live windows still check their own length. */
export const MAX_CONTAINER_SLOT_INDEX = 26;
export const MAX_CRAFT_SLOT_INDEX = 8;
export const MAX_CREATIVE_SLOT_INDEX = 512;

export type SlotKeyKind =
  | 'player'
  | 'craft'
  | 'result'
  | 'container'
  | 'furnace'
  | 'creative'
  | 'invalid';

/**
 * What a key is allowed to do.
 * `mutable` — real stack that can be a source or a destination.
 * `output` — real stack that can be taken (furnace result) but not inserted into.
 * `virtual` — crafted preview. Taking it is a separate click, never a free drop.
 * `creative` — catalog grant, not a stored stack.
 */
export type SlotCapability = 'mutable' | 'output' | 'virtual' | 'creative' | 'invalid';

export interface ParsedSlotKey {
  readonly raw: string;
  readonly kind: SlotKeyKind;
  readonly playerRef?: InventorySlotRef;
  readonly index?: number;
  readonly furnaceIndex?: 0 | 1 | 2;
}

const ARMOR: readonly ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

function integerIndex(raw: string, prefix: string, max: number): number | undefined {
  if (!raw.startsWith(prefix)) return undefined;
  const body = raw.slice(prefix.length);
  if (!/^\d+$/.test(body)) return undefined;
  const index = Number(body);
  if (!Number.isInteger(index) || index < 0 || index > max) return undefined;
  return index;
}

export function parseSlotKey(key: string | undefined | null): ParsedSlotKey {
  if (!key || key.length > 64) return { raw: key ?? '', kind: 'invalid' };
  if (key === 'result') return { raw: key, kind: 'result' };
  if (key === 'offhand') return { raw: key, kind: 'player', playerRef: { section: 'offhand' } };
  if (key.startsWith('armor-')) {
    const slot = key.slice('armor-'.length);
    if (slot === 'head' || slot === 'chest' || slot === 'legs' || slot === 'feet') {
      return { raw: key, kind: 'player', playerRef: { section: 'armor', slot } };
    }
    return { raw: key, kind: 'invalid' };
  }
  const inventoryIndex = integerIndex(key, 'inventory-', Inventory.SLOT_COUNT - 1);
  if (key.startsWith('inventory-')) {
    if (inventoryIndex === undefined) return { raw: key, kind: 'invalid' };
    return { raw: key, kind: 'player', playerRef: inventoryIndex, index: inventoryIndex };
  }
  const craftIndex = integerIndex(key, 'craft-', MAX_CRAFT_SLOT_INDEX);
  if (key.startsWith('craft-')) {
    if (craftIndex === undefined) return { raw: key, kind: 'invalid' };
    return { raw: key, kind: 'craft', index: craftIndex };
  }
  const containerIndex = integerIndex(key, 'container-', MAX_CONTAINER_SLOT_INDEX);
  if (key.startsWith('container-')) {
    if (containerIndex === undefined) return { raw: key, kind: 'invalid' };
    return { raw: key, kind: 'container', index: containerIndex };
  }
  if (key.startsWith('furnace-')) {
    const index = integerIndex(key, 'furnace-', 2);
    if (index !== 0 && index !== 1 && index !== 2) return { raw: key, kind: 'invalid' };
    return { raw: key, kind: 'furnace', furnaceIndex: index, index };
  }
  const creativeIndex = integerIndex(key, 'creative-', MAX_CREATIVE_SLOT_INDEX);
  if (key.startsWith('creative-')) {
    if (creativeIndex === undefined) return { raw: key, kind: 'invalid' };
    return { raw: key, kind: 'creative', index: creativeIndex };
  }
  return { raw: key, kind: 'invalid' };
}

export function slotCapability(parsed: ParsedSlotKey): SlotCapability {
  if (parsed.kind === 'player' || parsed.kind === 'craft' || parsed.kind === 'container') return 'mutable';
  if (parsed.kind === 'furnace') return parsed.furnaceIndex === 2 ? 'output' : 'mutable';
  if (parsed.kind === 'result') return 'virtual';
  if (parsed.kind === 'creative') return 'creative';
  return 'invalid';
}

/** Slots the amount dialog may split or partially drop. */
export function isPlayerAmountSlot(key: string): boolean {
  return parseSlotKey(key).kind === 'player';
}

/** Real stacks that may be dropped without minting a virtual result or catalog grant. */
export function isDroppableSlot(key: string): boolean {
  const capability = slotCapability(parseSlotKey(key));
  return capability === 'mutable' || capability === 'output';
}

/** Real stacks number keys and offhand swap may exchange. */
export function isMutableSwapSlot(key: string): boolean {
  return isDroppableSlot(key);
}

export function armorSlots(): readonly ArmorSlot[] {
  return ARMOR;
}
