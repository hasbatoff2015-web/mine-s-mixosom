import { describe, expect, it } from 'vitest';
import {
  CRAFTING_RECIPES,
  consumeCraftingGrid,
  findCraftingRecipe,
  findSmeltingRecipe,
  getCraftingResult,
  getFuelBurnTicks,
  matchCraftingRecipe,
} from '../src/crafting';
import { createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';

const grid = (...rows: readonly (readonly (string | null)[])[]): readonly (string | null)[] => rows.flat();

describe('crafting matcher', () => {
  it('matches shapeless planks anywhere in a 2x2 grid', () => {
    const input = [null, null, null, 'oak_log'];
    expect(findCraftingRecipe(input, 2, 2)?.id).toBe('oak_planks_from_log');
    expect(getCraftingResult(input, 2, 2)).toEqual({ itemId: 'oak_planks', count: 4 });
  });

  it('matches a shifted shaped recipe and accepts any registered planks tag', () => {
    const input = [null, 'birch_planks', null, 'birch_planks'];
    expect(findCraftingRecipe(input, 2, 2)?.id).toBe('sticks');
    expect(getCraftingResult(input, 2, 2)?.count).toBe(4);
  });

  it('supports mirrored tools and rejects unrelated extra ingredients', () => {
    const mirroredAxe = grid(
      [null, 'oak_planks', 'oak_planks'],
      [null, ItemId.Stick, 'oak_planks'],
      [null, ItemId.Stick, null],
    );
    expect(findCraftingRecipe(mirroredAxe)?.id).toBe('wooden_axe');
    expect(findCraftingRecipe([...mirroredAxe.slice(0, 8), 'dirt'])).toBeUndefined();
  });

  it('requires white wool for the survival bed recipe', () => {
    const whiteBed = grid(
      ['white_wool', 'white_wool', 'white_wool'],
      ['oak_planks', 'oak_planks', 'oak_planks'],
      [null, null, null],
    );
    const redBed = whiteBed.map((cell) => cell === 'white_wool' ? 'red_wool' : cell);
    expect(findCraftingRecipe(whiteBed)?.id).toBe('white_bed');
    expect(findCraftingRecipe(redBed)).toBeUndefined();
  });

  it('returns a deterministic consumption plan for stacked inputs', () => {
    const input = [createItemStack('oak_log', 5), null, null, null];
    const match = matchCraftingRecipe(input, 2, 2);
    expect(match?.consumption).toEqual([1, 0, 0, 0]);
    expect(consumeCraftingGrid(input, match!)[0]).toEqual({ itemId: 'oak_log', count: 4 });
  });

  it('has neither a shield recipe nor a registry entry', () => {
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'shield' || recipe.output.item === 'shield')).toBe(false);
    expect(() => getItemDefinition('shield')).toThrow();
  });

  it('contains valid outputs for core, equipment, armor and building recipes', () => {
    const expected = [
      'crafting_table', 'chest', 'furnace', 'torch', 'wooden_pickaxe', 'diamond_sword',
      'bow', 'arrows', 'white_bed', 'oak_door', 'oak_slab', 'cobblestone_stairs',
      'birch_stairs', 'stone_pressure_plate', 'brick_stairs',
      'gold_chestplate', 'tnt', 'minecart',
    ];
    const ids = new Set(CRAFTING_RECIPES.map((recipe) => recipe.id));
    for (const id of expected) expect(ids.has(id), id).toBe(true);
    for (const recipe of CRAFTING_RECIPES) expect(() => getItemDefinition(recipe.output.item)).not.toThrow();
  });
});

describe('furnace data', () => {
  it('maps 1.9 ore blocks and raw foods to their cooked outputs', () => {
    expect(findSmeltingRecipe('iron_ore')?.output.item).toBe(ItemId.IronIngot);
    expect(findSmeltingRecipe('gold_ore')?.output.item).toBe(ItemId.GoldIngot);
    expect(findSmeltingRecipe(ItemId.Chicken)?.output.item).toBe(ItemId.CookedChicken);
  });

  it('provides deterministic 20 TPS fuel durations', () => {
    expect(getFuelBurnTicks(ItemId.Coal)).toBe(1_600);
    expect(getFuelBurnTicks('oak_planks')).toBe(300);
    expect(getFuelBurnTicks('stone')).toBe(0);
  });
});
