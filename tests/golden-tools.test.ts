import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BlockId,
  TOOL_TIER_RANK,
  canHarvestBlock,
  getBlockDefinition,
  miningSpeedMultiplier,
} from '../src/blocks';
import { CombatSystem, getAttackProfile } from '../src/combat';
import { CRAFTING_RECIPES, getCraftingResult } from '../src/crafting';
import type { ShapedRecipe } from '../src/crafting';
import { displayNameFor } from '../src/i18n';
import { createItemStack, damageItem, type ItemStack } from '../src/inventory';
import {
  ITEMS,
  ItemId,
  classifyItemForRendering,
  classifyThirdPersonItemPose,
  getItemDefinition,
  isSwordItem,
  obtainableItems,
} from '../src/items';
import { classifyThirdPersonHeldItem } from '../src/rendering/player/thirdPersonHeldItem';

const GOLD_TOOLS = [
  ItemId.GoldenPickaxe,
  ItemId.GoldenAxe,
  ItemId.GoldenShovel,
  ItemId.GoldenHoe,
  ItemId.GoldenSword,
] as const;

const TEXTURE_PAIRS = [
  ['assets/minecraft/textures/items/gold_pickaxe.png', 'public/textures/item/golden_pickaxe.png'],
  ['assets/minecraft/textures/items/gold_axe.png', 'public/textures/item/golden_axe.png'],
  ['assets/minecraft/textures/items/gold_shovel.png', 'public/textures/item/golden_shovel.png'],
  ['assets/minecraft/textures/items/gold_sword.png', 'public/textures/item/golden_sword.png'],
  ['assets/minecraft/textures/items/gold_hoe.png', 'public/textures/item/golden_hoe.png'],
] as const;

function patternGrid(pattern: readonly string[], material: string): Array<string | null> {
  return Array.from({ length: 9 }, (_unused, index) => {
    const x = index % 3;
    const y = Math.floor(index / 3);
    const symbol = pattern[y]?.[x] ?? ' ';
    if (symbol === 'M') return material;
    if (symbol === 'S') return ItemId.Stick;
    return null;
  });
}

function shapedRecipe(id: string): ShapedRecipe {
  const recipe = CRAFTING_RECIPES.find((entry) => entry.id === id);
  expect(recipe?.type, id).toBe('shaped');
  return recipe as ShapedRecipe;
}

describe('golden tool registry', () => {
  it('registers the full golden set once, with canonical golden_ ids', () => {
    expect(ItemId.GoldenPickaxe).toBe('golden_pickaxe');
    expect(ItemId.GoldenAxe).toBe('golden_axe');
    expect(ItemId.GoldenShovel).toBe('golden_shovel');
    expect(ItemId.GoldenHoe).toBe('golden_hoe');
    expect(ItemId.GoldenSword).toBe('golden_sword');
    expect(ItemId.GoldHelmet).toBe('gold_helmet');

    const ids = ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of GOLD_TOOLS) {
      expect(ids.filter((entry) => entry === id), id).toHaveLength(1);
      expect(getItemDefinition(id).id, id).toBe(id);
    }
    expect(ITEMS.some((item) => item.id === 'gold_pickaxe' || item.id === 'gold_sword')).toBe(false);
  });

  it('uses gold tier stats and the existing tool damage formulas', () => {
    expect(getItemDefinition(ItemId.GoldenPickaxe)).toMatchObject({
      kind: 'tool', tool: 'pickaxe', tier: 'gold', durability: 32, miningSpeed: 12,
      attackDamage: 3, maxStack: 1, texture: 'item/golden_pickaxe',
      tags: ['tool', 'pickaxe', 'tier:gold'], name: 'Золотая кирка',
    });
    expect(getItemDefinition(ItemId.GoldenAxe)).toMatchObject({
      kind: 'tool', tool: 'axe', tier: 'gold', durability: 32, miningSpeed: 12,
      attackDamage: 4, maxStack: 1, texture: 'item/golden_axe',
      tags: ['tool', 'axe', 'tier:gold'], name: 'Золотой топор',
    });
    expect(getItemDefinition(ItemId.GoldenShovel)).toMatchObject({
      kind: 'tool', tool: 'shovel', tier: 'gold', durability: 32, miningSpeed: 12,
      attackDamage: 2, maxStack: 1, texture: 'item/golden_shovel',
      tags: ['tool', 'shovel', 'tier:gold'], name: 'Золотая лопата',
    });
    expect(getItemDefinition(ItemId.GoldenHoe)).toMatchObject({
      kind: 'tool', tool: 'hoe', tier: 'gold', durability: 32, miningSpeed: 12,
      attackDamage: 1, maxStack: 1, texture: 'item/golden_hoe',
      tags: ['tool', 'hoe', 'tier:gold'], name: 'Золотая мотыга',
    });
    expect(getItemDefinition(ItemId.GoldenSword)).toMatchObject({
      kind: 'weapon', weapon: 'sword', tier: 'gold', durability: 32,
      attackDamage: 5, maxStack: 1, texture: 'item/golden_sword',
      tags: ['weapon', 'sword', 'tier:gold'], name: 'Золотой меч',
    });
  });

  it('keeps the previous golden hoe gameplay stats after the generic tier', () => {
    expect(getItemDefinition(ItemId.GoldenHoe)).toMatchObject({
      tier: 'gold', durability: 32, miningSpeed: 12, attackDamage: 1,
    });
  });

  it('exposes English names for the full golden set', () => {
    expect(displayNameFor(ItemId.GoldenPickaxe, 'en')).toBe('Golden Pickaxe');
    expect(displayNameFor(ItemId.GoldenAxe, 'en')).toBe('Golden Axe');
    expect(displayNameFor(ItemId.GoldenShovel, 'en')).toBe('Golden Shovel');
    expect(displayNameFor(ItemId.GoldenHoe, 'en')).toBe('Golden Hoe');
    expect(displayNameFor(ItemId.GoldenSword, 'en')).toBe('Golden Sword');
  });

  it('lists all five golden tools in the creative catalog', () => {
    const obtainable = new Set(obtainableItems().map((item) => item.id));
    for (const id of GOLD_TOOLS) expect(obtainable.has(id), id).toBe(true);
  });
});

