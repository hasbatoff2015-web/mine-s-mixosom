import { ItemId, getItemDefinition, getItemsWithTag } from '../items';
import type { Ingredient, Recipe, SmeltingRecipe } from './types';

const exact = (item: string): Ingredient => ({ item });
const tag = (name: string): Ingredient => ({ tag: name });

const recipes: Recipe[] = [
  {
    id: 'oak_planks_from_log', type: 'shapeless',
    ingredients: [exact('oak_log')], output: { item: 'oak_planks', count: 4 }, gridSize: 2,
  },
  {
    id: 'birch_planks_from_log', type: 'shapeless',
    ingredients: [exact('birch_log')], output: { item: 'birch_planks', count: 4 }, gridSize: 2,
  },
  {
    id: 'spruce_planks_from_log', type: 'shapeless',
    ingredients: [exact('spruce_log')], output: { item: 'spruce_planks', count: 4 }, gridSize: 2,
  },
  {
    id: 'sticks', type: 'shaped', pattern: ['P', 'P'], key: { P: tag('planks') },
    output: { item: ItemId.Stick, count: 4 }, gridSize: 2,
  },
  {
    id: 'crafting_table', type: 'shaped', pattern: ['PP', 'PP'], key: { P: tag('planks') },
    output: { item: 'crafting_table', count: 1 }, gridSize: 2,
  },
  {
    id: 'chest', type: 'shaped', pattern: ['PPP', 'P P', 'PPP'], key: { P: tag('planks') },
    output: { item: 'chest', count: 1 }, gridSize: 3,
  },
  {
    id: 'furnace', type: 'shaped', pattern: ['CCC', 'C C', 'CCC'], key: { C: exact('cobblestone') },
    output: { item: 'furnace', count: 1 }, gridSize: 3,
  },
  {
    id: 'torch', type: 'shaped', pattern: ['C', 'S'],
    key: { C: { anyOf: [ItemId.Coal, ItemId.Charcoal] }, S: exact(ItemId.Stick) },
    output: { item: 'torch', count: 4 }, gridSize: 2,
  },
  {
    id: 'ladder', type: 'shaped', pattern: ['S S', 'SSS', 'S S'], key: { S: exact(ItemId.Stick) },
    output: { item: 'ladder', count: 3 }, gridSize: 3,
  },
  {
    id: 'white_bed', type: 'shaped', pattern: ['WWW', 'PPP'],
    key: { W: exact('white_wool'), P: tag('planks') },
    output: { item: 'white_bed', count: 1 }, gridSize: 3,
  },
  {
    id: 'oak_door', type: 'shaped', pattern: ['PP', 'PP', 'PP'], key: { P: tag('planks') },
    output: { item: 'oak_door', count: 3 }, gridSize: 3,
  },
  {
    id: 'bow', type: 'shaped', pattern: [' ST', 'S T', ' ST'],
    key: { S: exact(ItemId.Stick), T: exact(ItemId.String) }, mirrored: true,
    output: { item: ItemId.Bow, count: 1 }, gridSize: 3,
  },
  {
    id: 'arrows', type: 'shaped', pattern: ['F', 'S', 'E'],
    key: { F: exact(ItemId.Flint), S: exact(ItemId.Stick), E: exact(ItemId.Feather) },
    output: { item: ItemId.Arrow, count: 4 }, gridSize: 3,
  },
  {
    id: 'stone_bricks', type: 'shaped', pattern: ['SS', 'SS'], key: { S: exact('stone') },
    output: { item: 'stone_bricks', count: 4 }, gridSize: 2,
  },
  {
    id: 'redstone_torch', type: 'shaped', pattern: ['R', 'S'],
    key: { R: exact(ItemId.RedstoneDust), S: exact(ItemId.Stick) },
    output: { item: 'redstone_torch', count: 1 }, gridSize: 2,
  },
  {
    id: 'lever', type: 'shaped', pattern: ['S', 'C'],
    key: { S: exact(ItemId.Stick), C: exact('cobblestone') },
    output: { item: 'lever', count: 1 }, gridSize: 2,
  },
  {
    id: 'stone_button', type: 'shapeless', ingredients: [exact('stone')],
    output: { item: 'stone_button', count: 1 }, gridSize: 2,
  },
  {
    id: 'oak_pressure_plate', type: 'shaped', pattern: ['PP'], key: { P: tag('planks') },
    output: { item: 'oak_pressure_plate', count: 1 }, gridSize: 2,
  },
  {
    id: 'tnt', type: 'shaped', pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: exact(ItemId.Gunpowder), S: exact('sand') },
    output: { item: 'tnt', count: 1 }, gridSize: 3,
  },
];

const toolMaterials = [
  { prefix: 'wooden', ingredient: tag('planks') },
  { prefix: 'stone', ingredient: exact('cobblestone') },
  { prefix: 'iron', ingredient: exact(ItemId.IronIngot) },
  { prefix: 'diamond', ingredient: exact(ItemId.Diamond) },
] as const;

