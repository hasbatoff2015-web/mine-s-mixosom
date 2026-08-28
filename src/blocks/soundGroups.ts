import { BlockId, type BlockCategory, type BlockSoundGroup, type TranslucentMaterial } from './types';

export interface SoundGroupHint {
  readonly category?: BlockCategory;
  readonly liquid?: boolean;
  readonly translucentMaterial?: TranslucentMaterial;
  readonly soundGroup?: BlockSoundGroup | false;
}

const SAND_KEYS = new Set(['sand', 'gravel']);
const DIRT_KEYS = new Set([
  'dirt', 'grass_block', 'clay', 'snow_block', 'cactus',
  'oak_leaves', 'birch_leaves', 'spruce_leaves',
  'tall_grass', 'fern', 'dandelion', 'poppy', 'oxeye_daisy', 'dead_bush',
  'tnt',
]);
const WOOD_KEYS = new Set([
  'oak_log', 'birch_log', 'spruce_log',
  'oak_planks', 'birch_planks', 'spruce_planks',
  'bookshelf', 'crafting_table', 'chest', 'oak_door', 'ladder', 'white_bed',
  'oak_pressure_plate', 'torch',
]);
const GLASS_KEYS = new Set(['glass', 'ice']);
const WOOL_KEYS = new Set(['cobweb']);
const NONE_IDS = new Set<BlockId>([BlockId.Air, BlockId.Water, BlockId.Lava]);

/**
 * Data-first material family for block SFX. Gameplay must not switch on BlockId
 * to pick a filename — only this group (or an explicit definition override).
 */
export function inferBlockSoundGroup(
  id: BlockId,
  key: string,
  options: SoundGroupHint = {},
): BlockSoundGroup | undefined {
  if (options.soundGroup === false) return undefined;
  if (options.soundGroup) return options.soundGroup;
  if (NONE_IDS.has(id) || options.liquid === true || options.category === 'air') return undefined;
  if (options.translucentMaterial === 'glass' || GLASS_KEYS.has(key)) return 'glass';
  if (options.category === 'wool' || key.endsWith('_wool') || WOOL_KEYS.has(key)) return 'wool';
  if (SAND_KEYS.has(key)) return 'sand';
  if (DIRT_KEYS.has(key)) return 'dirt';
  if (options.category === 'wood' || WOOD_KEYS.has(key) || key.endsWith('_log') || key.endsWith('_planks')
    || key.endsWith('_fence') || (key.endsWith('_slab') && isWoodShaped(key))
    || (key.endsWith('_stairs') && isWoodShaped(key))) {
    return 'wood';
  }
  if (options.category === 'ore') return 'stone';
  return 'stone';
}

function isWoodShaped(key: string): boolean {
  return key.startsWith('oak_') || key.startsWith('birch_') || key.startsWith('spruce_');
}