describe('golden tool crafting', () => {
  it('crafts the full set from gold ingots and sticks, including mirrored axe and hoe', () => {
    const cases = [
      ['golden_pickaxe', ['MMM', ' S ', ' S '], ItemId.GoldenPickaxe],
      ['golden_axe', ['MM ', 'MS ', ' S '], ItemId.GoldenAxe],
      ['golden_axe_mirror', [' MM', ' SM', ' S '], ItemId.GoldenAxe],
      ['golden_shovel', ['M', 'S', 'S'], ItemId.GoldenShovel],
      ['golden_sword', ['M', 'M', 'S'], ItemId.GoldenSword],
      ['golden_hoe', ['MM', ' S', ' S'], ItemId.GoldenHoe],
      ['golden_hoe_mirror', [' MM', ' S ', ' S '], ItemId.GoldenHoe],
    ] as const;
    for (const [label, pattern, itemId] of cases) {
      expect(getCraftingResult(patternGrid(pattern, ItemId.GoldIngot), 3, 3)?.itemId, label).toBe(itemId);
    }

    for (const id of ['golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_sword', 'golden_hoe'] as const) {
      const recipe = shapedRecipe(id);
      expect(recipe.key.M, id).toEqual({ item: ItemId.GoldIngot });
      expect(recipe.key.S, id).toEqual({ item: ItemId.Stick });
      expect(CRAFTING_RECIPES.filter((entry) => entry.output.item === id), id).toHaveLength(1);
    }
    expect(shapedRecipe('golden_axe').mirrored).toBe(true);
    expect(shapedRecipe('golden_hoe').mirrored).toBe(true);
    expect(getCraftingResult(patternGrid(['MMM', ' S ', ' S '], ItemId.IronIngot), 3, 3)?.itemId).toBe(ItemId.IronPickaxe);
  });

  it('leaves titanium upgrade recipes on ruby plus one titanium ingot', () => {
    const upgrades = CRAFTING_RECIPES.filter((recipe) => recipe.id.startsWith('titanium_'));
    expect(upgrades).toHaveLength(9);
    expect(upgrades.map((recipe) => recipe.id).sort()).toEqual([
      'titanium_axe', 'titanium_boots', 'titanium_chestplate', 'titanium_helmet', 'titanium_hoe',
      'titanium_leggings', 'titanium_pickaxe', 'titanium_shovel', 'titanium_sword',
    ]);
    for (const recipe of upgrades) {
      expect(recipe.type).toBe('shapeless');
      if (recipe.type !== 'shapeless') continue;
      expect(recipe.ingredients).toEqual([
        { item: recipe.output.item.replace('titanium_', 'ruby_') },
        { item: ItemId.TitaniumIngot },
      ]);
    }
    expect(getCraftingResult(patternGrid(['MMM', ' S ', ' S '], ItemId.TitaniumIngot), 3, 3)?.itemId)
      .not.toBe(ItemId.TitaniumPickaxe);
  });
});

