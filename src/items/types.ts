import type { BlockId } from '../blocks';

export type ItemId = string;

export type ItemKind = 'block' | 'resource' | 'food' | 'tool' | 'weapon' | 'shield' | 'armor';
export type ItemToolType = 'pickaxe' | 'axe' | 'shovel';
export type ItemTier = 'wood' | 'stone' | 'iron' | 'diamond';
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';

export interface BaseItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly kind: ItemKind;
  readonly maxStack: number;
  readonly texture: string;
  readonly tags?: readonly string[];
  /** Optional block placed by using the item. */
  readonly placesBlockId?: BlockId;
  /**
   * Hidden from Creative catalog, recipes and other obtainable UI.
   * The registry entry may remain for combat/tests/old saves.
   */
  readonly hiddenFromGameplay?: boolean;
}

export interface BlockItemDefinition extends BaseItemDefinition {
  readonly kind: 'block';
  readonly blockId: BlockId;
  readonly maxStack: 64;
}

export interface ResourceItemDefinition extends BaseItemDefinition {
  readonly kind: 'resource';
}

export interface FoodProperties {
  readonly nutrition: number;
  readonly saturation: number;
  readonly alwaysEdible?: boolean;
}

export interface FoodItemDefinition extends BaseItemDefinition {
  readonly kind: 'food';
  readonly food: FoodProperties;
}

export interface ToolItemDefinition extends BaseItemDefinition {
  readonly kind: 'tool';
  readonly maxStack: 1;
  readonly tool: ItemToolType;
  readonly tier: ItemTier;
  readonly durability: number;
  readonly miningSpeed: number;
  readonly attackDamage: number;
  /** Fully charged melee attacks per second (Java 1.9-style cooldown input). */
  readonly attackSpeed: number;
}

export interface WeaponItemDefinition extends BaseItemDefinition {
  readonly kind: 'weapon';
  readonly maxStack: 1;
  readonly weapon: 'sword' | 'bow';
  readonly durability: number;
  readonly attackDamage: number;
  readonly attackSpeed: number;
  readonly tier?: ItemTier;
}

export interface ShieldItemDefinition extends BaseItemDefinition {
  readonly kind: 'shield';
  readonly maxStack: 1;
  readonly durability: number;
}

export interface ArmorItemDefinition extends BaseItemDefinition {
  readonly kind: 'armor';
  readonly maxStack: 1;
  readonly slot: ArmorSlot;
  readonly material: 'leather' | 'iron' | 'gold' | 'diamond';
  readonly durability: number;
  readonly defense: number;
  readonly toughness: number;
}

export type ItemDefinition =
  | BlockItemDefinition
  | ResourceItemDefinition
  | FoodItemDefinition
  | ToolItemDefinition
  | WeaponItemDefinition
  | ShieldItemDefinition
  | ArmorItemDefinition;

/** Common non-block item keys. Block items use their block key (for example `stone`). */
export const ItemId = Object.freeze({
  Stick: 'stick',
  Coal: 'coal',
  Charcoal: 'charcoal',
  IronIngot: 'iron_ingot',
  GoldIngot: 'gold_ingot',
  Diamond: 'diamond',
  RedstoneDust: 'redstone_dust',
  Flint: 'flint',
  ClayBall: 'clay_ball',
  Brick: 'brick',
  String: 'string',
  Feather: 'feather',
  Leather: 'leather',
  Gunpowder: 'gunpowder',
  Book: 'book',
  Arrow: 'arrow',

  Apple: 'apple',
  Bread: 'bread',
  Beef: 'beef',
  CookedBeef: 'cooked_beef',
  Porkchop: 'porkchop',
  CookedPorkchop: 'cooked_porkchop',
  Chicken: 'chicken',
  CookedChicken: 'cooked_chicken',

  WoodenPickaxe: 'wooden_pickaxe',
  WoodenAxe: 'wooden_axe',
  WoodenShovel: 'wooden_shovel',
  StonePickaxe: 'stone_pickaxe',
  StoneAxe: 'stone_axe',
  StoneShovel: 'stone_shovel',
  IronPickaxe: 'iron_pickaxe',
  IronAxe: 'iron_axe',
  IronShovel: 'iron_shovel',
  DiamondPickaxe: 'diamond_pickaxe',
  DiamondAxe: 'diamond_axe',
  DiamondShovel: 'diamond_shovel',

  WoodenSword: 'wooden_sword',
  StoneSword: 'stone_sword',
  IronSword: 'iron_sword',
  DiamondSword: 'diamond_sword',
  Bow: 'bow',
  Shield: 'shield',

  LeatherHelmet: 'leather_helmet',
  LeatherChestplate: 'leather_chestplate',
  LeatherLeggings: 'leather_leggings',
  LeatherBoots: 'leather_boots',
  IronHelmet: 'iron_helmet',
  IronChestplate: 'iron_chestplate',
  IronLeggings: 'iron_leggings',
  IronBoots: 'iron_boots',
  GoldHelmet: 'gold_helmet',
  GoldChestplate: 'gold_chestplate',
  GoldLeggings: 'gold_leggings',
  GoldBoots: 'gold_boots',
  DiamondHelmet: 'diamond_helmet',
  DiamondChestplate: 'diamond_chestplate',
  DiamondLeggings: 'diamond_leggings',
  DiamondBoots: 'diamond_boots',
} as const);
