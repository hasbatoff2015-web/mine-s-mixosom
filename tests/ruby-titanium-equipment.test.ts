import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  BlockId,
  TOOL_TIER_RANK,
  canHarvestBlock,
  getBlockDefinition,
  miningProgressPerTick,
} from '../src/blocks';
import {
  CRAFTING_RECIPES,
  SMELTING_RECIPES,
  findCraftingRecipe,
  findSmeltingRecipe,
  getCraftingResult,
  matchCraftingRecipe,
} from '../src/crafting';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../src/core/constants';
import { displayNameFor } from '../src/i18n';
import { Inventory, createItemStack } from '../src/inventory';
import { ITEMS, ItemId, getItemDefinition, obtainableItems } from '../src/items';
import { getArmorPoints, reduceDamageByArmor } from '../src/survival';
import { Chunk } from '../src/world/Chunk';
import { ORE_RULES, TerrainGenerator } from '../src/world/Generator';

const ARMOR_SLOTS = {
  head: 'helmet',
  chest: 'chestplate',
  legs: 'leggings',
  feet: 'boots',
} as const;

const ARMOR_STATS = {
  leather: {
    defense: { head: 1, chest: 3, legs: 2, feet: 1 },
    durability: { head: 55, chest: 80, legs: 75, feet: 65 },
    total: 7,
  },
  gold: {
    defense: { head: 2, chest: 5, legs: 3, feet: 1 },
    durability: { head: 77, chest: 112, legs: 105, feet: 91 },
    total: 11,
  },
  iron: {
    defense: { head: 2, chest: 6, legs: 5, feet: 2 },
    durability: { head: 165, chest: 240, legs: 225, feet: 195 },
    total: 15,
  },
  diamond: {
    defense: { head: 3, chest: 7, legs: 5, feet: 2 },
    durability: { head: 363, chest: 528, legs: 495, feet: 429 },
    total: 17,
  },
  ruby: {
    defense: { head: 3, chest: 7, legs: 5, feet: 3 },
    durability: { head: 500, chest: 720, legs: 675, feet: 585 },
    total: 18,
  },
  titanium: {
    defense: { head: 3, chest: 8, legs: 6, feet: 3 },
    durability: { head: 650, chest: 940, legs: 880, feet: 760 },
    total: 20,
  },
} as const;

const EQUIPMENT_NAMES = [
  'helmet', 'chestplate', 'leggings', 'boots',
  'sword', 'pickaxe', 'axe', 'shovel', 'hoe',
] as const;

const RUBY_PATTERNS: Readonly<Record<(typeof EQUIPMENT_NAMES)[number], readonly string[]>> = {
  helmet: ['MMM', 'M M'],
  chestplate: ['M M', 'MMM', 'MMM'],
  leggings: ['MMM', 'M M', 'M M'],
  boots: ['M M', 'M M'],
  sword: ['M', 'M', 'S'],
  pickaxe: ['MMM', ' S ', ' S '],
  axe: ['MM ', 'MS ', ' S '],
  shovel: ['M', 'S', 'S'],
  hoe: ['MM', ' S', ' S'],
};

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

function equipFullSet(inventory: Inventory, material: keyof typeof ARMOR_STATS): void {
  for (const [slot, suffix] of Object.entries(ARMOR_SLOTS)) {
    inventory.setSlot(
      { section: 'armor', slot: slot as keyof typeof ARMOR_SLOTS },
      createItemStack(`${material}_${suffix}`),
    );
  }
}

