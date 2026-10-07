import { craftOnceByRecipeId, matchCraftingRecipe } from '../crafting';
import { Inventory } from './inventory';
import { applySlotClick, createItemStack } from './stack';
import type { ItemStack } from './types';
import { creativeCatalogItems } from '../items';
import type { GameMode } from '../save/types';
import {
  clickFurnaceSlot,
  placeCraftingRecipe,
  takeCraftOutput,
} from '../ui/containerInteractions';
import { allCraftingBookEntries } from '../ui/recipeBook';
import type { ChestState, FurnaceState } from '../world/World';
import type { ClientInventoryActionMessage, ContainerKind } from '../../shared/protocol';
import {
  collectMatching,
  dragDistribute,
  dropCursorAmount,
  dropFromSlot,
  hotbarSwap,
  isManualDropAction,
  moveStack,
  offhandSwap,
  quickMoveMatching,
  shiftActivate,
  splitStack,
} from './inventoryActions';

export { isManualDropAction };

export interface InventoryWindow {
  kind: ContainerKind;
  x?: number;
  y?: number;
  z?: number;
}

export function isSharedContainerWindow(window: InventoryWindow): boolean {
  return (window.kind === 'chest' || window.kind === 'furnace')
    && window.x !== undefined
    && window.y !== undefined
    && window.z !== undefined;
}

export function sameSharedContainerWindow(a: InventoryWindow, b: InventoryWindow): boolean {
  return isSharedContainerWindow(a)
    && a.kind === b.kind
    && a.x === b.x
    && a.y === b.y
    && a.z === b.z;
}

export interface InventoryUiState {
  inventory: Inventory;
  cursor: ItemStack | null;
  craftSlots: Array<ItemStack | null>;
  window: InventoryWindow;
  gamemode: GameMode;
  chest?: ChestState;
  furnace?: FurnaceState;
}

export interface InventoryUiResult {
  readonly ok: boolean;
  readonly dropped: ItemStack[];
  readonly crafted?: { readonly itemId: string; readonly count: number; readonly recipeId?: string };
  readonly windowChanged?: boolean;
  /** `no-slot` is the split failure the amount dialog explains. */
  readonly reason?: 'no-slot' | 'rejected';
}

function emptyResult(ok: boolean): InventoryUiResult {
  return { ok, dropped: [] };
}

/** One Creative catalog sequence for rendering and for catalog clicks. */
export function creativeCatalogGrant(index: number, button: 'left' | 'right'): ItemStack | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const definition = creativeCatalogItems()[index];
  if (!definition) return null;
  return createItemStack(definition.id, button === 'right' ? 1 : definition.maxStack);
}

export function gridSizeFor(kind: ContainerKind): 2 | 3 {
  return kind === 'crafting-table' ? 3 : 2;
}

export function ensureCraftSlots(state: InventoryUiState): void {
  const size = gridSizeFor(state.window.kind) ** 2;
  if (state.craftSlots.length === size) return;
  state.craftSlots = Array.from({ length: size }, (_, index) => state.craftSlots[index] ?? null);
}

export function returnWindowItems(state: InventoryUiState): ItemStack[] {
  const dropped: ItemStack[] = [];
  const giveBack = (stack: ItemStack | null): void => {
    if (!stack) return;
    const remainder = state.inventory.add(stack);
    if (remainder) dropped.push(remainder);
  };
  for (const stack of state.craftSlots) giveBack(stack);
  giveBack(state.cursor);
  state.craftSlots = Array.from({ length: gridSizeFor(state.window.kind) ** 2 }, () => null);
  state.cursor = null;
  return dropped;
}

export function applyInventoryUiAction(
  state: InventoryUiState,
  action: ClientInventoryActionMessage,
): InventoryUiResult {
  ensureCraftSlots(state);
  switch (action.action) {
    case 'select': {
      if (action.slot === undefined || action.slot < 0 || action.slot > 8) return emptyResult(false);
      return emptyResult(true);
    }
    case 'open': {
      const kind = action.kind ?? 'inventory';
      const dropped = returnWindowItems(state);
      state.window = { kind, x: action.x, y: action.y, z: action.z };
      state.craftSlots = Array.from({ length: gridSizeFor(kind) ** 2 }, () => null);
      return { ok: true, dropped, windowChanged: true };
    }
    case 'close': {
      const dropped = returnWindowItems(state);
      state.window = { kind: 'inventory' };
      return { ok: true, dropped, windowChanged: true };
    }
    case 'drop_cursor':
      return dropCursorAmount(state, action.count, action.all === true);
    case 'drop_selected': {
      const slot = action.slot ?? 0;
      const stack = state.inventory.getSlot(slot);
      if (!stack) return emptyResult(false);
      const take = Math.min(action.count ?? 1, stack.count);
      const leftover = stack.count - take;
      state.inventory.setSlot(slot, leftover <= 0 ? null : { ...stack, count: leftover });
      return { ok: true, dropped: [{ ...stack, count: take }] };
    }
    case 'drop_slot':
      return dropFromSlot(state, action.key ?? '', action.count, action.all === true, action.signature);
    case 'move_stack':
      return moveStack(state, action.sourceKey ?? '', action.targetKey ?? '', action.signature);
    case 'split_stack':
      return splitStack(state, action.key ?? '', action.count ?? 0, action.signature);
    case 'hotbar_swap':
      return hotbarSwap(state, action.key ?? '', action.slot ?? -1, action.signature);
    case 'offhand_swap':
      return offhandSwap(state, action.key ?? '', action.signature);
    case 'collect_matching':
      return collectMatching(state);
    case 'drag_distribute':
      return dragDistribute(state, action.button === 'right' ? 'right' : 'left', action.keys ?? []);
    case 'quick_move_matching':
      return quickMoveMatching(state, action.key ?? '');
    case 'recipe':
      return applyRecipe(state, action);
    case 'craft_recipe':
      return applyCraftRecipe(state, action);
    case 'click':
      return applyClick(state, action);
    default:
      return emptyResult(false);
  }
}

