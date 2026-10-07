import { getItemDefinition } from '../items';
import {
  furnaceAccepts,
  furnaceShiftRoute,
  shiftMoveStack,
} from '../ui/containerInteractions';
import { isChestWindowKind } from './portalChest';
import { Inventory } from './inventory';
import type { InventorySlotRef } from './types';
import type { InventoryUiResult, InventoryUiState } from './inventoryUiAction';
import { parseSlotKey, slotCapability, type ParsedSlotKey, type SlotCapability } from './slotKey';
import {
  canStacksMerge,
  cloneStack,
  mergeItemStacks,
  splitItemStack,
} from './stack';
import type { ItemStack } from './types';

export const STACK_SIGNATURE_MAX = 480;
export const MAX_DRAG_KEYS = 80;

const rejected = (): InventoryUiResult => ({ ok: false, dropped: [], reason: 'rejected' });
const accepted = (dropped: ItemStack[] = []): InventoryUiResult => ({ ok: true, dropped });

export function isManualDropAction(action: { readonly action: string }): boolean {
  return action.action === 'drop_selected'
    || action.action === 'drop_cursor'
    || action.action === 'drop_slot';
}

/** Identity of a stack the client saw when the gesture started. Not an authority to create items. */
export function itemStackSignature(stack: ItemStack | null): string {
  if (!stack) return '';
  const meta = stack.metadata === undefined ? '' : JSON.stringify(stack.metadata);
  const raw = `${stack.itemId}|${stack.count}|${stack.durability ?? ''}|${meta}`;
  return raw.length <= STACK_SIGNATURE_MAX ? raw : raw.slice(0, STACK_SIGNATURE_MAX);
}

function signatureOk(stack: ItemStack | null, expected: string | undefined): boolean {
  if (!expected) return true;
  return itemStackSignature(stack) === expected;
}

interface BoundSlot {
  readonly key: string;
  readonly capability: Extract<SlotCapability, 'mutable' | 'output'>;
  get(): ItemStack | null;
  set(stack: ItemStack | null): void;
  accepts(stack: ItemStack): boolean;
}

function bindSlot(state: InventoryUiState, key: string): BoundSlot | null {
  const parsed = parseSlotKey(key);
  const capability = slotCapability(parsed);
  if (capability !== 'mutable' && capability !== 'output') return null;
  if (parsed.kind === 'player' && parsed.playerRef !== undefined) {
    const ref = parsed.playerRef;
    return {
      key,
      capability,
      get: () => state.inventory.getSlot(ref),
      set: (stack) => state.inventory.setSlot(ref, stack),
      accepts: (stack) => state.inventory.accepts(ref, stack),
    };
  }
  if (parsed.kind === 'craft' && parsed.index !== undefined) {
    if (parsed.index >= state.craftSlots.length) return null;
    const index = parsed.index;
    return {
      key,
      capability,
      get: () => cloneStack(state.craftSlots[index] ?? null),
      set: (stack) => { state.craftSlots[index] = cloneStack(stack); },
      accepts: () => true,
    };
  }
  if (parsed.kind === 'container' && parsed.index !== undefined && state.chest) {
    if (parsed.index >= state.chest.slots.length) return null;
    const index = parsed.index;
    const chest = state.chest;
    return {
      key,
      capability,
      get: () => cloneStack(chest.slots[index] ?? null),
      set: (stack) => { chest.slots[index] = cloneStack(stack); },
      accepts: () => true,
    };
  }
  if (parsed.kind === 'furnace' && parsed.furnaceIndex !== undefined && state.furnace) {
    const index = parsed.furnaceIndex;
    const furnace = state.furnace;
    return {
      key,
      capability,
      get: () => cloneStack(furnace.slots[index]),
      set: (stack) => { furnace.slots[index] = cloneStack(stack); },
      accepts: (stack) => furnaceAccepts(index, stack),
    };
  }
  return null;
}

function slotsOnSide(state: InventoryUiState, parsed: ParsedSlotKey): readonly string[] {
  if (parsed.kind === 'player' && typeof parsed.playerRef === 'number') {
    return Array.from({ length: Inventory.SLOT_COUNT }, (_unused, index) => `inventory-${index}`);
  }
  if (parsed.kind === 'player') {
    return ['armor-head', 'armor-chest', 'armor-legs', 'armor-feet', 'offhand'];
  }
  if (parsed.kind === 'container' && state.chest) {
    return state.chest.slots.map((_slot, index) => `container-${index}`);
  }
  if (parsed.kind === 'furnace') return ['furnace-0', 'furnace-1', 'furnace-2'];
  if (parsed.kind === 'craft') {
    return state.craftSlots.map((_slot, index) => `craft-${index}`);
  }
  return [];
}

