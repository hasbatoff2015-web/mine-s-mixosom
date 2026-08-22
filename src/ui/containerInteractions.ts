import {
  applySlotClick,
  canStacksMerge,
  cloneStack,
  createItemStack,
  mergeItemStacks,
  type ItemStack,
} from '../inventory';
import type { Inventory } from '../inventory';
import { getItemDefinition } from '../items';
import {
  consumeCraftingGrid,
  matchCraftingRecipe,
  type Recipe,
  type SmeltingRecipe,
} from '../crafting';
import {
  craftingNeedCounts,
  ingredientItemIds,
  inventoryItemCounts,
  isFuelItem,
  isSmeltableItem,
  pickIngredientItem,
} from './recipeBook';

export type ContainerKind = 'inventory' | 'crafting-table' | 'chest' | 'furnace';

export interface GhostCraftState {
  readonly recipeId: string;
  readonly cells: readonly (ItemStack | null)[];
  readonly missing: readonly boolean[];
}

export function returnStacksToInventory(
  inventory: Inventory,
  stacks: readonly (ItemStack | null)[],
): { readonly returned: boolean; readonly remainder: ItemStack | null } {
  const snapshot = inventory.serialize();
  for (const stack of stacks) {
    if (!stack) continue;
    const leftover = inventory.add(stack);
    if (leftover) {
      inventory.restore(snapshot);
      return { returned: false, remainder: leftover };
    }
  }
  return { returned: true, remainder: null };
}

function cloneRequired(stack: ItemStack): ItemStack {
  return cloneStack(stack)!;
}

export function craftingTemplate(
  recipe: Recipe,
  gridSize: 2 | 3,
  counts: ReadonlyMap<string, number>,
): Array<ItemStack | null> {
  const cells: Array<ItemStack | null> = Array.from({ length: gridSize * gridSize }, () => null);
  if (recipe.type === 'shapeless') {
    recipe.ingredients.forEach((ingredient, index) => {
      if (index >= cells.length) return;
      cells[index] = createItemStack(pickIngredientItem(ingredient, counts), 1);
    });
    return cells;
  }
  const height = recipe.pattern.length;
  const width = Math.max(...recipe.pattern.map((row) => row.length));
  if (width > gridSize || height > gridSize) return cells;
  for (let y = 0; y < height; y += 1) {
    const row = recipe.pattern[y] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      const char = row[x] ?? ' ';
      if (char === ' ') continue;
      const ingredient = recipe.key[char];
      if (!ingredient) continue;
      cells[y * gridSize + x] = createItemStack(pickIngredientItem(ingredient, counts), 1);
    }
  }
  return cells;
}

export function maxRecipeFill(recipe: Recipe, counts: ReadonlyMap<string, number>): number {
  const needs = craftingNeedCounts(recipe, counts);
  let max = Number.POSITIVE_INFINITY;
  for (const [itemId, need] of needs) {
    if (need <= 0) continue;
    max = Math.min(max, Math.floor((counts.get(itemId) ?? 0) / need));
  }
  if (!Number.isFinite(max) || max < 1) return 0;
  return Math.min(max, 64);
}

export function ghostFromRecipe(recipe: Recipe, gridSize: 2 | 3, counts: ReadonlyMap<string, number>): GhostCraftState {
  const cells = craftingTemplate(recipe, gridSize, counts);
  const missing = cells.map((stack) => {
    if (!stack) return false;
    return (counts.get(stack.itemId) ?? 0) < 1;
  });
  return { recipeId: recipe.id, cells, missing };
}

export function placeCraftingRecipe(
  recipe: Recipe,
  grid: Array<ItemStack | null>,
  inventory: Inventory,
  gridSize: 2 | 3,
  multiplier: number,
): { readonly placed: boolean; readonly grid: Array<ItemStack | null>; readonly ghost?: GhostCraftState } {
  const snapshot = inventory.serialize();
  const previousGrid = grid.map((stack) => cloneStack(stack));
  const returned = returnStacksToInventory(inventory, previousGrid);
  if (!returned.returned) {
    inventory.restore(snapshot);
    return { placed: false, grid: previousGrid };
  }
  const counts = inventoryItemCounts(inventory);
  const fill = Math.max(1, Math.min(multiplier, maxRecipeFill(recipe, counts)));
  if (fill < 1 || maxRecipeFill(recipe, counts) < 1) {
    inventory.restore(snapshot);
    for (let index = 0; index < grid.length; index += 1) grid[index] = previousGrid[index] ?? null;
    return { placed: false, grid: previousGrid, ghost: ghostFromRecipe(recipe, gridSize, inventoryItemCounts(inventory)) };
  }
  const template = craftingTemplate(recipe, gridSize, counts);
  const next: Array<ItemStack | null> = Array.from({ length: gridSize * gridSize }, () => null);
  for (let index = 0; index < template.length; index += 1) {
    const cell = template[index];
    if (!cell) continue;
    const want = Math.min(getItemDefinition(cell.itemId).maxStack, fill);
    const removed = inventory.remove(cell.itemId, want);
    if (removed <= 0) {
      inventory.restore(snapshot);
      return { placed: false, grid: previousGrid, ghost: ghostFromRecipe(recipe, gridSize, inventoryItemCounts(inventory)) };
    }
    next[index] = createItemStack(cell.itemId, removed);
  }
  return { placed: true, grid: next };
}

