import { createItemStack, type ItemStack } from '../inventory';
import { getItemDefinition, itemHasTag } from '../items';
import { CRAFTING_RECIPES, FUEL_BURN_TICKS, SMELTING_RECIPES } from './recipes';
import type {
  CraftingCell,
  CraftingMatch,
  Ingredient,
  Recipe,
  ShapedRecipe,
  ShapelessRecipe,
  SmeltingRecipe,
} from './types';

function ingredientCount(ingredient: Ingredient): number {
  if (typeof ingredient === 'string') return 1;
  return ingredient.count ?? 1;
}

export function ingredientMatches(ingredient: Ingredient, itemId: string): boolean {
  if (typeof ingredient === 'string') return ingredient === itemId;
  if ('item' in ingredient) return ingredient.item === itemId;
  if ('anyOf' in ingredient) return ingredient.anyOf.includes(itemId);
  return itemHasTag(itemId, ingredient.tag);
}

function normalizeCells(cells: readonly CraftingCell[], width: number, height: number): readonly (ItemStack | null)[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || cells.length !== width * height) {
    throw new RangeError('Crafting grid dimensions do not match its cell count');
  }
  return cells.map((cell) => {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'string') {
      getItemDefinition(cell);
      return { itemId: cell, count: 1 };
    }
    getItemDefinition(cell.itemId);
    if (!Number.isInteger(cell.count) || cell.count < 1) {
      throw new RangeError('Crafting stack count must be positive');
    }
    return cell;
  });
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function occupiedBounds(cells: readonly unknown[], width: number, height: number): Bounds | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] === null) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function patternBounds(pattern: readonly string[]): Bounds | undefined {
  const width = Math.max(0, ...pattern.map((row) => row.length));
  const cells = pattern.flatMap((row) =>
    Array.from({ length: width }, (_unused, x) => (row[x] ?? ' ') === ' ' ? null : true),
  );
  return occupiedBounds(cells, width, pattern.length);
}

function matchShaped(
  recipe: ShapedRecipe,
  cells: readonly (ItemStack | null)[],
  width: number,
  height: number,
): readonly number[] | undefined {
  const inputBounds = occupiedBounds(cells, width, height);
  const recipeBounds = patternBounds(recipe.pattern);
  if (inputBounds === undefined || recipeBounds === undefined
    || inputBounds.width !== recipeBounds.width || inputBounds.height !== recipeBounds.height) return undefined;

  const orientations = recipe.mirrored ? [false, true] : [false];
  for (const mirrored of orientations) {
    const consumption = Array.from({ length: cells.length }, () => 0);
    let matches = true;
    for (let y = 0; y < recipeBounds.height && matches; y += 1) {
      for (let x = 0; x < recipeBounds.width; x += 1) {
        const recipeX = mirrored ? recipeBounds.width - x - 1 : x;
        const row = recipe.pattern[recipeBounds.y + y] ?? '';
        const symbol = row[recipeBounds.x + recipeX] ?? ' ';
        const stackIndex = (inputBounds.y + y) * width + inputBounds.x + x;
        const stack = cells[stackIndex] ?? null;
        if (symbol === ' ') {
          if (stack !== null) matches = false;
          continue;
        }
        const ingredient = recipe.key[symbol];
        if (ingredient === undefined || stack === null || !ingredientMatches(ingredient, stack.itemId)) {
          matches = false;
          continue;
        }
        const count = ingredientCount(ingredient);
        if (stack.count < count) matches = false;
        else consumption[stackIndex] = count;
      }
    }
    if (matches) return consumption;
  }
  return undefined;
}

function matchShapeless(
  recipe: ShapelessRecipe,
  cells: readonly (ItemStack | null)[],
): readonly number[] | undefined {
  const units = recipe.ingredients.flatMap((ingredient) =>
    Array.from({ length: ingredientCount(ingredient) }, () => ingredient),
  );
  const consumption = Array.from({ length: cells.length }, () => 0);

  const search = (unitIndex: number): boolean => {
    if (unitIndex === units.length) {
      return cells.every((stack, index) => stack === null || (consumption[index] ?? 0) > 0);
    }
    const ingredient = units[unitIndex];
    if (ingredient === undefined) return false;
    for (let index = 0; index < cells.length; index += 1) {
      const stack = cells[index];
      if (stack === undefined || stack === null || !ingredientMatches(ingredient, stack.itemId)) continue;
      const used = consumption[index] ?? 0;
      if (used >= stack.count) continue;
      consumption[index] = used + 1;
      if (search(unitIndex + 1)) return true;
      consumption[index] = used;
    }
    return false;
  };

  return search(0) ? consumption : undefined;
}

export function matchCraftingRecipe(
  grid: readonly CraftingCell[],
  width = 3,
  height = Math.ceil(grid.length / width),
  recipes: readonly Recipe[] = CRAFTING_RECIPES,
): CraftingMatch | undefined {
  const cells = normalizeCells(grid, width, height);
  const gridSize = Math.max(width, height);
  for (const recipe of recipes) {
    if ((recipe.gridSize ?? 3) > gridSize) continue;
    const consumption = recipe.type === 'shaped'
      ? matchShaped(recipe, cells, width, height)
      : matchShapeless(recipe, cells);
    if (consumption !== undefined) {
      return {
        recipe,
        output: createItemStack(recipe.output.item, recipe.output.count),
        consumption,
      };
    }
  }
  return undefined;
}

export function findCraftingRecipe(
  grid: readonly CraftingCell[],
  width = 3,
  height = Math.ceil(grid.length / width),
  recipes: readonly Recipe[] = CRAFTING_RECIPES,
): Recipe | undefined {
  return matchCraftingRecipe(grid, width, height, recipes)?.recipe;
}

export function getCraftingResult(
  grid: readonly CraftingCell[],
  width = 3,
  height = Math.ceil(grid.length / width),
): ItemStack | null {
  return matchCraftingRecipe(grid, width, height)?.output ?? null;
}

export function consumeCraftingGrid(
  grid: readonly CraftingCell[],
  match: CraftingMatch,
): readonly (ItemStack | null)[] {
  if (grid.length !== match.consumption.length) {
    throw new RangeError('Crafting match belongs to a different grid');
  }
  const remainders = match.recipe.remainders ?? {};
  return grid.map((cell, index) => {
    if (cell === null || cell === undefined) return null;
    const stack = typeof cell === 'string' ? createItemStack(cell) : cell;
    const remaining = stack.count - (match.consumption[index] ?? 0);
    if (remaining > 0) return { ...stack, count: remaining };
    const leftover = remainders[stack.itemId];
    return leftover ? createItemStack(leftover, 1) : null;
  });
}

export function findSmeltingRecipe(itemId: string): SmeltingRecipe | undefined {
  getItemDefinition(itemId);
  return SMELTING_RECIPES.find((recipe) => ingredientMatches(recipe.input, itemId));
}

export function getFuelBurnTicks(itemId: string): number {
  return FUEL_BURN_TICKS[itemId] ?? 0;
}
