import { BlockId } from './types';
import type { ToolTier, ToolType } from './types';

/**
 * Shared material family for stairs/slabs/plates. Adding a wood species is a
 * family row, not a new mesher/renderer.
 */
export interface BlockFamily {
  readonly key: string;
  readonly sourceBlockId: BlockId;
  readonly sourceItem: string;
  readonly texture: string;
  readonly hardness: number;
  readonly tool: ToolType;
  readonly tier: ToolTier;
  readonly flammable?: boolean;
  readonly requiresCorrectTool?: boolean;
  readonly slabId?: BlockId;
  readonly stairId?: BlockId;
  readonly fenceId?: BlockId;
  /** Keep a legacy stair ID in the registry but hide it from gameplay. */
  readonly hideStairs?: boolean;
}

export const BLOCK_FAMILIES: readonly BlockFamily[] = Object.freeze([
  {
    key: 'oak',
    sourceBlockId: BlockId.OakPlanks,
    sourceItem: 'oak_planks',
    texture: 'block/oak_planks',
    hardness: 2,
    tool: 'axe',
    tier: 'hand',
    flammable: true,
    slabId: BlockId.OakSlab,
    stairId: BlockId.OakStairs,
    fenceId: BlockId.OakFence,
  },
  {
    key: 'birch',
    sourceBlockId: BlockId.BirchPlanks,
    sourceItem: 'birch_planks',
    texture: 'block/birch_planks',
    hardness: 2,
    tool: 'axe',
    tier: 'hand',
    flammable: true,
    slabId: BlockId.BirchSlab,
    stairId: BlockId.BirchStairs,
    fenceId: BlockId.BirchFence,
  },
  {
    key: 'spruce',
    sourceBlockId: BlockId.SprucePlanks,
    sourceItem: 'spruce_planks',
    texture: 'block/spruce_planks',
    hardness: 2,
    tool: 'axe',
    tier: 'hand',
    flammable: true,
    slabId: BlockId.SpruceSlab,
    stairId: BlockId.SpruceStairs,
    fenceId: BlockId.SpruceFence,
  },
  {
    key: 'stone',
    sourceBlockId: BlockId.Stone,
    sourceItem: 'stone',
    texture: 'block/stone',
    hardness: 2,
    tool: 'pickaxe',
    tier: 'wood',
    requiresCorrectTool: true,
    slabId: BlockId.StoneSlab,
    stairId: BlockId.StoneStairs,
    hideStairs: true,
  },
  {
    key: 'cobblestone',
    sourceBlockId: BlockId.Cobblestone,
    sourceItem: 'cobblestone',
    texture: 'block/cobblestone',
    hardness: 2,
    tool: 'pickaxe',
    tier: 'wood',
    requiresCorrectTool: true,
    slabId: BlockId.CobblestoneSlab,
    stairId: BlockId.CobblestoneStairs,
  },
  {
    key: 'brick',
    sourceBlockId: BlockId.Bricks,
    sourceItem: 'bricks',
    texture: 'block/bricks',
    hardness: 2,
    tool: 'pickaxe',
    tier: 'wood',
    requiresCorrectTool: true,
    slabId: BlockId.BrickSlab,
    stairId: BlockId.BrickStairs,
  },
  {
    key: 'stone_brick',
    sourceBlockId: BlockId.StoneBricks,
    sourceItem: 'stone_bricks',
    texture: 'block/stone_bricks',
    hardness: 1.5,
    tool: 'pickaxe',
    tier: 'wood',
    requiresCorrectTool: true,
    slabId: BlockId.StoneBrickSlab,
    stairId: BlockId.StoneBrickStairs,
  },
]);

const SLAB_BY_ID = new Map<BlockId, BlockFamily>();
const STAIR_BY_ID = new Map<BlockId, BlockFamily>();
const FENCE_BY_ID = new Map<BlockId, BlockFamily>();
const FAMILY_BY_SOURCE = new Map<BlockId, BlockFamily>();

for (const family of BLOCK_FAMILIES) {
  FAMILY_BY_SOURCE.set(family.sourceBlockId, family);
  if (family.slabId !== undefined) SLAB_BY_ID.set(family.slabId, family);
  if (family.stairId !== undefined) STAIR_BY_ID.set(family.stairId, family);
  if (family.fenceId !== undefined) FENCE_BY_ID.set(family.fenceId, family);
}

export function familyForSlab(id: BlockId): BlockFamily | undefined {
  return SLAB_BY_ID.get(id);
}

export function familyForStairs(id: BlockId): BlockFamily | undefined {
  return STAIR_BY_ID.get(id);
}

export function familyForSourceBlock(id: BlockId): BlockFamily | undefined {
  return FAMILY_BY_SOURCE.get(id);
}

export function isSlabBlock(id: BlockId): boolean {
  return SLAB_BY_ID.has(id);
}

export function isStairBlock(id: BlockId): boolean {
  return STAIR_BY_ID.has(id);
}

export function isPressurePlateBlock(id: BlockId): boolean {
  return id === BlockId.OakPressurePlate || id === BlockId.StonePressurePlate;
}

export function isFenceBlock(id: BlockId): boolean {
  return FENCE_BY_ID.has(id);
}

export function isRailBlock(id: BlockId): boolean {
  return id === BlockId.Rail;
}

export function familyForFence(id: BlockId): BlockFamily | undefined {
  return FENCE_BY_ID.get(id);
}

export function fenceFamilies(): readonly BlockFamily[] {
  return BLOCK_FAMILIES.filter((family) => family.fenceId !== undefined);
}

/** Plank families that actually exist in the current registry. */
export function existingPlankFamilies(): readonly BlockFamily[] {
  return BLOCK_FAMILIES.filter((family) => family.sourceItem.endsWith('_planks'));
}

export function obtainableStairFamilies(): readonly BlockFamily[] {
  return BLOCK_FAMILIES.filter((family) => family.stairId !== undefined && family.hideStairs !== true);
}

export function slabFamilies(): readonly BlockFamily[] {
  return BLOCK_FAMILIES.filter((family) => family.slabId !== undefined);
}