export function takeCraftOutput(
  grid: Array<ItemStack | null>,
  cursor: ItemStack | null,
  gridSize: 2 | 3,
  shift: boolean,
  inventory: Inventory,
): { grid: Array<ItemStack | null>; cursor: ItemStack | null } {
  let nextGrid = grid;
  let nextCursor = cursor;
  const match = matchCraftingRecipe(nextGrid, gridSize, gridSize);
  if (!match) return { grid: nextGrid, cursor: nextCursor };
  if (shift) {
    while (true) {
      const current = matchCraftingRecipe(nextGrid, gridSize, gridSize);
      if (!current) break;
      const remainder = inventory.add(cloneRequired(current.output));
      if (remainder) {
        if (remainder.count === current.output.count) break;
        nextCursor = nextCursor === null ? remainder : nextCursor;
        nextGrid = [...consumeCraftingGrid(nextGrid, current)];
        break;
      }
      nextGrid = [...consumeCraftingGrid(nextGrid, current)];
    }
    return { grid: nextGrid, cursor: nextCursor };
  }
  if (nextCursor === null) nextCursor = cloneStack(match.output);
  else {
    if (!canStacksMerge(nextCursor, match.output)) return { grid: nextGrid, cursor: nextCursor };
    const merged = mergeItemStacks(nextCursor, match.output);
    if (merged.remainder) return { grid: nextGrid, cursor: nextCursor };
    nextCursor = merged.target;
  }
  nextGrid = [...consumeCraftingGrid(nextGrid, match)];
  return { grid: nextGrid, cursor: nextCursor };
}

export function furnaceAccepts(slot: 0 | 1 | 2, stack: ItemStack | null): boolean {
  if (slot === 2) return false;
  if (!stack) return true;
  if (slot === 0) return isSmeltableItem(stack.itemId);
  return isFuelItem(stack.itemId);
}

export function clickFurnaceSlot(
  slots: [ItemStack | null, ItemStack | null, ItemStack | null],
  index: 0 | 1 | 2,
  cursor: ItemStack | null,
  button: 'left' | 'right',
): { slots: [ItemStack | null, ItemStack | null, ItemStack | null]; cursor: ItemStack | null } {
  const result = applySlotClick(
    slots[index] ?? null,
    cursor,
    button,
    (candidate) => furnaceAccepts(index, candidate),
  );
  const next: [ItemStack | null, ItemStack | null, ItemStack | null] = [...slots];
  next[index] = result.slot;
  return { slots: next, cursor: result.cursor };
}

export function shiftMoveStack(
  source: ItemStack,
  targets: Array<ItemStack | null>,
  accepts: (index: number, stack: ItemStack) => boolean = () => true,
): { remainder: ItemStack | null; targets: Array<ItemStack | null> } {
  let moving: ItemStack | null = cloneStack(source);
  const next = targets.map((stack) => cloneStack(stack));
  for (let slot = 0; slot < next.length && moving; slot += 1) {
    if (!accepts(slot, moving)) continue;
    const target = next[slot];
    if (!target || !canStacksMerge(target, moving)) continue;
    const merged = mergeItemStacks(target, moving);
    next[slot] = merged.target;
    moving = merged.remainder;
  }
  for (let slot = 0; slot < next.length && moving; slot += 1) {
    if (next[slot] || !accepts(slot, moving)) continue;
    next[slot] = moving;
    moving = null;
  }
  return { remainder: moving, targets: next };
}

export function furnaceShiftRoute(
  stack: ItemStack,
  from: 'inventory' | 'input' | 'fuel' | 'output',
): 'input' | 'fuel' | 'inventory' {
  if (from === 'output') return 'inventory';
  if (from === 'inventory') {
    if (isSmeltableItem(stack.itemId)) return 'input';
    if (isFuelItem(stack.itemId)) return 'fuel';
    return 'inventory';
  }
  return 'inventory';
}

export function placeSmeltingIngredient(
  recipe: SmeltingRecipe,
  input: ItemStack | null,
  inventory: Inventory,
): { input: ItemStack | null; placed: boolean } {
  const counts = inventoryItemCounts(inventory);
  const itemId = pickIngredientItem(recipe.input, counts);
  if ((counts.get(itemId) ?? 0) < 1) return { input, placed: false };
  if (input && input.itemId !== itemId) {
    const remainder = inventory.add(input);
    if (remainder) return { input, placed: false };
  }
  if (input && input.itemId === itemId) return { input, placed: true };
  const removed = inventory.remove(itemId, 1);
  if (removed < 1) return { input, placed: false };
  return { input: createItemStack(itemId, 1), placed: true };
}

export function showsCreativeCatalog(kind: ContainerKind, mode: 'survival' | 'creative'): boolean {
  return kind === 'inventory' && mode === 'creative';
}

export function hasRecipeBook(kind: ContainerKind): boolean {
  return kind === 'crafting-table' || kind === 'furnace' || kind === 'inventory';
}

export { ingredientItemIds };
