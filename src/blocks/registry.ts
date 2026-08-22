import {
  BlockId,
  type BlockBiomeTint,
  type BlockCategory,
  type BlockDefinition,
  type BlockDrop,
  type BlockLightingMode,
  type BlockTextures,
  type BlockRenderLayer,
  type BlockRenderShape,
  type TranslucentMaterial,
  type ToolTier,
  type ToolType,
  type PressurePlateTrigger,
} from './types';
import { BLOCK_FAMILIES } from './blockFamilies';

interface BlockOptions {
  category?: BlockCategory;
  hardness?: number;
  solid?: boolean;
  opaque?: boolean;
  occludesFaces?: boolean;
  renderLayer?: BlockRenderLayer;
  renderShape?: BlockRenderShape;
  lightingMode?: BlockLightingMode;
  biomeTint?: BlockBiomeTint;
  translucentMaterial?: TranslucentMaterial;
  tool?: ToolType;
  tier?: ToolTier;
  drop?: BlockDrop | false;
  textures?: BlockTextures;
  emission?: number;
  flammable?: boolean;
  gravity?: boolean;
  replaceable?: boolean;
  liquid?: boolean;
  breakable?: boolean;
  hasItem?: boolean;
  redstonePower?: number;
  contactDamage?: number;
  hiddenFromGameplay?: boolean;
  pressurePlateTrigger?: PressurePlateTrigger;
}