describe('Ruby and Titanium registry progression', () => {
  it('registers resources, all equipment IDs and stable Titanium Ore block item', () => {
    expect(BlockId.TitaniumOre).toBe(161);
    expect(getBlockDefinition(BlockId.TitaniumOre)).toMatchObject({
      key: 'titanium_ore', name: 'Титановая руда', category: 'ore', hardness: 5,
      tool: 'pickaxe', tier: 'ruby',
      drop: { item: 'titanium_ore', min: 1, max: 1, requiresCorrectTool: true },
    });
    expect(getItemDefinition('titanium_ore')).toMatchObject({
      kind: 'block', blockId: BlockId.TitaniumOre, maxStack: 64,
    });
    expect(getItemDefinition(ItemId.RubyIngot)).toMatchObject({ kind: 'resource', maxStack: 64 });
    expect(getItemDefinition(ItemId.TitaniumIngot)).toMatchObject({ kind: 'resource', maxStack: 64 });

    for (const material of ['ruby', 'titanium'] as const) {
      for (const name of EQUIPMENT_NAMES) {
        const id = `${material}_${name}`;
        expect(ITEMS.some((item) => item.id === id), id).toBe(true);
        expect(getItemDefinition(id).maxStack, id).toBe(1);
      }
    }

    const creativeIds = new Set(obtainableItems().map((item) => item.id));
    for (const id of [ItemId.RubyIngot, ItemId.TitaniumIngot, 'titanium_ore']) {
      expect(creativeIds.has(id), `creative:${id}`).toBe(true);
    }
    for (const material of ['ruby', 'titanium'] as const) {
      for (const name of EQUIPMENT_NAMES) expect(creativeIds.has(`${material}_${name}`)).toBe(true);
    }
  });

  it('uses exact tool durability, mining speed and generic damage formulas', () => {
    const stats = {
      ruby: { durability: 2100, miningSpeed: 10, bonus: 4 },
      titanium: { durability: 2800, miningSpeed: 12, bonus: 5 },
    } as const;
    const baseDamage = { pickaxe: 3, axe: 4, shovel: 2, hoe: 1 } as const;
    for (const [tier, expected] of Object.entries(stats)) {
      expect(getItemDefinition(`${tier}_sword`), `${tier}_sword`).toMatchObject({
        tier,
        durability: expected.durability,
        attackDamage: 5 + expected.bonus,
      });
      for (const tool of ['pickaxe', 'axe', 'shovel', 'hoe'] as const) {
        expect(getItemDefinition(`${tier}_${tool}`), `${tier}_${tool}`).toMatchObject({
          tier,
          durability: expected.durability,
          miningSpeed: expected.miningSpeed,
          attackDamage: baseDamage[tool] + expected.bonus,
        });
      }
    }
    expect(getItemDefinition(ItemId.DiamondSword)).toMatchObject({ attackDamage: 8 });
    expect(getItemDefinition(ItemId.RubySword)).toMatchObject({ attackDamage: 9 });
    expect(getItemDefinition(ItemId.TitaniumSword)).toMatchObject({ attackDamage: 10 });
  });

  it('provides exact Russian and English names for every new obtainable ID', () => {
    expect(displayNameFor(ItemId.RubyIngot, 'ru')).toBe('Рубиновый слиток');
    expect(displayNameFor(ItemId.RubyChestplate, 'ru')).toBe('Рубиновый нагрудник');
    expect(displayNameFor('titanium_ore', 'ru')).toBe('Титановая руда');
    expect(displayNameFor(ItemId.TitaniumPickaxe, 'ru')).toBe('Титановая кирка');
    expect(displayNameFor(ItemId.RubyIngot, 'en')).toBe('Ruby Ingot');
    expect(displayNameFor(ItemId.RubyChestplate, 'en')).toBe('Ruby Chestplate');
    expect(displayNameFor('titanium_ore', 'en')).toBe('Titanium Ore');
    expect(displayNameFor(ItemId.TitaniumPickaxe, 'en')).toBe('Titanium Pickaxe');
  });
});

describe('Ruby and Titanium armor balance', () => {
  it('registers the six exact full-set totals and piece durability', () => {
    const inventory = new Inventory();
    for (const [material, expected] of Object.entries(ARMOR_STATS)) {
      inventory.clear();
      for (const [slot, suffix] of Object.entries(ARMOR_SLOTS)) {
        expect(getItemDefinition(`${material}_${suffix}`), `${material}_${suffix}`).toMatchObject({
          kind: 'armor', material, slot,
          defense: expected.defense[slot as keyof typeof ARMOR_SLOTS],
          durability: expected.durability[slot as keyof typeof ARMOR_SLOTS],
        });
      }
      equipFullSet(inventory, material as keyof typeof ARMOR_STATS);
      expect(getArmorPoints(inventory), material).toBe(expected.total);
    }
  });

  it('keeps flat 4% per point reduction, ignores toughness and sums mixed pieces', () => {
    const inventory = new Inventory();
    for (const [material, points, reduction] of [
      ['diamond', 17, 0.68], ['ruby', 18, 0.72], ['titanium', 20, 0.80],
    ] as const) {
      inventory.clear();
      equipFullSet(inventory, material);
      expect(getArmorPoints(inventory)).toBe(points);
      expect(1 - reduceDamageByArmor(100, inventory) / 100).toBeCloseTo(reduction);
      expect(reduceDamageByArmor(100, { points, toughness: 999 })).toBeCloseTo(100 * (1 - reduction));
    }

    inventory.clear();
    inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack(ItemId.RubyHelmet));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.TitaniumChestplate));
    inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack(ItemId.DiamondLeggings));
    inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack(ItemId.RubyBoots));
    expect(getArmorPoints(inventory)).toBe(19);
  });
});

