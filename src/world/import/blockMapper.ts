import {
  BlockId,
  getBlockByKey,
  getBlockDefinition,
  type BlockRenderState,
  type DoorHinge,
  type HorizontalFacing,
  type RailShape,
  type SlabType,
  type StairHalf,
} from '../../blocks';

export interface ParsedMinecraftBlock {
  readonly namespaced: string;
  readonly name: string;
  readonly states: Readonly<Record<string, string>>;
}

export interface MappedFrontierBlock {
  readonly block: BlockId;
  readonly state?: BlockRenderState;
  readonly supported: boolean;
  readonly namespaced: string;
}

const HORIZONTAL: ReadonlySet<string> = new Set(['north', 'south', 'east', 'west']);
const RAIL_SHAPES: ReadonlySet<RailShape> = new Set([
  'north_south', 'east_west', 'north_east', 'north_west', 'south_east', 'south_west',
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
]);

/**
 * Names that are the same Frontier block under a different Minecraft id.
 * Unknown ids are NOT listed here — they become Diamond Block.
 */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  air: 'air',
  cave_air: 'air',
  void_air: 'air',
  grass: 'grass_block',
  grass_block: 'grass_block',
  dirt: 'dirt',
  coarse_dirt: 'dirt',
  stone: 'stone',
  cobblestone: 'cobblestone',
  cobble: 'cobblestone',
  bedrock: 'bedrock',
  sand: 'sand',
  gravel: 'gravel',
  clay: 'clay',
  snow: 'snow_block',
  snow_block: 'snow_block',
  ice: 'ice',
  packed_ice: 'ice',
  water: 'water',
  flowing_water: 'water',
  lava: 'lava',
  flowing_lava: 'lava',
  sandstone: 'sandstone',
  cactus: 'cactus',
  log: 'oak_log',
  log2: 'oak_log',
  oak_log: 'oak_log',
  birch_log: 'birch_log',
  spruce_log: 'spruce_log',
  oak_wood: 'oak_log',
  birch_wood: 'birch_log',
  spruce_wood: 'spruce_log',
  leaves: 'oak_leaves',
  leaves2: 'oak_leaves',
  oak_leaves: 'oak_leaves',
  birch_leaves: 'birch_leaves',
  spruce_leaves: 'spruce_leaves',
  planks: 'oak_planks',
  oak_planks: 'oak_planks',
  birch_planks: 'birch_planks',
  spruce_planks: 'spruce_planks',
  wood: 'oak_planks',
  coal_ore: 'coal_ore',
  iron_ore: 'iron_ore',
  gold_ore: 'gold_ore',
  diamond_ore: 'diamond_ore',
  redstone_ore: 'redstone_ore',
  lit_redstone_ore: 'redstone_ore',
  glowing_redstone_ore: 'redstone_ore',
  glass: 'glass',
  brick_block: 'bricks',
  bricks: 'bricks',
  stonebrick: 'stone_bricks',
  stone_bricks: 'stone_bricks',
  bookshelf: 'bookshelf',
  obsidian: 'obsidian',
  crafting_table: 'crafting_table',
  workbench: 'crafting_table',
  chest: 'chest',
  trapped_chest: 'chest',
  furnace: 'furnace',
  lit_furnace: 'furnace',
  torch: 'torch',
  wall_torch: 'torch',
  redstone_torch: 'redstone_torch',
  unlit_redstone_torch: 'redstone_torch',
  redstone_wall_torch: 'redstone_torch',
  ladder: 'ladder',
  bed: 'white_bed',
  white_bed: 'white_bed',
  wooden_door: 'oak_door',
  oak_door: 'oak_door',
  wool: 'white_wool',
  white_wool: 'white_wool',
  orange_wool: 'orange_wool',
  magenta_wool: 'magenta_wool',
  light_blue_wool: 'light_blue_wool',
  yellow_wool: 'yellow_wool',
  lime_wool: 'lime_wool',
  pink_wool: 'pink_wool',
  gray_wool: 'gray_wool',
  light_gray_wool: 'light_gray_wool',
  silver_wool: 'light_gray_wool',
  cyan_wool: 'cyan_wool',
  purple_wool: 'purple_wool',
  blue_wool: 'blue_wool',
  brown_wool: 'brown_wool',
  green_wool: 'green_wool',
  red_wool: 'red_wool',
  black_wool: 'black_wool',
  redstone_wire: 'redstone_wire',
  redstone: 'redstone_wire',
  lever: 'lever',
  stone_button: 'stone_button',
  wooden_pressure_plate: 'oak_pressure_plate',
  oak_pressure_plate: 'oak_pressure_plate',
  stone_pressure_plate: 'stone_pressure_plate',
  tnt: 'tnt',
  fire: 'fire',
  web: 'cobweb',
  cobweb: 'cobweb',
  rail: 'rail',
  glowstone: 'glowstone',
  lantern: 'lantern',
  chain: 'chain',
  oak_slab: 'oak_slab',
  wooden_slab: 'oak_slab',
  birch_slab: 'birch_slab',
  spruce_slab: 'spruce_slab',
  stone_slab: 'stone_slab',
  cobblestone_slab: 'cobblestone_slab',
  brick_slab: 'brick_slab',
  stone_brick_slab: 'stone_brick_slab',
  oak_stairs: 'oak_stairs',
  birch_stairs: 'birch_stairs',
  spruce_stairs: 'spruce_stairs',
  stone_stairs: 'cobblestone_stairs',
  cobblestone_stairs: 'cobblestone_stairs',
  brick_stairs: 'brick_stairs',
  stone_brick_stairs: 'stone_brick_stairs',
  fence: 'oak_fence',
  oak_fence: 'oak_fence',
  birch_fence: 'birch_fence',
  spruce_fence: 'spruce_fence',
  tallgrass: 'tall_grass',
  tall_grass: 'tall_grass',
  short_grass: 'tall_grass',
  fern: 'fern',
  yellow_flower: 'dandelion',
  dandelion: 'dandelion',
  red_flower: 'poppy',
  poppy: 'poppy',
  oxeye_daisy: 'oxeye_daisy',
  deadbush: 'dead_bush',
  dead_bush: 'dead_bush',
  diamond_block: 'diamond_block',
});