const title = (key: string): string =>
  key.replace(/(^|_)([a-z])/g, (_match, separator: string, letter: string) =>
    `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  );

function block(id: BlockId, key: string, options: BlockOptions = {}): BlockDefinition {
  const drop = options.drop === false
    ? undefined
    : options.drop ?? { item: key, count: 1 };

  const renderShape = options.renderShape ?? 'cube';
  const lightingMode = options.lightingMode ?? (renderShape === 'cross' ? 'vegetation' : undefined);

  return Object.freeze({
    id,
    key,
    name: title(key),
    category: options.category ?? 'building',
    hardness: options.hardness ?? 1,
    solid: options.solid ?? true,
    opaque: options.opaque ?? true,
    occludesFaces: options.occludesFaces ?? options.opaque ?? true,
    renderLayer: options.renderLayer ?? 'opaque',
    renderShape,
    ...(lightingMode === undefined ? {} : { lightingMode }),
    ...(options.biomeTint === undefined ? {} : { biomeTint: options.biomeTint }),
    textures: Object.freeze(options.textures ?? { all: `block/${key}` }),
    ...(options.tool === undefined ? {} : { tool: options.tool }),
    ...(options.tier === undefined ? {} : { tier: options.tier }),
    ...(drop === undefined ? {} : { drop: Object.freeze(drop) }),
    ...(options.emission === undefined ? {} : { emission: options.emission }),
    ...(options.flammable === undefined ? {} : { flammable: options.flammable }),
    ...(options.gravity === undefined ? {} : { gravity: options.gravity }),
    ...(options.replaceable === undefined ? {} : { replaceable: options.replaceable }),
    ...(options.liquid === undefined ? {} : { liquid: options.liquid }),
    ...(options.breakable === undefined ? {} : { breakable: options.breakable }),
    ...(options.hasItem === undefined ? {} : { hasItem: options.hasItem }),
    ...(options.redstonePower === undefined ? {} : { redstonePower: options.redstonePower }),
    ...(options.contactDamage === undefined ? {} : { contactDamage: options.contactDamage }),
    ...(options.translucentMaterial === undefined ? {} : { translucentMaterial: options.translucentMaterial }),
    ...(options.hiddenFromGameplay === undefined ? {} : { hiddenFromGameplay: options.hiddenFromGameplay }),
    ...(options.pressurePlateTrigger === undefined ? {} : { pressurePlateTrigger: options.pressurePlateTrigger }),
  });
}

const stone = (
  id: BlockId,
  key: string,
  hardness: number,
  tier: ToolTier = 'wood',
  category: BlockCategory = 'terrain',
): BlockDefinition => block(id, key, {
  category,
  hardness,
  tool: 'pickaxe',
  tier,
  drop: { item: key, count: 1, requiresCorrectTool: true },
});

const wood = (id: BlockId, key: string, textures?: BlockTextures): BlockDefinition =>
  block(id, key, {
    category: 'wood',
    hardness: 2,
    tool: 'axe',
    tier: 'hand',
    flammable: true,
    ...(textures === undefined ? {} : { textures }),
  });

const ore = (
  id: BlockId,
  key: string,
  tier: ToolTier,
  hardness = 3,
  min = 1,
  max = min,
  item = key,
): BlockDefinition => block(id, key, {
  category: 'ore',
  hardness,
  tool: 'pickaxe',
  tier,
  drop: { item, min, max, requiresCorrectTool: true, silkTouchItem: key },
});

const woolColors = [
  ['white', BlockId.WhiteWool],
  ['orange', BlockId.OrangeWool],
  ['magenta', BlockId.MagentaWool],
  ['light_blue', BlockId.LightBlueWool],
  ['yellow', BlockId.YellowWool],
  ['lime', BlockId.LimeWool],
  ['pink', BlockId.PinkWool],
  ['gray', BlockId.GrayWool],
  ['light_gray', BlockId.LightGrayWool],
  ['cyan', BlockId.CyanWool],
  ['purple', BlockId.PurpleWool],
  ['blue', BlockId.BlueWool],
  ['brown', BlockId.BrownWool],
  ['green', BlockId.GreenWool],
  ['red', BlockId.RedWool],
  ['black', BlockId.BlackWool],
] as const;

const woolBlocks = woolColors.map(([color, id]) => block(id, `${color}_wool`, {
  category: 'wool',
  hardness: 0.8,
  tool: 'shears',
  tier: 'hand',
  flammable: true,
}));

export const BLOCKS: readonly BlockDefinition[] = Object.freeze([
  block(BlockId.Air, 'air', {
    category: 'air', hardness: 0, solid: false, opaque: false, drop: false,
    textures: { all: 'block/air' }, replaceable: true, breakable: false, hasItem: false,
  }),
  block(BlockId.Stone, 'stone', {
    category: 'terrain', hardness: 1.5, tool: 'pickaxe', tier: 'wood',
    drop: { item: 'cobblestone', count: 1, requiresCorrectTool: true, silkTouchItem: 'stone' },
  }),
  block(BlockId.GrassBlock, 'grass_block', {
    category: 'terrain', hardness: 0.6, tool: 'shovel', tier: 'hand',
    drop: { item: 'dirt' },
    textures: { top: 'block/grass_block_top', side: 'block/grass_block_side', bottom: 'block/dirt' },
  }),
  block(BlockId.Dirt, 'dirt', { category: 'terrain', hardness: 0.5, tool: 'shovel', tier: 'hand' }),
  stone(BlockId.Cobblestone, 'cobblestone', 2),
  block(BlockId.Bedrock, 'bedrock', {
    category: 'terrain', hardness: -1, drop: false, breakable: false,
  }),
  block(BlockId.Sand, 'sand', { category: 'terrain', hardness: 0.5, tool: 'shovel', tier: 'hand', gravity: true }),
  block(BlockId.Gravel, 'gravel', {
    category: 'terrain', hardness: 0.6, tool: 'shovel', tier: 'hand', gravity: true,
    drop: { item: 'gravel', count: 1 },
  }),
  block(BlockId.Clay, 'clay', {
    category: 'terrain', hardness: 0.6, tool: 'shovel', tier: 'hand',
    drop: { item: 'clay_ball', min: 4, max: 4 },
  }),
  block(BlockId.SnowBlock, 'snow_block', { category: 'terrain', hardness: 0.2, tool: 'shovel', tier: 'hand' }),
  block(BlockId.Ice, 'ice', {
    category: 'terrain', hardness: 0.5, opaque: false, drop: false,
    renderLayer: 'translucent', translucentMaterial: 'glass',
  }),
  block(BlockId.Water, 'water', {
    category: 'liquid', hardness: -1, solid: false, opaque: false, drop: false,
    liquid: true, replaceable: true, breakable: false, hasItem: false,
    renderLayer: 'translucent', translucentMaterial: 'water',
  }),
  block(BlockId.Lava, 'lava', {
    category: 'liquid', hardness: -1, solid: false, opaque: false, drop: false,
    liquid: true, replaceable: true, breakable: false, hasItem: false, emission: 15,
  }),
  block(BlockId.Sandstone, 'sandstone', {
    category: 'terrain', hardness: 0.8, tool: 'pickaxe', tier: 'wood',
    drop: { item: 'sandstone', count: 1, requiresCorrectTool: true },
    textures: { all: 'block/sandstone' },
  }),
  block(BlockId.Cactus, 'cactus', {
    category: 'terrain', hardness: 0.4, opaque: false, contactDamage: 1,
    textures: { top: 'block/cactus_top', bottom: 'block/cactus', side: 'block/cactus' },
  }),

  wood(BlockId.OakLog, 'oak_log', { top: 'block/oak_log_top', bottom: 'block/oak_log_top', side: 'block/oak_log' }),
  wood(BlockId.BirchLog, 'birch_log', { top: 'block/birch_log_top', bottom: 'block/birch_log_top', side: 'block/birch_log' }),
  wood(BlockId.SpruceLog, 'spruce_log', { top: 'block/spruce_log_top', bottom: 'block/spruce_log_top', side: 'block/spruce_log' }),
  block(BlockId.OakLeaves, 'oak_leaves', { category: 'wood', hardness: 0.2, opaque: false, renderLayer: 'cutout', tool: 'shears', tier: 'hand', flammable: true }),
  block(BlockId.BirchLeaves, 'birch_leaves', { category: 'wood', hardness: 0.2, opaque: false, renderLayer: 'cutout', tool: 'shears', tier: 'hand', flammable: true }),
  block(BlockId.SpruceLeaves, 'spruce_leaves', { category: 'wood', hardness: 0.2, opaque: false, renderLayer: 'cutout', tool: 'shears', tier: 'hand', flammable: true }),
  wood(BlockId.OakPlanks, 'oak_planks'),
  wood(BlockId.BirchPlanks, 'birch_planks'),
  wood(BlockId.SprucePlanks, 'spruce_planks'),

  ore(BlockId.CoalOre, 'coal_ore', 'wood', 3, 1, 1, 'coal'),
  ore(BlockId.IronOre, 'iron_ore', 'stone'),
  ore(BlockId.GoldOre, 'gold_ore', 'iron'),
  ore(BlockId.DiamondOre, 'diamond_ore', 'iron', 3, 1, 1, 'diamond'),
  ore(BlockId.RedstoneOre, 'redstone_ore', 'iron', 3, 4, 5, 'redstone_dust'),

  block(BlockId.Glass, 'glass', {
    category: 'building', hardness: 0.3, opaque: false, drop: false,
    renderLayer: 'translucent', translucentMaterial: 'glass',
  }),
  stone(BlockId.Bricks, 'bricks', 2, 'wood', 'building'),
  stone(BlockId.StoneBricks, 'stone_bricks', 1.5, 'wood', 'building'),
  block(BlockId.Bookshelf, 'bookshelf', { category: 'decoration', hardness: 1.5, tool: 'axe', tier: 'hand', flammable: true, drop: { item: 'book', count: 3 } }),
  stone(BlockId.Obsidian, 'obsidian', 50, 'diamond', 'building'),

  block(BlockId.CraftingTable, 'crafting_table', {
    category: 'utility', hardness: 2.5, tool: 'axe', tier: 'hand', flammable: true,
    textures: { top: 'block/crafting_table_top', bottom: 'block/oak_planks', side: 'block/crafting_table_side', front: 'block/crafting_table' },
  }),
  block(BlockId.Chest, 'chest', {
    category: 'utility', hardness: 2.5, tool: 'axe', tier: 'hand', flammable: true,
    opaque: false, occludesFaces: false, renderShape: 'chest',
  }),
  block(BlockId.Furnace, 'furnace', {
    category: 'utility', hardness: 3.5, tool: 'pickaxe', tier: 'wood',
    drop: { item: 'furnace', count: 1, requiresCorrectTool: true },
    textures: {
      top: 'block/furnace_top',
      bottom: 'block/furnace_top',
      side: 'block/furnace_side',
      front: 'block/furnace_front',
      litFront: 'block/furnace_front_on',
    },
  }),
  block(BlockId.Torch, 'torch', {
    category: 'utility', hardness: 0, solid: false, opaque: false, emission: 14,
    renderLayer: 'cutout', renderShape: 'torch',
  }),
  block(BlockId.Ladder, 'ladder', {
    category: 'utility', hardness: 0.4, solid: false, opaque: false,
    renderLayer: 'cutout', renderShape: 'ladder', occludesFaces: false,
    tool: 'axe', tier: 'hand', flammable: true,
  }),
  block(BlockId.WhiteBed, 'white_bed', { category: 'utility', hardness: 0.2, opaque: false, tool: 'axe', tier: 'hand', flammable: true }),
  block(BlockId.OakDoor, 'oak_door', {
    category: 'utility', hardness: 3, opaque: false, tool: 'axe', tier: 'hand',
    flammable: true, renderLayer: 'cutout', renderShape: 'door', occludesFaces: false,
    textures: { all: 'block/oak_door', bottom: 'block/oak_door', top: 'block/oak_door_upper' },
  }),

  ...woolBlocks,

  block(BlockId.RedstoneWire, 'redstone_wire', {
    category: 'redstone', hardness: 0, solid: false, opaque: false,
    drop: { item: 'redstone_dust' }, hasItem: false,
    renderLayer: 'cutout', renderShape: 'wire',
  }),
  block(BlockId.RedstoneTorch, 'redstone_torch', {
    category: 'redstone', hardness: 0, solid: false, opaque: false, emission: 7, redstonePower: 15,
    renderLayer: 'cutout', renderShape: 'torch',
  }),
  block(BlockId.Lever, 'lever', {
    category: 'redstone', hardness: 0.5, solid: false, opaque: false, redstonePower: 15,
    renderLayer: 'cutout', renderShape: 'lever',
  }),
  block(BlockId.StoneButton, 'stone_button', {
    category: 'redstone', hardness: 0.5, solid: false, opaque: false, tool: 'pickaxe', tier: 'hand', redstonePower: 15,
    renderShape: 'button',
  }),
  block(BlockId.OakPressurePlate, 'oak_pressure_plate', {
    category: 'redstone', hardness: 0.5, solid: false, opaque: false, tool: 'axe', tier: 'hand', flammable: true, redstonePower: 15,
    renderShape: 'pressure_plate', pressurePlateTrigger: 'all',
    textures: { all: 'block/oak_planks' },
  }),
  block(BlockId.StonePressurePlate, 'stone_pressure_plate', {
    category: 'redstone', hardness: 0.5, solid: false, opaque: false, tool: 'pickaxe', tier: 'hand', redstonePower: 15,
    renderShape: 'pressure_plate', pressurePlateTrigger: 'living',
    textures: { all: 'block/stone' },
  }),
  block(BlockId.Tnt, 'tnt', {
    category: 'redstone', hardness: 0, flammable: true,
    textures: { all: 'block/tnt' },
  }),

  ...BLOCK_FAMILIES.flatMap((family) => {
    const shaped: BlockDefinition[] = [];
    if (family.slabId !== undefined) {
      shaped.push(block(family.slabId, `${family.key}_slab`, {
        category: 'building',
        hardness: family.hardness,
        opaque: false,
        occludesFaces: false,
        tool: family.tool,
        tier: family.tier,
        flammable: family.flammable,
        renderShape: 'slab',
        textures: { all: family.texture },
        drop: {
          item: `${family.key}_slab`,
          count: 1,
          ...(family.requiresCorrectTool ? { requiresCorrectTool: true } : {}),
        },
      }));
    }
    if (family.stairId !== undefined) {
      shaped.push(block(family.stairId, `${family.key}_stairs`, {
        category: 'building',
        hardness: family.hardness,
        opaque: false,
        occludesFaces: false,
        tool: family.tool,
        tier: family.tier,
        flammable: family.flammable,
        renderShape: 'stairs',
        textures: { all: family.texture },
        hiddenFromGameplay: family.hideStairs === true,
        drop: {
          item: `${family.key}_stairs`,
          count: 1,
          ...(family.requiresCorrectTool ? { requiresCorrectTool: true } : {}),
        },
      }));
    }
    return shaped;
  }),

  block(BlockId.TallGrass, 'tall_grass', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation', biomeTint: 'grass',
    replaceable: true, drop: false, hasItem: false,
  }),
  block(BlockId.Fern, 'fern', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation', biomeTint: 'grass',
    replaceable: true, drop: false, hasItem: false,
  }),
  block(BlockId.Dandelion, 'dandelion', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation',
    replaceable: true, drop: false, hasItem: false,
  }),
  block(BlockId.Poppy, 'poppy', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation',
    replaceable: true, drop: false, hasItem: false,
  }),
  block(BlockId.OxeyeDaisy, 'oxeye_daisy', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation',
    replaceable: true, drop: false, hasItem: false,
  }),
  block(BlockId.DeadBush, 'dead_bush', {
    category: 'decoration', hardness: 0, solid: false, opaque: false, occludesFaces: false,
    renderLayer: 'cutout', renderShape: 'cross', lightingMode: 'vegetation',
    replaceable: true, drop: false, hasItem: false,
  }),
]);

function buildRegistry<K>(keyOf: (definition: BlockDefinition) => K): ReadonlyMap<K, BlockDefinition> {
  const registry = new Map<K, BlockDefinition>();
  for (const definition of BLOCKS) {
    const key = keyOf(definition);
    if (registry.has(key)) throw new Error(`Duplicate block registry key: ${String(key)}`);
    registry.set(key, definition);
  }
  return registry;
}

export const BLOCK_REGISTRY = buildRegistry((definition) => definition.id);
export const BLOCKS_BY_KEY = buildRegistry((definition) => definition.key);
const BLOCK_DEFINITIONS_BY_ID: readonly (BlockDefinition | undefined)[] = (() => {
  const definitions: Array<BlockDefinition | undefined> = [];
  for (const definition of BLOCKS) definitions[definition.id] = definition;
  return definitions;
})();

export function getBlockDefinition(id: BlockId): BlockDefinition {
  const definition = BLOCK_DEFINITIONS_BY_ID[id];
  if (definition === undefined) throw new RangeError(`Unknown block id: ${id}`);
  return definition;
}

export function getBlockByKey(key: string): BlockDefinition | undefined {
  return BLOCKS_BY_KEY.get(key);
}

export function isKnownBlockId(id: number): id is BlockId {
  return BLOCK_REGISTRY.has(id as BlockId);
}

/** Canonical torch light level. Lit furnace uses this instead of a copied constant. */
export function torchBlockEmission(): number {
  return getBlockDefinition(BlockId.Torch).emission ?? 0;
}