describe('Ruby crafting and Titanium upgrades', () => {
  it('matches exactly one Diamond + three Gold + three Iron as one Ruby Ingot', () => {
    const grid = [
      createItemStack(ItemId.Diamond),
      createItemStack(ItemId.GoldIngot, 3),
      createItemStack(ItemId.IronIngot, 3),
      null, null, null, null, null, null,
    ];
    const match = matchCraftingRecipe(grid, 3, 3);
    expect(match?.recipe.id).toBe('ruby_ingot');
    expect(match?.output).toEqual(createItemStack(ItemId.RubyIngot));
    expect(match?.consumption.slice(0, 3)).toEqual([1, 3, 3]);

    const sevenOccupiedCells = [
      ItemId.Diamond,
      ItemId.GoldIngot, ItemId.GoldIngot, ItemId.GoldIngot,
      ItemId.IronIngot, ItemId.IronIngot, ItemId.IronIngot,
      null, null,
    ];
    const splitMatch = matchCraftingRecipe(sevenOccupiedCells, 3, 3);
    expect(splitMatch?.recipe.id).toBe('ruby_ingot');
    expect(splitMatch?.consumption).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0]);

    expect(findCraftingRecipe([
      createItemStack(ItemId.Diamond), createItemStack(ItemId.GoldIngot, 2), createItemStack(ItemId.IronIngot, 3),
      null, null, null, null, null, null,
    ], 3, 3)?.id).not.toBe('ruby_ingot');
    expect(findCraftingRecipe([
      createItemStack(ItemId.Diamond), createItemStack(ItemId.GoldIngot, 3), createItemStack(ItemId.IronIngot, 3),
      ItemId.Stick, null, null, null, null, null,
    ], 3, 3)?.id).not.toBe('ruby_ingot');
    expect(findSmeltingRecipe(ItemId.RubyIngot)).toBeUndefined();
  });

  it('crafts all nine Ruby pieces with ordinary shaped recipes, including mirrors', () => {
    for (const equipment of EQUIPMENT_NAMES) {
      const result = getCraftingResult(patternGrid(RUBY_PATTERNS[equipment], ItemId.RubyIngot), 3, 3);
      expect(result?.itemId, equipment).toBe(`ruby_${equipment}`);
    }
    expect(getCraftingResult(patternGrid([' MM', ' SM', ' S '], ItemId.RubyIngot), 3, 3)?.itemId).toBe(ItemId.RubyAxe);
    expect(getCraftingResult(patternGrid([' MM', ' S ', ' S '], ItemId.RubyIngot), 3, 3)?.itemId).toBe(ItemId.RubyHoe);
  });

  it('upgrades exactly matching Ruby equipment with one Titanium Ingot', () => {
    for (const equipment of EQUIPMENT_NAMES) {
      const ruby = `ruby_${equipment}`;
      const titanium = `titanium_${equipment}`;
      expect(getCraftingResult([ruby, ItemId.TitaniumIngot], 2, 1)?.itemId, equipment).toBe(titanium);
      expect(getCraftingResult([ItemId.TitaniumIngot, ruby], 2, 1)?.itemId, `${equipment}:reverse`).toBe(titanium);
      expect(getCraftingResult([`diamond_${equipment}`, ItemId.TitaniumIngot], 2, 1)?.itemId).not.toBe(titanium);
      expect(getCraftingResult(patternGrid(RUBY_PATTERNS[equipment], ItemId.TitaniumIngot), 3, 3)?.itemId).not.toBe(titanium);
    }
    expect(CRAFTING_RECIPES.filter((recipe) => recipe.id.startsWith('titanium_'))).toHaveLength(9);
  });
});

