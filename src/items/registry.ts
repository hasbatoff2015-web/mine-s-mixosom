import { BLOCKS, BlockId, type BlockDefinition } from '../blocks';
import { blockItemIconTexture } from '../blocks/placement';
import {
  ItemId,
  type ArmorItemDefinition,
  type ArmorSlot,
  type BaseItemDefinition,
  type FoodItemDefinition,
  type ItemDefinition,
  type ItemTier,
  type ItemToolType,
  type ResourceItemDefinition,
  type ToolItemDefinition,
  type WeaponItemDefinition,
} from './types';

/** Invisibility potion: 3 minutes at 20 TPS. */
export const POTION_INVISIBILITY_DURATION_TICKS = 3600;
/** Regeneration potion: 1 minute at 20 TPS. Golden apple regen stays separate. */
export const POTION_REGENERATION_DURATION_TICKS = 1200;

type ResourceOptions = Partial<Pick<BaseItemDefinition, 'maxStack' | 'tags' | 'placesBlockId'>> & {
  readonly durability?: number;
};

const title = (key: string): string =>
  key.replace(/(^|_)([a-z])/g, (_match, separator: string, letter: string) =>
    `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  );

function blockTags(definition: BlockDefinition): readonly string[] {
  const tags = ['block'];
  if (definition.key.endsWith('_log')) tags.push('log');
  if (definition.key.endsWith('_planks')) tags.push('planks');
  if (definition.key.endsWith('_wool')) tags.push('wool');
  if (definition.key.endsWith('_slab')) tags.push('slab');
  if (definition.key.endsWith('_stairs')) tags.push('stairs');
  if (definition.key.endsWith('_fence')) tags.push('fence');
  return Object.freeze(tags);
}

const blockItems: ItemDefinition[] = BLOCKS
  .filter((definition) => definition.hasItem !== false)
  .map((definition) => Object.freeze({
    id: definition.key,
    name: definition.name,
    kind: 'block' as const,
    maxStack: 64 as const,
    texture: blockItemIconTexture(definition.textures, definition.key),
    blockId: definition.id,
    placesBlockId: definition.id,
    tags: blockTags(definition),
    ...(definition.hiddenFromGameplay === true ? { hiddenFromGameplay: true } : {}),
  }));

function resource(id: string, options: ResourceOptions = {}): ResourceItemDefinition {
  return Object.freeze({
    id,
    name: title(id),
    kind: 'resource',
    maxStack: options.durability !== undefined ? 1 : (options.maxStack ?? 64),
    texture: `item/${id}`,
    ...(options.tags === undefined ? {} : { tags: Object.freeze([...options.tags]) }),
    ...(options.placesBlockId === undefined ? {} : { placesBlockId: options.placesBlockId }),
    ...(options.durability === undefined ? {} : { durability: options.durability }),
  });
}

function food(
  id: string,
  nutrition: number,
  saturation: number,
  extra: { alwaysEdible?: boolean; returnsItem?: string; effects?: FoodItemDefinition['food']['effects'] } = {},
): FoodItemDefinition {
  return Object.freeze({
    id,
    name: title(id),
    kind: 'food',
    maxStack: 64,
    texture: `item/${id}`,
    food: Object.freeze({
      nutrition,
      saturation,
      ...(extra.alwaysEdible ? { alwaysEdible: true } : {}),
      ...(extra.returnsItem ? { returnsItem: extra.returnsItem } : {}),
      ...(extra.effects ? { effects: extra.effects } : {}),
    }),
  });
}

interface TierStats {
  readonly tier: ItemTier;
  readonly prefix: 'wooden' | 'stone' | 'iron' | 'diamond';
  readonly durability: number;
  readonly miningSpeed: number;
  readonly damageBonus: number;
}

const tiers: readonly TierStats[] = [
  { tier: 'wood', prefix: 'wooden', durability: 59, miningSpeed: 2, damageBonus: 0 },
  { tier: 'stone', prefix: 'stone', durability: 131, miningSpeed: 4, damageBonus: 1 },
  { tier: 'iron', prefix: 'iron', durability: 250, miningSpeed: 6, damageBonus: 2 },
  { tier: 'diamond', prefix: 'diamond', durability: 1561, miningSpeed: 8, damageBonus: 3 },
];

const toolDamage: Readonly<Record<ItemToolType, number>> = {
  pickaxe: 2,
  axe: 6,
  shovel: 2.5,
};

const axeDamage: Readonly<Record<ItemTier, number>> = {
  wood: 7,
  stone: 9,
  iron: 9,
  diamond: 9,
};

const axeSpeed: Readonly<Record<ItemTier, number>> = {
  wood: 0.8,
  stone: 0.8,
  iron: 0.9,
  diamond: 1,
};

const tools: ItemDefinition[] = tiers.flatMap((stats) =>
  (['pickaxe', 'axe', 'shovel'] as const).map((tool): ToolItemDefinition => {
    const id = `${stats.prefix}_${tool}`;
    return Object.freeze({
      id,
      name: title(id),
      kind: 'tool',
      maxStack: 1,
      texture: `item/${id}`,
      tags: Object.freeze(['tool', tool, `tier:${stats.tier}`]),
      tool,
      tier: stats.tier,
      durability: stats.durability,
      miningSpeed: stats.miningSpeed,
      attackDamage: tool === 'axe' ? axeDamage[stats.tier] : toolDamage[tool] + stats.damageBonus,
      attackSpeed: tool === 'pickaxe' ? 1.2 : tool === 'shovel' ? 1 : axeSpeed[stats.tier],
    });
  }),
);

const swords: ItemDefinition[] = tiers.map((stats): WeaponItemDefinition => {
  const id = `${stats.prefix}_sword`;
  return Object.freeze({
    id,
    name: title(id),
    kind: 'weapon',
    maxStack: 1,
    texture: `item/${id}`,
    tags: Object.freeze(['weapon', 'sword', `tier:${stats.tier}`]),
    weapon: 'sword',
    tier: stats.tier,
    durability: stats.durability,
    attackDamage: 4 + stats.damageBonus,
    attackSpeed: 1.6,
  });
});

const armorStats = {
  leather: {
    durability: { head: 55, chest: 80, legs: 75, feet: 65 },
    defense: { head: 1, chest: 3, legs: 2, feet: 1 },
    toughness: 0,
  },
  iron: {
    durability: { head: 165, chest: 240, legs: 225, feet: 195 },
    defense: { head: 2, chest: 6, legs: 5, feet: 2 },
    toughness: 0,
  },
  gold: {
    durability: { head: 77, chest: 112, legs: 105, feet: 91 },
    defense: { head: 2, chest: 5, legs: 3, feet: 1 },
    toughness: 0,
  },
  diamond: {
    durability: { head: 363, chest: 528, legs: 495, feet: 429 },
    defense: { head: 3, chest: 8, legs: 6, feet: 3 },
    toughness: 2,
  },
} as const;

const armorNames: Readonly<Record<ArmorSlot, string>> = {
  head: 'helmet',
  chest: 'chestplate',
  legs: 'leggings',
  feet: 'boots',
};

const armor: ItemDefinition[] = (Object.keys(armorStats) as Array<keyof typeof armorStats>).flatMap((material) =>
  (Object.keys(armorNames) as ArmorSlot[]).map((slot): ArmorItemDefinition => {
    const id = `${material}_${armorNames[slot]}`;
    const stats = armorStats[material];
    return Object.freeze({
      id,
      name: title(id),
      kind: 'armor',
      maxStack: 1,
      texture: `item/${id}`,
      tags: Object.freeze(['armor', `armor:${slot}`]),
      slot,
      material,
      durability: stats.durability[slot],
      defense: stats.defense[slot],
      toughness: stats.toughness,
    });
  }),
);

const resources: readonly ItemDefinition[] = [
  resource(ItemId.Stick, { tags: ['stick'] }),
  resource(ItemId.Coal, { tags: ['coal'] }),
  resource(ItemId.Charcoal, { tags: ['coal'] }),
  resource(ItemId.IronIngot, { tags: ['iron_ingot'] }),
  resource(ItemId.GoldIngot, { tags: ['gold_ingot'] }),
  resource(ItemId.Diamond, { tags: ['diamond'] }),
  resource(ItemId.RedstoneDust, { placesBlockId: BlockId.RedstoneWire }),
  resource(ItemId.Flint), resource(ItemId.ClayBall), resource(ItemId.Brick),
  resource(ItemId.String), resource(ItemId.Feather), resource(ItemId.Leather),
  resource(ItemId.Gunpowder), resource(ItemId.Book),
  resource(ItemId.Arrow, { tags: ['arrow'] }),
  resource(ItemId.FireArrow, { tags: ['arrow'] }),
  resource(ItemId.FlintAndSteel, { durability: 64 }),
  resource(ItemId.GlassBottle),
  resource(ItemId.Bucket, { maxStack: 16 }),
  resource(ItemId.WaterBucket, { placesBlockId: BlockId.Water, maxStack: 1 }),
  resource(ItemId.LavaBucket, { placesBlockId: BlockId.Lava, maxStack: 1 }),
  resource(ItemId.Minecart),
];

const foods: readonly ItemDefinition[] = [
  food(ItemId.Apple, 4, 2.4),
  food(ItemId.Bread, 5, 6),
  food(ItemId.Beef, 3, 1.8),
  food(ItemId.CookedBeef, 8, 12.8),
  food(ItemId.Porkchop, 3, 1.8),
  food(ItemId.CookedPorkchop, 8, 12.8),
  food(ItemId.Chicken, 2, 1.2),
  food(ItemId.CookedChicken, 6, 7.2),
  food(ItemId.GoldenApple, 4, 9.6, {
    alwaysEdible: true,
    effects: [
      { id: 'absorption', amplifier: 0, durationTicks: 2400 },
      { id: 'regeneration', amplifier: 1, durationTicks: 100 },
    ],
  }),
  food(ItemId.PotionInvisibility, 0, 0, {
    alwaysEdible: true,
    returnsItem: ItemId.GlassBottle,
    effects: [{ id: 'invisibility', amplifier: 0, durationTicks: POTION_INVISIBILITY_DURATION_TICKS }],
  }),
  food(ItemId.PotionRegeneration, 0, 0, {
    alwaysEdible: true,
    returnsItem: ItemId.GlassBottle,
    effects: [{ id: 'regeneration', amplifier: 0, durationTicks: POTION_REGENERATION_DURATION_TICKS }],
  }),
];

const equipment: readonly ItemDefinition[] = [
  ...tools,
  ...swords,
  Object.freeze({
    id: ItemId.Bow, name: 'Bow', kind: 'weapon', maxStack: 1, texture: 'item/bow',
    tags: Object.freeze(['weapon', 'bow']), weapon: 'bow', durability: 384, attackDamage: 0, attackSpeed: 1,
  } satisfies WeaponItemDefinition),
  ...armor,
];

export const ITEMS: readonly ItemDefinition[] = Object.freeze([
  ...blockItems,
  ...resources,
  ...foods,
  ...equipment,
]);

const itemRegistry = new Map<string, ItemDefinition>();
for (const definition of ITEMS) {
  if (!Number.isInteger(definition.maxStack) || definition.maxStack < 1) {
    throw new Error(`Invalid maximum stack size for item ${definition.id}`);
  }
  if (itemRegistry.has(definition.id)) throw new Error(`Duplicate item id: ${definition.id}`);
  itemRegistry.set(definition.id, definition);
}

export const ITEM_REGISTRY: ReadonlyMap<string, ItemDefinition> = itemRegistry;
export const ITEMS_BY_ID = ITEM_REGISTRY;

export function getItemDefinition(id: string): ItemDefinition {
  const definition = ITEM_REGISTRY.get(id);
  if (definition === undefined) throw new RangeError(`Unknown item id: ${id}`);
  return definition;
}

export function tryGetItemDefinition(id: string): ItemDefinition | undefined {
  return ITEM_REGISTRY.get(id);
}

export function isKnownItemId(id: string): boolean {
  return ITEM_REGISTRY.has(id);
}

export function itemHasTag(itemId: string, tag: string): boolean {
  return ITEM_REGISTRY.get(itemId)?.tags?.includes(tag) ?? false;
}

export function getItemsWithTag(tag: string): readonly ItemDefinition[] {
  return ITEMS.filter((definition) => definition.tags?.includes(tag) ?? false);
}

export function getBlockItemId(blockId: BlockId): string | undefined {
  return ITEMS.find((definition) => definition.kind === 'block' && definition.blockId === blockId)?.id;
}

export function isItemObtainable(itemOrId: string | ItemDefinition): boolean {
  const item = typeof itemOrId === 'string' ? ITEM_REGISTRY.get(itemOrId) : itemOrId;
  return item !== undefined && item.hiddenFromGameplay !== true;
}

export function obtainableItems(): readonly ItemDefinition[] {
  return ITEMS.filter((item) => item.hiddenFromGameplay !== true);
}