function quickMovePlayerToContainer(state: InventoryUiState, index: number): void {
  const container = state.chest;
  if (!container) return;
  const moving = state.inventory.getSlot(index);
  if (!moving) return;
  const moved = shiftMoveStack(moving, container.slots);
  container.slots.splice(0, container.slots.length, ...moved.targets);
  state.inventory.setSlot(index, moved.remainder);
}

function shiftPlayerToFurnace(state: InventoryUiState, index: number): void {
  const furnace = state.furnace;
  if (!furnace) return;
  const moving = state.inventory.getSlot(index);
  if (!moving) return;
  const route = furnaceShiftRoute(moving, 'inventory');
  if (route === 'inventory') {
    state.inventory.quickMove(index);
    return;
  }
  const slotIndex = route === 'input' ? 0 : 1;
  const result = shiftMoveStack(
    moving,
    [furnace.slots[slotIndex]],
    (_slot, stack) => furnaceAccepts(slotIndex, stack),
  );
  furnace.slots[slotIndex] = result.targets[0] ?? null;
  state.inventory.setSlot(index, result.remainder);
}

/** One Shift-click. Returns false when this key is not a quick-move source. */
export function shiftActivate(state: InventoryUiState, key: string): boolean {
  const parsed = parseSlotKey(key);
  if (parsed.kind === 'player' && typeof parsed.playerRef === 'number') {
    const index = parsed.playerRef;
    if (isChestWindowKind(state.window.kind) && state.chest) {
      quickMovePlayerToContainer(state, index);
      return true;
    }
    if (state.window.kind === 'furnace' && state.furnace) {
      shiftPlayerToFurnace(state, index);
      return true;
    }
    state.inventory.quickMove(index);
    return true;
  }
  if (parsed.kind === 'player' && parsed.playerRef) {
    state.inventory.quickMove(parsed.playerRef);
    return true;
  }
  if (parsed.kind === 'container' && parsed.index !== undefined && state.chest) {
    if (parsed.index >= state.chest.slots.length) return false;
    const stack = state.chest.slots[parsed.index] ?? null;
    if (stack) {
      const remainder = state.inventory.add(stack);
      state.chest.slots[parsed.index] = remainder;
    }
    return true;
  }
  if (parsed.kind === 'furnace' && parsed.furnaceIndex !== undefined && state.furnace) {
    const stack = state.furnace.slots[parsed.furnaceIndex];
    if (stack) {
      const remainder = state.inventory.add(stack);
      state.furnace.slots[parsed.furnaceIndex] = remainder;
    }
    return true;
  }
  if (parsed.kind === 'craft' && parsed.index !== undefined) {
    if (parsed.index >= state.craftSlots.length) return false;
    const stack = state.craftSlots[parsed.index] ?? null;
    if (stack) {
      const remainder = state.inventory.add(stack);
      state.craftSlots[parsed.index] = remainder;
    }
    return true;
  }
  return false;
}

export function dropCursorAmount(state: InventoryUiState, count: number | undefined, all: boolean): InventoryUiResult {
  const cursor = state.cursor;
  if (!cursor) return rejected();
  const requested = all || count === undefined ? cursor.count : count;
  if (!Number.isInteger(requested) || requested < 1) return rejected();
  const take = Math.min(cursor.count, requested);
  const split = splitItemStack(cursor, take);
  state.cursor = split.remainder;
  return accepted([split.taken]);
}

export function dropFromSlot(
  state: InventoryUiState,
  key: string,
  count: number | undefined,
  all: boolean,
  signature?: string,
): InventoryUiResult {
  const slot = bindSlot(state, key);
  if (!slot) return rejected();
  const stack = slot.get();
  if (!stack || !signatureOk(stack, signature)) return rejected();
  const requested = all ? stack.count : (count ?? 1);
  if (!Number.isInteger(requested) || requested < 1) return rejected();
  const take = Math.min(stack.count, requested);
  const split = splitItemStack(stack, take);
  slot.set(split.remainder);
  return accepted([split.taken]);
}

