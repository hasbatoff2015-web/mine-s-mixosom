export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears';

export type ToolTier = 'hand' | 'wood' | 'stone' | 'iron' | 'diamond';

export interface BlockTextures {
  readonly all?: string;
  readonly top?: string;
  readonly bottom?: string;
  readonly side?: string;
  readonly front?: string;
}

export interface BlockDrop {
  readonly item: string;
  readonly count?: number;
  readonly min?: number;
  readonly max?: number;
  readonly requiresCorrectTool?: boolean;
  readonly silkTouchItem?: string;
}

export type BlockCategory =
  | 'air'
  | 'terrain'
  | 'wood'
  | 'ore'
  | 'building'
  | 'decoration'
  | 'utility'
  | 'wool'
  | 'redstone'
  | 'liquid';

export interface BlockDefinition {
  readonly id: BlockId;
  readonly key: string;
  readonly name: string;
  readonly category: BlockCategory;
  readonly hardness: number;
  readonly solid: boolean;
  readonly opaque: boolean;
  readonly tool?: ToolType;
  readonly tier?: ToolTier;
  readonly drop?: BlockDrop;
  readonly textures: BlockTextures;
  readonly emission?: number;
  readonly flammable?: boolean;
  readonly gravity?: boolean;
  readonly replaceable?: boolean;
  readonly liquid?: boolean;
  readonly breakable?: boolean;
  readonly hasItem?: boolean;
  readonly redstonePower?: number;
  /** Damage dealt by contact; consumed by the survival/collision system. */
  readonly contactDamage?: number;
}

/** Stable numeric IDs intended for compact chunk storage and network saves. */
export enum BlockId {
  Air = 0,
  Stone = 1,
  GrassBlock = 2,
  Dirt = 3,
  Cobblestone = 4,
  Bedrock = 5,
  Sand = 6,
  Gravel = 7,
  Clay = 8,
  SnowBlock = 9,
  Ice = 10,
  Water = 11,
  Lava = 12,
  Sandstone = 13,
  Cactus = 14,

  OakLog = 16,
  BirchLog = 17,
  SpruceLog = 18,
  OakLeaves = 19,
  BirchLeaves = 20,
  SpruceLeaves = 21,
  OakPlanks = 22,
  BirchPlanks = 23,
  SprucePlanks = 24,

  CoalOre = 32,
  IronOre = 33,
  GoldOre = 34,
  DiamondOre = 35,
  RedstoneOre = 38,

  Glass = 48,
  Bricks = 49,
  StoneBricks = 50,
  Bookshelf = 51,
  Obsidian = 52,

  CraftingTable = 64,
  Chest = 65,
  Furnace = 66,
  Torch = 67,
  Ladder = 68,
  WhiteBed = 69,
  OakDoor = 70,

  WhiteWool = 80,
  OrangeWool = 81,
  MagentaWool = 82,
  LightBlueWool = 83,
  YellowWool = 84,
  LimeWool = 85,
  PinkWool = 86,
  GrayWool = 87,
  LightGrayWool = 88,
  CyanWool = 89,
  PurpleWool = 90,
  BlueWool = 91,
  BrownWool = 92,
  GreenWool = 93,
  RedWool = 94,
  BlackWool = 95,

  RedstoneWire = 104,
  RedstoneTorch = 105,
  Lever = 106,
  StoneButton = 107,
  OakPressurePlate = 108,
  Tnt = 109,

  OakSlab = 120,
  StoneSlab = 121,
  CobblestoneSlab = 122,
  OakStairs = 123,
  StoneStairs = 124,
  CobblestoneStairs = 125,
}