for (const material of toolMaterials) {
  const M = material.ingredient;
  recipes.push(
    {
      id: `${material.prefix}_pickaxe`, type: 'shaped', pattern: ['MMM', ' S ', ' S '],
      key: { M, S: exact(ItemId.Stick) }, output: { item: `${material.prefix}_pickaxe`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_axe`, type: 'shaped', pattern: ['MM ', 'MS ', ' S '], mirrored: true,
      key: { M, S: exact(ItemId.Stick) }, output: { item: `${material.prefix}_axe`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_shovel`, type: 'shaped', pattern: ['M', 'S', 'S'],
      key: { M, S: exact(ItemId.Stick) }, output: { item: `${material.prefix}_shovel`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_sword`, type: 'shaped', pattern: ['M', 'M', 'S'],
      key: { M, S: exact(ItemId.Stick) }, output: { item: `${material.prefix}_sword`, count: 1 }, gridSize: 3,
    },
  );
}

const armorMaterials = [
  { prefix: 'leather', ingredient: exact(ItemId.Leather) },
  { prefix: 'iron', ingredient: exact(ItemId.IronIngot) },
  { prefix: 'gold', ingredient: exact(ItemId.GoldIngot) },
  { prefix: 'diamond', ingredient: exact(ItemId.Diamond) },
] as const;

for (const material of armorMaterials) {
  const M = material.ingredient;
  recipes.push(
    {
      id: `${material.prefix}_helmet`, type: 'shaped', pattern: ['MMM', 'M M'],
      key: { M }, output: { item: `${material.prefix}_helmet`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_chestplate`, type: 'shaped', pattern: ['M M', 'MMM', 'MMM'],
      key: { M }, output: { item: `${material.prefix}_chestplate`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_leggings`, type: 'shaped', pattern: ['MMM', 'M M', 'M M'],
      key: { M }, output: { item: `${material.prefix}_leggings`, count: 1 }, gridSize: 3,
    },
    {
      id: `${material.prefix}_boots`, type: 'shaped', pattern: ['M M', 'M M'],
      key: { M }, output: { item: `${material.prefix}_boots`, count: 1 }, gridSize: 3,
    },
  );
}

const buildingRecipes = [
  { key: 'oak', material: 'oak_planks' },
  { key: 'stone', material: 'stone' },
  { key: 'cobblestone', material: 'cobblestone' },
] as const;

for (const building of buildingRecipes) {
  recipes.push(
    {
      id: `${building.key}_slab`, type: 'shaped', pattern: ['MMM'], key: { M: exact(building.material) },
      output: { item: `${building.key}_slab`, count: 6 }, gridSize: 3,
    },
    {
      id: `${building.key}_stairs`, type: 'shaped', pattern: ['M  ', 'MM ', 'MMM'], mirrored: true,
      key: { M: exact(building.material) }, output: { item: `${building.key}_stairs`, count: 4 }, gridSize: 3,
    },
  );
}

function ingredientsOf(recipe: Recipe): readonly Ingredient[] {
  return recipe.type === 'shapeless' ? recipe.ingredients : Object.values(recipe.key);
}

const seenRecipeIds = new Set<string>();
for (const recipe of recipes) {
  if (seenRecipeIds.has(recipe.id)) throw new Error(`Duplicate crafting recipe id: ${recipe.id}`);
  seenRecipeIds.add(recipe.id);
  getItemDefinition(recipe.output.item);
  if (!Number.isInteger(recipe.output.count) || recipe.output.count < 1) {
    throw new Error(`Invalid output count for recipe ${recipe.id}`);
  }
  for (const ingredient of ingredientsOf(recipe)) {
    if (typeof ingredient === 'string') getItemDefinition(ingredient);
    else if ('item' in ingredient) getItemDefinition(ingredient.item);
    else if ('anyOf' in ingredient) ingredient.anyOf.forEach((item) => getItemDefinition(item));
    else if (getItemsWithTag(ingredient.tag).length === 0) {
      throw new Error(`Recipe ${recipe.id} uses empty item tag ${ingredient.tag}`);
    }
  }
}

export const CRAFTING_RECIPES: readonly Recipe[] = Object.freeze(
  recipes.map((recipe): Recipe => Object.freeze(recipe)),
);
export const RECIPES = CRAFTING_RECIPES;

const smeltingRecipes: SmeltingRecipe[] = [
  { id: 'iron_ingot', input: exact('iron_ore'), output: { item: ItemId.IronIngot, count: 1 }, cookingTimeTicks: 200 },
  { id: 'gold_ingot', input: exact('gold_ore'), output: { item: ItemId.GoldIngot, count: 1 }, cookingTimeTicks: 200 },
  { id: 'glass', input: exact('sand'), output: { item: 'glass', count: 1 }, cookingTimeTicks: 200 },
  { id: 'charcoal', input: tag('log'), output: { item: ItemId.Charcoal, count: 1 }, cookingTimeTicks: 200 },
  { id: 'cooked_beef', input: exact(ItemId.Beef), output: { item: ItemId.CookedBeef, count: 1 }, cookingTimeTicks: 200 },
  { id: 'cooked_porkchop', input: exact(ItemId.Porkchop), output: { item: ItemId.CookedPorkchop, count: 1 }, cookingTimeTicks: 200 },
  { id: 'cooked_chicken', input: exact(ItemId.Chicken), output: { item: ItemId.CookedChicken, count: 1 }, cookingTimeTicks: 200 },
];

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = Object.freeze(
  smeltingRecipes.map((recipe): SmeltingRecipe => Object.freeze(recipe)),
);

/** Furnace burn duration at 20 ticks per second. */
export const FUEL_BURN_TICKS: Readonly<Record<string, number>> = Object.freeze({
  [ItemId.Coal]: 1_600,
  [ItemId.Charcoal]: 1_600,
  oak_log: 300,
  birch_log: 300,
  spruce_log: 300,
  oak_planks: 300,
  birch_planks: 300,
  spruce_planks: 300,
  [ItemId.Stick]: 100,
});