describe('Titanium furnace and mining tiers', () => {
  it('smelts Titanium Ore through the ordinary 200-tick recipe', () => {
    expect(findSmeltingRecipe('titanium_ore')).toMatchObject({
      id: 'titanium_ingot', output: { item: ItemId.TitaniumIngot, count: 1 }, cookingTimeTicks: 200,
    });
    expect(SMELTING_RECIPES.filter((recipe) => recipe.output.item === ItemId.TitaniumIngot)).toHaveLength(1);
  });

  it('uses one canonical non-lexical hierarchy and preserves Gold semantics', () => {
    expect(TOOL_TIER_RANK).toEqual({
      hand: 0, wood: 1, stone: 2, iron: 3, gold: 1, diamond: 4, ruby: 5, titanium: 6,
    });
    const titaniumOre = getBlockDefinition(BlockId.TitaniumOre);
    const definition = (itemId: string) => getItemDefinition(itemId);
    expect(canHarvestBlock(titaniumOre, definition(ItemId.DiamondPickaxe))).toBe(false);
    expect(canHarvestBlock(titaniumOre, definition(ItemId.RubyPickaxe))).toBe(true);
    expect(canHarvestBlock(titaniumOre, definition(ItemId.TitaniumPickaxe))).toBe(true);
    expect(miningProgressPerTick(titaniumOre, definition(ItemId.DiamondPickaxe))).toBeGreaterThan(0);

    const diamondTierBlocks = BLOCKS.filter((block) => block.tier === 'diamond' && block.drop?.requiresCorrectTool);
    expect(diamondTierBlocks.length).toBeGreaterThan(0);
    for (const block of diamondTierBlocks) {
      expect(canHarvestBlock(block, definition(ItemId.TitaniumPickaxe)), block.key).toBe(true);
    }
    expect(canHarvestBlock(getBlockDefinition(BlockId.DiamondOre), definition(ItemId.IronPickaxe))).toBe(true);
    expect(canHarvestBlock(getBlockDefinition(BlockId.DiamondOre), definition(ItemId.StonePickaxe))).toBe(false);
    expect(canHarvestBlock(getBlockDefinition(BlockId.Obsidian), definition(ItemId.DiamondPickaxe))).toBe(true);
  });
});

describe('Titanium deterministic world generation', () => {
  it('keeps old ore layout byte-stable and yields Titanium 2-3x rarer than Diamond', () => {
    const seed = 'ruby-titanium-compat-v1';
    const generator = new TerrainGenerator(seed);
    const repeatedGenerator = new TerrainGenerator(seed);
    const first = new Chunk(2, -1);
    const repeated = new Chunk(2, -1);
    generator.generate(first);
    repeatedGenerator.generate(repeated);
    expect([...first.blocks]).toEqual([...repeated.blocks]);

    const oldOres = new Set<BlockId>([
      BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre,
      BlockId.RedstoneOre, BlockId.DiamondOre,
    ]);
    const oldPositions: string[] = [];
    let diamond = 0;
    let titanium = 0;
    let maxTitaniumPerChunk = 0;
    let minTitaniumY = WORLD_HEIGHT;
    let maxTitaniumY = -1;

    for (let cz = -3; cz <= 3; cz += 1) {
      for (let cx = -3; cx <= 3; cx += 1) {
        const chunk = new Chunk(cx, cz);
        generator.generate(chunk);
        let chunkTitanium = 0;
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          for (let z = 0; z < CHUNK_SIZE; z += 1) {
            for (let x = 0; x < CHUNK_SIZE; x += 1) {
              const block = chunk.get(x, y, z);
              if (block === BlockId.DiamondOre) diamond += 1;
              if (block === BlockId.TitaniumOre) {
                titanium += 1;
                chunkTitanium += 1;
                minTitaniumY = Math.min(minTitaniumY, y);
                maxTitaniumY = Math.max(maxTitaniumY, y);
              }
              if (oldOres.has(block)) oldPositions.push(`${cx},${cz},${x},${y},${z},${block}`);
            }
          }
        }
        maxTitaniumPerChunk = Math.max(maxTitaniumPerChunk, chunkTitanium);
      }
    }

    oldPositions.sort();
    const oldOreDigest = createHash('sha256').update(oldPositions.join('\n')).digest('hex');
    expect(oldOreDigest).toBe('7221e1756de7ad877a94cbe647bb6668fbe38abbfed99d32152f1795fb258e77');
    expect({ diamond, titanium }).toEqual({ diamond: 198, titanium: 76 });
    expect(diamond / titanium).toBeGreaterThan(2);
    expect(diamond / titanium).toBeLessThan(3);
    expect(minTitaniumY).toBeGreaterThanOrEqual(4);
    expect(maxTitaniumY).toBeLessThanOrEqual(12);
    expect(maxTitaniumPerChunk).toBeLessThanOrEqual(3);

    const titaniumRule = ORE_RULES.at(-1);
    expect(titaniumRule).toMatchObject({
      block: BlockId.TitaniumOre, minY: 4, maxY: 12, veins: 1, size: 3, spawnChance: 0.75,
    });
  }, 30_000);
});