describe('golden tool mining', () => {
  it('keeps gold harvest rank equal to wood and applies speed only as a multiplier', () => {
    expect(TOOL_TIER_RANK.gold).toBe(1);
    expect(TOOL_TIER_RANK.gold).toBe(TOOL_TIER_RANK.wood);
    expect(TOOL_TIER_RANK.gold).toBeLessThan(TOOL_TIER_RANK.stone);
    expect(TOOL_TIER_RANK.gold).toBeLessThan(TOOL_TIER_RANK.iron);
    expect(TOOL_TIER_RANK.gold).toBeLessThan(TOOL_TIER_RANK.diamond);

    const golden = getItemDefinition(ItemId.GoldenPickaxe);
    const wooden = getItemDefinition(ItemId.WoodenPickaxe);
    const blocks = [
      BlockId.Stone,
      BlockId.CoalOre,
      BlockId.IronOre,
      BlockId.GoldOre,
      BlockId.DiamondOre,
      BlockId.Obsidian,
      BlockId.Furnace,
      BlockId.OakLog,
    ];
    for (const blockId of blocks) {
      const block = getBlockDefinition(blockId);
      expect(canHarvestBlock(block, golden), block.key).toBe(canHarvestBlock(block, wooden));
      const expectedSpeed = block.tool === 'pickaxe' ? 12 : 1;
      expect(miningSpeedMultiplier(block, golden), block.key).toBe(expectedSpeed);
    }
    expect(canHarvestBlock(getBlockDefinition(BlockId.Stone), golden)).toBe(true);
    expect(canHarvestBlock(getBlockDefinition(BlockId.IronOre), golden)).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.GoldOre), golden)).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.DiamondOre), golden)).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Obsidian), golden)).toBe(false);
    expect(miningSpeedMultiplier(getBlockDefinition(BlockId.Stone), golden)).toBe(12);
    expect(miningSpeedMultiplier(getBlockDefinition(BlockId.Stone), wooden)).toBe(2);
  });
});

describe('golden tool combat and rendering', () => {
  it('uses the generic sword and tool attack profiles', () => {
    expect(getAttackProfile(ItemId.GoldenSword)).toEqual({
      itemId: ItemId.GoldenSword, baseDamage: 5, weapon: 'sword', durabilityCost: 1,
    });
    expect(getAttackProfile(ItemId.GoldenAxe)).toEqual({
      itemId: ItemId.GoldenAxe, baseDamage: 4, weapon: 'axe', durabilityCost: 1,
    });
    expect(getAttackProfile(ItemId.GoldenPickaxe).weapon).toBe('pickaxe');
    expect(getAttackProfile(ItemId.GoldenShovel)).toMatchObject({ baseDamage: 2, durabilityCost: 1 });
    expect(getAttackProfile(ItemId.GoldenHoe)).toMatchObject({ baseDamage: 1, weapon: 'hoe', durabilityCost: 1 });
    expect(isSwordItem(ItemId.GoldenSword)).toBe(true);
    expect(isSwordItem(ItemId.GoldenPickaxe)).toBe(false);
    expect(isSwordItem(ItemId.GoldenAxe)).toBe(false);
    expect(isSwordItem(ItemId.GoldenShovel)).toBe(false);
    expect(isSwordItem(ItemId.GoldenHoe)).toBe(false);

    const combat = new CombatSystem({ heldItemId: ItemId.GoldenSword });
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(true);
    expect(combat.attack().damage).toBe(5);
    combat.setHeldItem(ItemId.GoldenAxe);
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(false);
    expect(combat.attack().damage).toBe(4);
  });

  it('wears a golden sword down through the generic durability pipeline', () => {
    const sword = getItemDefinition(ItemId.GoldenSword);
    expect(sword.kind).toBe('weapon');
    if (sword.kind !== 'weapon') return;
    expect(sword.durability).toBe(32);
    let stack: ItemStack | null = createItemStack(ItemId.GoldenSword);
    for (let hit = 1; hit < 32; hit += 1) {
      if (stack === null) throw new Error(`sword broke on hit ${hit}`);
      stack = damageItem(stack, getAttackProfile(ItemId.GoldenSword).durabilityCost);
      expect(stack?.durability, `hit ${hit}`).toBe(32 - hit);
    }
    if (stack === null) throw new Error('sword broke before the last point');
    expect(damageItem(stack, 1)).toBeNull();
  });

  it('classifies golden tools as handheld tools and the sword as a handheld sword', () => {
    expect(classifyItemForRendering(ItemId.GoldenPickaxe)).toBe('handheld');
    expect(classifyThirdPersonItemPose(ItemId.GoldenPickaxe)).toBe('tool');
    expect(classifyThirdPersonHeldItem(ItemId.GoldenPickaxe)).toBe('tool');
    expect(classifyItemForRendering(ItemId.GoldenAxe)).toBe('handheld');
    expect(classifyThirdPersonHeldItem(ItemId.GoldenAxe)).toBe('axe');
    expect(classifyItemForRendering(ItemId.GoldenSword)).toBe('handheld');
    expect(classifyThirdPersonItemPose(ItemId.GoldenSword)).toBe('sword');
    expect(classifyThirdPersonHeldItem(ItemId.GoldenSword)).toBe('sword');
  });
});

describe('golden tool textures', () => {
  it('publishes runtime PNGs that are byte-identical to the gold source sprites', () => {
    for (const [source, runtime] of TEXTURE_PAIRS) {
      expect(readFileSync(runtime).equals(readFileSync(source)), runtime).toBe(true);
    }
  });
});