function applyCraftRecipe(state: InventoryUiState, action: ClientInventoryActionMessage): InventoryUiResult {
  if (!action.recipeId) return emptyResult(false);
  const crafted = craftOnceByRecipeId(state.inventory, action.recipeId);
  if (!crafted.ok) return emptyResult(false);
  /* Client may only send recipeId. Count, result, and inventory are ignored. */
  return {
    ok: true,
    dropped: [],
    crafted: {
      itemId: crafted.output.item,
      count: crafted.output.count,
      recipeId: crafted.recipeId,
    },
  };
}

function applyRecipe(state: InventoryUiState, action: ClientInventoryActionMessage): InventoryUiResult {
  if (!action.recipeId) return emptyResult(false);
  const size = gridSizeFor(state.window.kind);
  const entry = allCraftingBookEntries().find((candidate) => (
    (candidate.id === action.recipeId || candidate.resultId === action.recipeId)
    && (candidate.gridSize ?? 3) <= size
  ));
  if (!entry?.recipe) return emptyResult(false);
  const placed = placeCraftingRecipe(
    entry.recipe,
    state.craftSlots,
    state.inventory,
    size,
    action.shift ? 64 : 1,
  );
  if (placed.aborted) return emptyResult(false);
  state.craftSlots = placed.grid;
  return emptyResult(true);
}

function applyClick(state: InventoryUiState, action: ClientInventoryActionMessage): InventoryUiResult {
  const key = action.key;
  if (!key) return emptyResult(false);
  const button = action.button === 'right' ? 'right' : 'left';
  const shift = action.shift === true;

  if (shift && !key.startsWith('creative-') && key !== 'result') {
    if (shiftActivate(state, key)) return emptyResult(true);
  }

  if (key.startsWith('inventory-')) {
    const index = Number(key.slice('inventory-'.length));
    if (!Number.isInteger(index) || index < 0 || index >= Inventory.SLOT_COUNT) return emptyResult(false);
    state.cursor = state.inventory.clickSlot(index, state.cursor, button);
    return emptyResult(true);
  }

  if (key.startsWith('armor-')) {
    const slot = key.slice('armor-'.length);
    if (slot !== 'head' && slot !== 'chest' && slot !== 'legs' && slot !== 'feet') return emptyResult(false);
    state.cursor = state.inventory.clickSlot({ section: 'armor', slot }, state.cursor, button);
    return emptyResult(true);
  }

  if (key === 'offhand') {
    state.cursor = state.inventory.clickSlot({ section: 'offhand' }, state.cursor, button);
    return emptyResult(true);
  }

  if (key.startsWith('craft-')) {
    const index = Number(key.slice('craft-'.length));
    if (!Number.isInteger(index) || index < 0 || index >= state.craftSlots.length) return emptyResult(false);
    const result = applySlotClick(state.craftSlots[index] ?? null, state.cursor, button);
    state.craftSlots[index] = result.slot;
    state.cursor = result.cursor;
    return emptyResult(true);
  }

  if (key === 'result') {
    const size = gridSizeFor(state.window.kind);
    const before = matchCraftingRecipe(state.craftSlots, size, size);
    const taken = takeCraftOutput(state.craftSlots, state.cursor, size, shift, state.inventory);
    state.craftSlots = taken.grid;
    state.cursor = taken.cursor;
    if (before) {
      return {
        ok: true,
        dropped: [],
        crafted: {
          itemId: before.output.itemId,
          count: before.output.count,
          recipeId: before.recipe.id,
        },
      };
    }
    return emptyResult(true);
  }

  if (key.startsWith('container-')) {
    if (!state.chest) return emptyResult(false);
    const index = Number(key.slice('container-'.length));
    if (!Number.isInteger(index) || index < 0 || index >= state.chest.slots.length) return emptyResult(false);
    const stack = state.chest.slots[index] ?? null;
    const result = applySlotClick(stack, state.cursor, button);
    state.chest.slots[index] = result.slot;
    state.cursor = result.cursor;
    return emptyResult(true);
  }

  if (key.startsWith('furnace-')) {
    if (!state.furnace) return emptyResult(false);
    const index = Number(key.slice('furnace-'.length));
    if (index !== 0 && index !== 1 && index !== 2) return emptyResult(false);
    const clicked = clickFurnaceSlot(state.furnace.slots, index as 0 | 1 | 2, state.cursor, button);
    state.furnace.slots = clicked.slots;
    state.cursor = clicked.cursor;
    return emptyResult(true);
  }

  if (key.startsWith('creative-')) {
    if (state.gamemode !== 'creative') return emptyResult(false);
    const granted = creativeCatalogGrant(Number(key.slice('creative-'.length)), button);
    if (!granted) return emptyResult(false);
    state.cursor = granted;
    return emptyResult(true);
  }

  return emptyResult(false);
}

