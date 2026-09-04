import { BlockId, type BlockRenderState, type HorizontalFacing } from '../blocks';
import { ItemId } from '../items';

export const FARMING_HYDRATION_PULSE_TICKS = 100;
export const FARMING_GROWTH_PULSE_TICKS = 1_200;
export const FARMING_FRUIT_CHANCE = 1 / 6;
export const MAX_CROP_AGE = 7;

export const FARMING_BLOCKS: ReadonlySet<BlockId> = new Set([
  BlockId.Farmland,
  BlockId.WheatCrop,
  BlockId.CarrotCrop,
  BlockId.PotatoCrop,
  BlockId.MelonStem,
  BlockId.PumpkinStem,
]);

export const CROP_BLOCKS: ReadonlySet<BlockId> = new Set([
  BlockId.WheatCrop,
  BlockId.CarrotCrop,
  BlockId.PotatoCrop,
  BlockId.MelonStem,
  BlockId.PumpkinStem,
]);

export const STEM_BLOCKS: ReadonlySet<BlockId> = new Set([BlockId.MelonStem, BlockId.PumpkinStem]);

export function isFarmingBlock(block: BlockId): boolean {
  return FARMING_BLOCKS.has(block);
}

export function isCropBlock(block: BlockId): boolean {
  return CROP_BLOCKS.has(block);
}

export function isStemBlock(block: BlockId): boolean {
  return STEM_BLOCKS.has(block);
}

export function cropAge(state: BlockRenderState | undefined): number {
  return Math.max(0, Math.min(MAX_CROP_AGE, Math.floor(state?.age ?? 0)));
}

export function cropTextureStage(block: BlockId, state: BlockRenderState | undefined): number {
  const age = cropAge(state);
  if (block === BlockId.CarrotCrop || block === BlockId.PotatoCrop) {
    if (age <= 1) return 0;
    if (age <= 3) return 1;
    if (age <= 6) return 2;
    return 3;
  }
  return age;
}

export interface PlantingDefinition {
  readonly block: BlockId;
  readonly item: string;
}

const PLANTING_BY_ITEM: ReadonlyMap<string, PlantingDefinition> = new Map([
  [ItemId.WheatSeeds, { block: BlockId.WheatCrop, item: ItemId.WheatSeeds }],
  [ItemId.Carrot, { block: BlockId.CarrotCrop, item: ItemId.Carrot }],
  [ItemId.Potato, { block: BlockId.PotatoCrop, item: ItemId.Potato }],
  [ItemId.MelonSeeds, { block: BlockId.MelonStem, item: ItemId.MelonSeeds }],
  [ItemId.PumpkinSeeds, { block: BlockId.PumpkinStem, item: ItemId.PumpkinSeeds }],
]);

export function plantingDefinition(itemId: string | undefined): PlantingDefinition | undefined {
  return itemId ? PLANTING_BY_ITEM.get(itemId) : undefined;
}

export function growthChance(block: BlockId): number {
  switch (block) {
    case BlockId.WheatCrop: return 7 / 8;
    case BlockId.CarrotCrop: return 7 / 9;
    case BlockId.PotatoCrop:
    case BlockId.MelonStem:
    case BlockId.PumpkinStem: return 0.7;
    default: return 0;
  }
}

export const FARMING_DIRECTIONS = Object.freeze([
  { facing: 'north' as const, dx: 0, dz: -1 },
  { facing: 'east' as const, dx: 1, dz: 0 },
  { facing: 'south' as const, dx: 0, dz: 1 },
  { facing: 'west' as const, dx: -1, dz: 0 },
]);

export interface FarmingBlockView {
  getBlock(x: number, y: number, z: number, generate?: boolean): BlockId;
}

export function attachedStemDirection(
  world: FarmingBlockView,
  x: number,
  y: number,
  z: number,
  stem: BlockId,
): HorizontalFacing | undefined {
  const fruit = stem === BlockId.MelonStem ? BlockId.Melon
    : stem === BlockId.PumpkinStem ? BlockId.Pumpkin : undefined;
  if (fruit === undefined) return undefined;
  for (const direction of FARMING_DIRECTIONS) {
    if (world.getBlock(x + direction.dx, y, z + direction.dz, false) === fruit) return direction.facing;
  }
  return undefined;
}
