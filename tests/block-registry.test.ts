import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  BLOCK_REGISTRY,
  BLOCKS_BY_KEY,
  BlockId,
  getBlockByKey,
  getBlockDefinition,
} from '../src/blocks';
import { ITEMS, ItemId, getItemDefinition } from '../src/items';

describe('block registry', () => {
  it('keeps numeric ids and string keys unique and indexed', () => {
    expect(new Set(BLOCKS.map((block) => block.id)).size).toBe(BLOCKS.length);
    expect(new Set(BLOCKS.map((block) => block.key)).size).toBe(BLOCKS.length);
    expect(BLOCK_REGISTRY.size).toBe(BLOCKS.length);
    expect(BLOCKS_BY_KEY.size).toBe(BLOCKS.length);
    expect(getBlockDefinition(BlockId.Stone).key).toBe('stone');
    expect(getBlockByKey('stone')?.id).toBe(BlockId.Stone);
  });

  it('contains the required terrain and behaves data-first', () => {
    const required = [
      'air', 'grass_block', 'dirt', 'stone', 'cobblestone', 'bedrock', 'sand',
      'sandstone', 'gravel', 'oak_log', 'oak_leaves', 'cactus', 'water', 'lava',
    ];
    for (const key of required) expect(getBlockByKey(key), key).toBeDefined();

    expect(getBlockDefinition(BlockId.Air)).toMatchObject({ solid: false, opaque: false, breakable: false });
    expect(getBlockDefinition(BlockId.Sand).gravity).toBe(true);
    expect(getBlockDefinition(BlockId.Gravel).gravity).toBe(true);
    expect(getBlockDefinition(BlockId.Cactus)).toMatchObject({ solid: true, contactDamage: 1 });
    expect(getBlockDefinition(BlockId.Water)).toMatchObject({ liquid: true, solid: false });
    expect(getBlockDefinition(BlockId.Bedrock).drop).toBeUndefined();
  });

  it('contains exactly the intended five ores with 1.9-style iron and gold drops', () => {
    const ores = BLOCKS.filter((block) => block.category === 'ore');
    expect(ores.map((block) => block.key).sort()).toEqual([
      'coal_ore', 'diamond_ore', 'gold_ore', 'iron_ore', 'redstone_ore',
    ]);
    expect(getBlockDefinition(BlockId.IronOre).drop?.item).toBe('iron_ore');
    expect(getBlockDefinition(BlockId.GoldOre).drop?.item).toBe('gold_ore');
    expect(getBlockDefinition(BlockId.DiamondOre).drop?.item).toBe(ItemId.Diamond);
  });

  it('registers all 16 classic wool colors', () => {
    const wool = BLOCKS.filter((block) => block.category === 'wool');
    expect(wool).toHaveLength(16);
    expect(wool.map((block) => block.key)).toContain('white_wool');
    expect(wool.map((block) => block.key)).toContain('black_wool');
  });

  it('provides a placeable item for every block that opts into one', () => {
    for (const block of BLOCKS.filter((entry) => entry.hasItem !== false)) {
      expect(getItemDefinition(block.key)).toMatchObject({
        kind: 'block', blockId: block.id, placesBlockId: block.id, maxStack: 64,
      });
    }
  });
});

describe('item registry', () => {
  it('has unique ids, stack limits, food, equipment and all four armor sets', () => {
    expect(new Set(ITEMS.map((item) => item.id)).size).toBe(ITEMS.length);
    expect(getItemDefinition(ItemId.Apple)).toMatchObject({ kind: 'food', maxStack: 64 });
    expect(getItemDefinition(ItemId.CookedChicken)).toMatchObject({
      kind: 'food', food: { nutrition: 6, saturation: 7.2 },
    });
    expect(getItemDefinition(ItemId.DiamondPickaxe)).toMatchObject({
      kind: 'tool', maxStack: 1, tier: 'diamond', durability: 1561,
    });
    expect(getItemDefinition(ItemId.GoldChestplate)).toMatchObject({
      kind: 'armor', material: 'gold', slot: 'chest', maxStack: 1,
    });
  });

  it('does not implement excluded progression content', () => {
    const ids = new Set(ITEMS.map((item) => item.id));
    for (const excluded of ['lapis_lazuli', 'emerald', 'raw_copper', 'wooden_hoe', 'golden_pickaxe', 'golden_sword']) {
      expect(ids.has(excluded), excluded).toBe(false);
    }
  });
});