const VARIANT_WOOD: Readonly<Record<string, string>> = Object.freeze({
  oak: 'oak',
  birch: 'birch',
  spruce: 'spruce',
  default: 'oak',
});

export function parseMinecraftBlockId(raw: string): ParsedMinecraftBlock {
  const trimmed = raw.trim();
  const namespaced = trimmed.includes(':') ? trimmed.split('[')[0]! : `minecraft:${trimmed.split('[')[0]!}`;
  const withoutNs = namespaced.includes(':') ? namespaced.slice(namespaced.indexOf(':') + 1) : namespaced;
  const bracket = trimmed.indexOf('[');
  const states: Record<string, string> = {};
  if (bracket >= 0) {
    const inner = trimmed.slice(bracket + 1).replace(/\]$/, '');
    for (const part of inner.split(',')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      states[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return { namespaced, name: withoutNs, states };
}

function aliasKey(parsed: ParsedMinecraftBlock): string {
  const variant = parsed.states.variant ?? parsed.states.wood ?? parsed.states.type;
  if (parsed.name === 'log' || parsed.name === 'log2') {
    if (variant === 'birch') return 'birch_log';
    if (variant === 'spruce') return 'spruce_log';
    return 'oak_log';
  }
  if (parsed.name === 'leaves' || parsed.name === 'leaves2') {
    if (variant === 'birch') return 'birch_leaves';
    if (variant === 'spruce') return 'spruce_leaves';
    return 'oak_leaves';
  }
  if (parsed.name === 'planks' || parsed.name === 'wood') {
    const wood = VARIANT_WOOD[variant ?? 'oak'] ?? 'oak';
    return `${wood}_planks`;
  }
  if (parsed.name === 'wool') {
    const color = parsed.states.color ?? 'white';
    return color === 'silver' ? 'light_gray_wool' : `${color}_wool`;
  }
  if (parsed.name === 'wooden_slab' || parsed.name === 'oak_slab') {
    const wood = VARIANT_WOOD[variant ?? 'oak'] ?? 'oak';
    return `${wood}_slab`;
  }
  return ALIASES[parsed.name] ?? parsed.name;
}

function facingOf(value: string | undefined): HorizontalFacing | undefined {
  if (value && HORIZONTAL.has(value)) return value as HorizontalFacing;
  return undefined;
}

function mapFluidState(states: Readonly<Record<string, string>>): BlockRenderState | undefined {
  const raw = Number(states.level ?? '0');
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw >= 8) return { fluidLevel: 8, fluidFalling: true };
  return { fluidLevel: Math.max(1, Math.min(7, 8 - raw)), fluidFalling: false };
}

function mapSpecialState(block: BlockId, states: Readonly<Record<string, string>>): BlockRenderState | undefined {
  const definition = getBlockDefinition(block);
  const facing = facingOf(states.facing);
  if (definition.liquid) return mapFluidState(states);
  if (definition.renderShape === 'torch') {
    if (states.facing && states.facing !== 'up') {
      const wall = facingOf(states.facing);
      return wall ? { attachment: 'wall', facing: wall } : { attachment: 'floor' };
    }
    if (states.face === 'wall' && facing) return { attachment: 'wall', facing };
    return { attachment: 'floor' };
  }
  if (definition.renderShape === 'lantern') {
    const hanging = states.hanging === 'true' || states.attachment === 'ceiling';
    return { attachment: hanging ? 'ceiling' : 'floor' };
  }
  if (definition.renderShape === 'chain') {
    return { attachment: 'ceiling' };
  }
  if (definition.renderShape === 'ladder' && facing) return { facing };
  if (definition.renderShape === 'lever' || definition.renderShape === 'button') {
    const face = states.face ?? states.attachment;
    const attachment = face === 'ceiling' ? 'ceiling' : face === 'wall' ? 'wall' : 'floor';
    return facing ? { attachment, facing, powered: states.powered === 'true' } : { attachment, powered: states.powered === 'true' };
  }
  if (definition.renderShape === 'door') {
    const half = states.half === 'upper' ? 'upper' : 'lower';
    const hinge: DoorHinge = states.hinge === 'right' ? 'right' : 'left';
    return {
      facing: facing ?? 'north',
      hinge,
      open: states.open === 'true',
      half,
    };
  }
  if (definition.renderShape === 'stairs') {
    const stairHalf: StairHalf = states.half === 'top' ? 'top' : 'bottom';
    return { facing: facing ?? 'north', stairHalf };
  }
  if (definition.renderShape === 'slab') {
    const type = states.type ?? states.half;
    const slabType: SlabType = type === 'top' ? 'top' : type === 'double' ? 'double' : 'bottom';
    return { slabType };
  }
  if (definition.renderShape === 'rail') {
    const shape = (states.shape ?? states.facing) as RailShape | undefined;
    if (shape && RAIL_SHAPES.has(shape)) return { railShape: shape };
    if (facing === 'east' || facing === 'west') return { railShape: 'east_west' };
    return { railShape: 'north_south' };
  }
  if (definition.renderShape === 'chest' || block === BlockId.Furnace) {
    return { facing: facing ?? 'north' };
  }
  if (definition.renderShape === 'pressure_plate') {
    return { powered: states.powered === 'true' };
  }
  return facing ? { facing } : undefined;
}

export function mapMinecraftBlock(raw: string): MappedFrontierBlock {
  const parsed = parseMinecraftBlockId(raw);
  const key = aliasKey(parsed);
  const definition = getBlockByKey(key);
  if (!definition) {
    return { block: BlockId.DiamondBlock, supported: false, namespaced: parsed.namespaced };
  }
  const state = mapSpecialState(definition.id, parsed.states);
  return { block: definition.id, state, supported: true, namespaced: parsed.namespaced };
}

export function mapPalette(palette: readonly string[]): MappedFrontierBlock[] {
  return palette.map((entry) => mapMinecraftBlock(entry));
}
