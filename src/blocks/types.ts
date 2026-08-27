export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears';

export type ToolTier = 'hand' | 'wood' | 'stone' | 'iron' | 'diamond';

export type BlockRenderLayer = 'opaque' | 'cutout' | 'translucent';

/** How Lambert/scene lights should treat this block's mesh normals. */
export type BlockLightingMode = 'standard' | 'vegetation';

/** Optional biome grass-color multiply, independent of texture-name heuristics. */
export type BlockBiomeTint = 'grass';

export type BlockRenderShape =
  | 'cube'
  | 'torch'
  | 'wire'
  | 'lever'
  | 'button'
  | 'pressure_plate'
  | 'cross'
  | 'fire'
  | 'door'
  | 'ladder'
  | 'stairs'
  | 'slab'
  | 'chest'
  | 'fence'
  | 'rail';

export type RailShape =
  | 'north_south'
  | 'east_west'
  | 'north_east'
  | 'north_west'
  | 'south_east'
  | 'south_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'ascending_east'
  | 'ascending_west';

export type DoorHalf = 'lower' | 'upper';
export type DoorHinge = 'left' | 'right';
export type SlabType = 'bottom' | 'top' | 'double';
export type StairHalf = 'bottom' | 'top';
export type StairShape = 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right';
export type PressurePlateTrigger = 'all' | 'living';

export type TranslucentMaterial = 'glass' | 'water';
export type BlockAttachment = 'floor' | 'wall' | 'ceiling';
export type HorizontalFacing = 'north' | 'south' | 'east' | 'west';

/** Runtime-only visual state resolved independently from the numeric block ID. */
export interface BlockRenderState {
  readonly powered?: boolean;
  readonly power?: number;
  readonly attachment?: BlockAttachment;
  readonly facing?: HorizontalFacing;
  readonly open?: boolean;
  readonly half?: DoorHalf;
  readonly hinge?: DoorHinge;
  /** Independent of door `half`. Missing in old saves → bottom. */
  readonly slabType?: SlabType;
  /** Independent of door `half`. Missing in old saves → bottom. */
  readonly stairHalf?: StairHalf;
  /**
   * Fluid depth. Missing on water/lava → source (8). Flowing water 1–7,
   * flowing lava typically 2/4/6. Old saves stay sources.
   */
  readonly fluidLevel?: number;
  readonly fluidFalling?: boolean;
  readonly railShape?: RailShape;
}

export interface BlockTextures {
  readonly all?: string;
  readonly top?: string;
  readonly bottom?: string;
  readonly side?: string;
  readonly front?: string;
  /** Burning furnace (and similar) front face. Not used as default cube front. */
  readonly litFront?: string;
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
  /** Light/visibility property retained independently from material selection. */
  readonly opaque: boolean;
  /** Whether a full cube face behind this block may be culled. */
  readonly occludesFaces: boolean;
  readonly renderLayer: BlockRenderLayer;
  readonly renderShape: BlockRenderShape;
  readonly lightingMode?: BlockLightingMode;
  readonly biomeTint?: BlockBiomeTint;
  readonly translucentMaterial?: TranslucentMaterial;
  readonly tool?: ToolType;
  readonly tier?: ToolTier;
  readonly drop?: BlockDrop;
  readonly textures: BlockTextures;
  readonly emission?: number;
  readonly flammable?: boolean;
  readonly gravity?: boolean;
  readonly replaceable?: boolean;
  /** Fluid displacement is independent from placement replacement / solidity. */
  readonly fluidDisplaceable?: boolean;
  readonly liquid?: boolean;
  readonly breakable?: boolean;
  readonly hasItem?: boolean;
  readonly redstonePower?: number;
  /** Damage dealt by contact; consumed by the survival/collision system. */
  readonly contactDamage?: number;
  /**
   * Hidden from Creative/recipes/obtainable UI. Numeric ID stays for old saves.
   * Copied onto the matching block item when `hasItem !== false`.
   */
  readonly hiddenFromGameplay?: boolean;
  readonly pressurePlateTrigger?: PressurePlateTrigger;
}

export function blockLightingMode(
  definition: Pick<BlockDefinition, 'lightingMode' | 'renderShape'>,
): BlockLightingMode {
  return definition.lightingMode ?? (definition.renderShape === 'cross' ? 'vegetation' : 'standard');
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
  StonePressurePlate = 110,

  OakSlab = 120,
  StoneSlab = 121,
  CobblestoneSlab = 122,
  OakStairs = 123,
  StoneStairs = 124,
  CobblestoneStairs = 125,
  BirchSlab = 126,
  SpruceSlab = 127,
  BrickSlab = 128,
  StoneBrickSlab = 129,

  TallGrass = 130,
  Fern = 131,
  Dandelion = 132,
  Poppy = 133,
  OxeyeDaisy = 134,
  DeadBush = 135,

  BirchStairs = 136,
  SpruceStairs = 137,
  BrickStairs = 138,
  StoneBrickStairs = 139,

  Fire = 140,
  Cobweb = 141,
  OakFence = 142,
  BirchFence = 143,
  SpruceFence = 144,
  Rail = 145,
}
