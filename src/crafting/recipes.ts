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
    id: 'stone_pressure_plate', type: 'shaped', pattern: ['SS'], key: { S: exact('stone') },
    output: { item: 'stone_pressure_plate', count: 1 }, gridSize: 2,
  },
  {
    id: 'tnt', type: 'shaped', pattern: ['GSG', 'SGS', 'GSG'],
    key: { G: exact(ItemId.Gunpowder), S: exact('sand') },
    output: { item: 'tnt', count: 1 }, gridSize: 3,
  },
  {
    id: 'fire_arrow', type: 'shapeless',
    ingredients: [exact(ItemId.Arrow), exact(ItemId.LavaBucket)],
    output: { item: ItemId.FireArrow, count: 1 },
    remainders: { [ItemId.LavaBucket]: ItemId.Bucket },
    gridSize: 2,
  },
  {
    id: 'oak_fence', type: 'shaped', pattern: ['PSP', 'PSP'],
    key: { P: exact('oak_planks'), S: exact(ItemId.Stick) },
    output: { item: 'oak_fence', count: 3 }, gridSize: 3,
  },
  {
    id: 'birch_fence', type: 'shaped', pattern: ['PSP', 'PSP'],
    key: { P: exact('birch_planks'), S: exact(ItemId.Stick) },
    output: { item: 'birch_fence', count: 3 }, gridSize: 3,
  },
  {
    id: 'spruce_fence', type: 'shaped', pattern: ['PSP', 'PSP'],
    key: { P: exact('spruce_planks'), S: exact(ItemId.Stick) },
    output: { item: 'spruce_fence', count: 3 }, gridSize: 3,
  },
  {
    id: 'rails', type: 'shaped', pattern: ['I I', 'ISI', 'I I'],
    key: { I: exact(ItemId.IronIngot), S: exact(ItemId.Stick) },
    output: { item: 'rail', count: 16 }, gridSize: 3,
  },
  {
    id: 'minecart', type: 'shaped', pattern: ['I I', 'III'],
    key: { I: exact(ItemId.IronIngot) },
    output: { item: ItemId.Minecart, count: 1 }, gridSize: 3,
  },
  {
    id: 'glowstone', type: 'shapeless',
    ingredients: [exact('torch'), exact(ItemId.GoldIngot)],
    output: { item: 'glowstone', count: 1 }, gridSize: 2,
  },
  {
    id: 'lantern', type: 'shapeless',
    ingredients: [exact('torch'), exact(ItemId.IronIngot)],
    output: { item: 'lantern', count: 1 }, gridSize: 2,
  },
  {
    id: 'chain', type: 'shaped', pattern: ['ISI', 'ISI', 'ISI'],
    key: { I: exact(ItemId.IronIngot), S: exact(ItemId.Stick) },
    output: { item: 'chain', count: 16 }, gridSize: 3,
  },
];

const toolMaterials = [
  { prefix: 'wooden', ingredient: tag('planks') },
  { prefix: 'stone', ingredient: exact('cobblestone') },
  { prefix: 'iron', ingredient: exact(ItemId.IronIngot) },
  { prefix: 'diamond', ingredient: exact(ItemId.Diamond) },
] as const;

const hoeMaterials = [
  ...toolMaterials,
  { prefix: 'golden', ingredient: exact(ItemId.GoldIngot) },
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

for (const material of hoeMaterials) {
  recipes.push({
    id: `${material.prefix}_hoe`, type: 'shaped', pattern: ['MM', ' S', ' S'], mirrored: true,
    key: { M: material.ingredient, S: exact(ItemId.Stick) },
    output: { item: `${material.prefix}_hoe`, count: 1 }, gridSize: 3,
  });
}

recipes.push(
  {
    id: 'bread', type: 'shaped', pattern: ['WWW'], key: { W: exact(ItemId.Wheat) },
    output: { item: ItemId.Bread, count: 1 }, gridSize: 3,
  },
  {
    id: 'bone_meal', type: 'shapeless', ingredients: [exact(ItemId.Bone)],
    output: { item: ItemId.BoneMeal, count: 3 }, gridSize: 2,
  },
  {
    id: 'melon_seeds', type: 'shapeless', ingredients: [exact(ItemId.MelonSlice)],
    output: { item: ItemId.MelonSeeds, count: 1 }, gridSize: 2,
  },
  {
    id: 'pumpkin_seeds', type: 'shapeless', ingredients: [exact('pumpkin')],
    output: { item: ItemId.PumpkinSeeds, count: 4 }, gridSize: 2,
  },
  {
    id: 'melon_block', type: 'shaped', pattern: ['MMM', 'MMM', 'MMM'],
    key: { M: exact(ItemId.MelonSlice) }, output: { item: 'melon', count: 1 }, gridSize: 3,
  },
  {
    id: 'pumpkin_pie', type: 'shapeless', ingredients: [exact(ItemId.Bread), exact('pumpkin')],
    output: { item: ItemId.PumpkinPie, count: 1 }, gridSize: 2,
  },
);

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
  { key: 'oak', material: 'oak_planks', stairs: true },
  { key: 'birch', material: 'birch_planks', stairs: true },
  { key: 'spruce', material: 'spruce_planks', stairs: true },
  { key: 'stone', material: 'stone', stairs: false },
  { key: 'cobblestone', material: 'cobblestone', stairs: true },
  { key: 'brick', material: 'bricks', stairs: true },
  { key: 'stone_brick', material: 'stone_bricks', stairs: true },
] as const;

for (const building of buildingRecipes) {
  recipes.push({
    id: `${building.key}_slab`, type: 'shaped', pattern: ['MMM'], key: { M: exact(building.material) },
    output: { item: `${building.key}_slab`, count: 6 }, gridSize: 3,
  });
  if (building.stairs) {
    recipes.push({
      id: `${building.key}_stairs`, type: 'shaped', pattern: ['M  ', 'MM ', 'MMM'], mirrored: true,
      key: { M: exact(building.material) }, output: { item: `${building.key}_stairs`, count: 4 }, gridSize: 3,
    });
  }
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
  { id: 'baked_potato', input: exact(ItemId.Potato), output: { item: ItemId.BakedPotato, count: 1 }, cookingTimeTicks: 200 },
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
  oak_slab: 150,
  birch_slab: 150,
  spruce_slab: 150,
  oak_stairs: 300,
  birch_stairs: 300,
  spruce_stairs: 300,
  [ItemId.Stick]: 100,
});