export function moveStack(
  state: InventoryUiState,
  sourceKey: string,
  targetKey: string,
  signature?: string,
): InventoryUiResult {
  if (sourceKey === targetKey) return accepted();
  const source = bindSlot(state, sourceKey);
  const target = bindSlot(state, targetKey);
  if (!source || !target || target.capability !== 'mutable') return rejected();
  const from = source.get();
  if (!from || !signatureOk(from, signature)) return rejected();
  const to = target.get();
  if (!to) {
    if (!target.accepts(from)) return rejected();
    target.set(from);
    source.set(null);
    return accepted();
  }
  if (canStacksMerge(from, to)) {
    const merged = mergeItemStacks(to, from);
    target.set(merged.target);
    source.set(merged.remainder);
    return accepted();
  }
  if (source.capability === 'output') return rejected();
  if (!target.accepts(from) || !source.accepts(to)) return rejected();
  source.set(to);
  target.set(from);
  return accepted();
}

/**
 * Empty regular slot for a split.
 * Main inventory is preferred, then the hotbar. The source cell is skipped.
 * Matching stacks are not reused — a split must stay two stacks.
 */
export function splitDestinationIndex(inventory: Inventory, source: InventorySlotRef): number | undefined {
  const exclude = typeof source === 'number' ? source : undefined;
  const scan = (start: number, end: number): number | undefined => {
    for (let index = start; index < end; index += 1) {
      if (index === exclude) continue;
      if (inventory.getSlot(index) === null) return index;
    }
    return undefined;
  };
  return scan(Inventory.HOTBAR_SIZE, Inventory.SLOT_COUNT) ?? scan(0, Inventory.HOTBAR_SIZE);
}

export function splitStack(
  state: InventoryUiState,
  key: string,
  count: number,
  signature?: string,
): InventoryUiResult {
  const parsed = parseSlotKey(key);
  if (parsed.kind !== 'player' || parsed.playerRef === undefined) return rejected();
  const source = bindSlot(state, key);
  if (!source) return rejected();
  const stack = source.get();
  if (!stack || !signatureOk(stack, signature)) return rejected();
  if (!Number.isInteger(count) || count < 1 || count >= stack.count) return rejected();
  const destination = splitDestinationIndex(state.inventory, parsed.playerRef);
  if (destination === undefined) return { ok: false, dropped: [], reason: 'no-slot' };
  const copy = cloneStack(stack);
  if (!copy) return rejected();
  source.set({ ...copy, count: stack.count - count });
  state.inventory.setSlot(destination, { ...copy, count });
  return accepted();
}

export function hotbarSwap(
  state: InventoryUiState,
  key: string,
  slot: number,
  signature?: string,
): InventoryUiResult {
  if (!Number.isInteger(slot) || slot < 0 || slot > 8) return rejected();
  const parsed = parseSlotKey(key);
  if (parsed.kind === 'player' && parsed.index === slot) return accepted();
  const source = bindSlot(state, key);
  const hotbar = bindSlot(state, `inventory-${slot}`);
  if (!source || !hotbar) return rejected();
  const from = source.get();
  const to = hotbar.get();
  if (!signatureOk(from, signature)) return rejected();
  if (!from && !to) return accepted();
  if (to && (source.capability === 'output' || !source.accepts(to))) return rejected();
  if (from && !hotbar.accepts(from)) return rejected();
  source.set(to);
  hotbar.set(from);
  return accepted();
}

export function offhandSwap(state: InventoryUiState, key: string, signature?: string): InventoryUiResult {
  if (key === 'offhand') return accepted();
  const source = bindSlot(state, key);
  const offhand = bindSlot(state, 'offhand');
  if (!source || !offhand) return rejected();
  const from = source.get();
  const to = offhand.get();
  if (!signatureOk(from, signature)) return rejected();
  if (!from && !to) return accepted();
  if (to && (source.capability === 'output' || !source.accepts(to))) return rejected();
  if (from && !offhand.accepts(from)) return rejected();
  source.set(to);
  offhand.set(from);
  return accepted();
}

function collectSlots(state: InventoryUiState): BoundSlot[] {
  const keys = [
    ...Array.from({ length: Inventory.SLOT_COUNT }, (_unused, index) => `inventory-${index}`),
    'armor-head', 'armor-chest', 'armor-legs', 'armor-feet', 'offhand',
    ...(state.chest ? state.chest.slots.map((_slot, index) => `container-${index}`) : []),
    ...(state.furnace ? ['furnace-0', 'furnace-1', 'furnace-2'] : []),
    ...state.craftSlots.map((_slot, index) => `craft-${index}`),
  ];
  const bound: BoundSlot[] = [];
  for (const key of keys) {
    const slot = bindSlot(state, key);
    if (slot) bound.push(slot);
  }
  return bound;
}

