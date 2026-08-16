import { getItemDefinition, type ItemDefinition } from '../items';
import type { ItemMetadata, ItemMetadataValue, ItemStack, SlotClickResult } from './types';

function cloneMetadataValue(value: ItemMetadataValue): ItemMetadataValue {
  if (Array.isArray(value)) return value.map(cloneMetadataValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneMetadataValue(entry)]),
    );
  }
  return value as string | number | boolean | null;
}

export function cloneStack(stack: ItemStack | null): ItemStack | null {
  if (stack === null) return null;
  return {
    itemId: stack.itemId,
    count: stack.count,
    ...(stack.durability === undefined ? {} : { durability: stack.durability }),
    ...(stack.metadata === undefined
      ? {}
      : { metadata: cloneMetadataValue(stack.metadata) as ItemMetadata }),
  };
}

function definitionDurability(definition: ItemDefinition): number | undefined {
  return 'durability' in definition ? definition.durability : undefined;
}

function validateMetadataValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Item metadata number at ${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateMetadataValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) validateMetadataValue(entry, `${path}.${key}`);
    return;
  }
  throw new TypeError(`Item metadata at ${path} is not JSON-safe`);
}

export function validateItemStack(stack: ItemStack): void {
  const definition = getItemDefinition(stack.itemId);
  if (!Number.isInteger(stack.count) || stack.count < 1 || stack.count > definition.maxStack) {
    throw new RangeError(
      `Invalid count ${stack.count} for ${stack.itemId}; expected 1..${definition.maxStack}`,
    );
  }

  const maxDurability = definitionDurability(definition);
  if (stack.durability !== undefined) {
    if (maxDurability === undefined) {
      throw new TypeError(`${stack.itemId} does not support durability`);
    }
    if (!Number.isInteger(stack.durability) || stack.durability < 1 || stack.durability > maxDurability) {
      throw new RangeError(
        `Invalid durability ${stack.durability} for ${stack.itemId}; expected 1..${maxDurability}`,
      );
    }
  }
  if (stack.metadata !== undefined) validateMetadataValue(stack.metadata, 'metadata');
}

export function createItemStack(
  itemId: string,
  count = 1,
  options: { readonly durability?: number; readonly metadata?: ItemMetadata } = {},
): ItemStack {
  const stack: ItemStack = {
    itemId,
    count,
    ...(options.durability === undefined ? {} : { durability: options.durability }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
  validateItemStack(stack);
  return cloneStack(stack) as ItemStack;
}

function metadataEqual(a: ItemMetadataValue | undefined, b: ItemMetadataValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => metadataEqual(value, b[index]));
  }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const aEntries = Object.entries(a);
    const bRecord = b as Readonly<Record<string, ItemMetadataValue>>;
    if (aEntries.length !== Object.keys(bRecord).length) return false;
    return aEntries.every(([key, value]) => metadataEqual(value, bRecord[key]));
  }
  return false;
}

export function canStacksMerge(a: ItemStack, b: ItemStack): boolean {
  return a.itemId === b.itemId
    && a.durability === b.durability
    && metadataEqual(a.metadata, b.metadata);
}

export function splitItemStack(stack: ItemStack, amount = Math.ceil(stack.count / 2)): {
  readonly taken: ItemStack;
  readonly remainder: ItemStack | null;
} {
  validateItemStack(stack);
  if (!Number.isInteger(amount) || amount < 1 || amount > stack.count) {
    throw new RangeError(`Split amount must be between 1 and ${stack.count}`);
  }
  const taken = { ...cloneStack(stack) as ItemStack, count: amount };
  const remainderCount = stack.count - amount;
  return {
    taken,
    remainder: remainderCount === 0
      ? null
      : { ...cloneStack(stack) as ItemStack, count: remainderCount },
  };
}

export function mergeItemStacks(target: ItemStack, incoming: ItemStack): {
  readonly target: ItemStack;
  readonly remainder: ItemStack | null;
} {
  validateItemStack(target);
  validateItemStack(incoming);
  if (!canStacksMerge(target, incoming)) {
    return { target: cloneStack(target) as ItemStack, remainder: cloneStack(incoming) };
  }

  const maxStack = getItemDefinition(target.itemId).maxStack;
  const moved = Math.min(maxStack - target.count, incoming.count);
  const remainderCount = incoming.count - moved;
  return {
    target: { ...cloneStack(target) as ItemStack, count: target.count + moved },
    remainder: remainderCount === 0
      ? null
      : { ...cloneStack(incoming) as ItemStack, count: remainderCount },
  };
}

export function applySlotClick(
  slot: ItemStack | null,
  cursor: ItemStack | null,
  button: 'left' | 'right',
  accepts: (stack: ItemStack) => boolean = () => true,
): SlotClickResult {
  if (slot !== null) validateItemStack(slot);
  if (cursor !== null) validateItemStack(cursor);

  if (button === 'left') {
    if (cursor === null) return { slot: null, cursor: cloneStack(slot) };
    if (slot === null) {
      if (!accepts(cursor)) return { slot: null, cursor: cloneStack(cursor) };
      return { slot: cloneStack(cursor), cursor: null };
    }
    if (canStacksMerge(slot, cursor)) {
      const merged = mergeItemStacks(slot, cursor);
      return { slot: merged.target, cursor: merged.remainder };
    }
    if (!accepts(cursor)) return { slot: cloneStack(slot), cursor: cloneStack(cursor) };
    return { slot: cloneStack(cursor), cursor: cloneStack(slot) };
  }

  if (cursor === null) {
    if (slot === null) return { slot: null, cursor: null };
    const split = splitItemStack(slot);
    return { slot: split.remainder, cursor: split.taken };
  }
  if (slot === null) {
    if (!accepts(cursor)) return { slot: null, cursor: cloneStack(cursor) };
    const split = splitItemStack(cursor, 1);
    return { slot: split.taken, cursor: split.remainder };
  }
  if (!canStacksMerge(slot, cursor)) {
    return { slot: cloneStack(slot), cursor: cloneStack(cursor) };
  }

  const maxStack = getItemDefinition(slot.itemId).maxStack;
  if (slot.count >= maxStack) return { slot: cloneStack(slot), cursor: cloneStack(cursor) };
  return {
    slot: { ...cloneStack(slot) as ItemStack, count: slot.count + 1 },
    cursor: cursor.count === 1
      ? null
      : { ...cloneStack(cursor) as ItemStack, count: cursor.count - 1 },
  };
}

export function damageItem(stack: ItemStack, amount = 1): ItemStack | null {
  validateItemStack(stack);
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Damage must be a non-negative integer');
  const definition = getItemDefinition(stack.itemId);
  const maximum = definitionDurability(definition);
  if (maximum === undefined) throw new TypeError(`${stack.itemId} does not support durability`);
  const remaining = (stack.durability ?? maximum) - amount;
  return remaining <= 0
    ? null
    : { ...cloneStack(stack) as ItemStack, durability: remaining };
}
