import type { ItemStack } from '../inventory';

export type ItemIngredient = string | {
  readonly item: string;
  readonly count?: number;
};

export interface AnyOfIngredient {
  readonly anyOf: readonly string[];
  readonly count?: number;
}

export interface TagIngredient {
  readonly tag: string;
  readonly count?: number;
}

export type Ingredient = ItemIngredient | AnyOfIngredient | TagIngredient;

export interface RecipeOutput {
  readonly item: string;
  readonly count: number;
}

interface BaseRecipe {
  readonly id: string;
  readonly output: RecipeOutput;
  /** Smallest grid that may be used for the recipe (2 for inventory, 3 for table). */
  readonly gridSize?: 2 | 3;
}

export interface ShapedRecipe extends BaseRecipe {
  readonly type: 'shaped';
  readonly pattern: readonly string[];
  readonly key: Readonly<Record<string, Ingredient>>;
  readonly mirrored?: boolean;
}

export interface ShapelessRecipe extends BaseRecipe {
  readonly type: 'shapeless';
  readonly ingredients: readonly Ingredient[];
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

export type CraftingCell = string | ItemStack | null | undefined;

export interface CraftingMatch {
  readonly recipe: Recipe;
  readonly output: ItemStack;
  /** Number of items consumed from each input cell. */
  readonly consumption: readonly number[];
}

export interface SmeltingRecipe {
  readonly id: string;
  readonly input: Ingredient;
  readonly output: RecipeOutput;
  readonly cookingTimeTicks: number;
}