export function collectMatching(state: InventoryUiState): InventoryUiResult {
  const cursor = state.cursor;
  if (!cursor) return rejected();
  const max = getItemDefinition(cursor.itemId).maxStack;
  let next = cloneStack(cursor);
  if (!next) return rejected();
  for (const slot of collectSlots(state)) {
    if (next.count >= max) break;
    const stack = slot.get();
    if (!stack || !canStacksMerge(stack, next)) continue;
    const take = Math.min(max - next.count, stack.count);
    slot.set(take >= stack.count ? null : { ...stack, count: stack.count - take });
    next = { ...next, count: next.count + take };
  }
  state.cursor = next;
  return accepted();
}

function slotCanReceive(slot: BoundSlot, cursor: ItemStack): boolean {
  if (slot.capability !== 'mutable') return false;
  const current = slot.get();
  if (!current) return slot.accepts(cursor);
  if (!canStacksMerge(current, cursor)) return false;
  return current.count < getItemDefinition(cursor.itemId).maxStack;
}

function uniqueReceivers(state: InventoryUiState, keys: readonly string[], cursor: ItemStack): BoundSlot[] {
  const seen = new Set<string>();
  const slots: BoundSlot[] = [];
  const limited = keys.slice(0, MAX_DRAG_KEYS);
  for (const key of limited) {
    if (seen.has(key)) continue;
    seen.add(key);
    const slot = bindSlot(state, key);
    if (!slot || !slotCanReceive(slot, cursor)) continue;
    slots.push(slot);
  }
  return slots;
}

export function dragDistribute(
  state: InventoryUiState,
  button: 'left' | 'right',
  keys: readonly string[],
): InventoryUiResult {
  const cursor = state.cursor ? cloneStack(state.cursor) : null;
  if (!cursor) return rejected();
  const slots = uniqueReceivers(state, keys, cursor);
  if (button === 'right') {
    let remaining: ItemStack | null = cursor;
    for (const slot of slots) {
      if (!remaining) break;
      const current = slot.get();
      if (current) slot.set({ ...current, count: current.count + 1 });
      else slot.set({ ...remaining, count: 1 });
      remaining = remaining.count === 1 ? null : { ...remaining, count: remaining.count - 1 };
    }
    state.cursor = remaining;
    return accepted();
  }

  const placed = new Map<BoundSlot, number>();
  const room = (slot: BoundSlot): number => {
    const current = slot.get();
    const extra = placed.get(slot) ?? 0;
    const max = getItemDefinition(cursor.itemId).maxStack;
    if (!current) return max - extra;
    if (!canStacksMerge(current, cursor)) return 0;
    return max - current.count - extra;
  };
  let remaining = cursor.count;
  let open = slots.filter((slot) => room(slot) > 0);
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    if (share < 1) break;
    let gave = 0;
    for (const slot of open) {
      const give = Math.min(share, room(slot));
      if (give < 1) continue;
      placed.set(slot, (placed.get(slot) ?? 0) + give);
      remaining -= give;
      gave += give;
    }
    if (gave === 0) break;
    open = open.filter((slot) => room(slot) > 0);
  }
  for (const [slot, count] of placed) {
    const current = slot.get();
    if (!current) slot.set({ ...cursor, count });
    else slot.set({ ...current, count: current.count + count });
  }
  state.cursor = remaining <= 0 ? null : { ...cursor, count: remaining };
  return accepted();
}

export function quickMoveMatching(state: InventoryUiState, key: string): InventoryUiResult {
  const origin = bindSlot(state, key);
  const parsed = parseSlotKey(key);
  if (!origin || parsed.kind === 'invalid' || parsed.kind === 'result' || parsed.kind === 'creative') {
    return rejected();
  }
  const sample = origin.get();
  if (!sample) return rejected();
  const keys = slotsOnSide(state, parsed);
  const ordered = [
    ...keys.filter((candidate) => candidate === key),
    ...keys.filter((candidate) => candidate !== key),
  ];
  for (const candidate of ordered) {
    const slot = bindSlot(state, candidate);
    const current = slot?.get();
    if (!current || !canStacksMerge(current, sample)) continue;
    shiftActivate(state, candidate);
  }
  return accepted();
}
