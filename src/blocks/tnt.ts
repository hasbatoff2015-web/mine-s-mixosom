import { BlockId } from './types';

/** Ordinary, powerful and destructive TNT placeable blocks. */
export const TNT_BLOCK_IDS = Object.freeze([
  BlockId.Tnt,
  BlockId.TntPowerful,
  BlockId.TntDestructive,
] as const);

export type TntBlockId = (typeof TNT_BLOCK_IDS)[number];

export function isTntBlock(blockId: number): blockId is TntBlockId {
  return blockId === BlockId.Tnt
    || blockId === BlockId.TntPowerful
    || blockId === BlockId.TntDestructive;
}

/** Iron/gold/diamond blocks used as Anarchy block-claim anchors. */
export function isBlockClaimAnchorId(blockId: number): boolean {
  return blockId === BlockId.IronBlock
    || blockId === BlockId.GoldBlock
    || blockId === BlockId.DiamondBlock;
}

export const PRIMED_TNT_TEXTURE_KEY = 'block/tnt';

export function tntTextureKey(blockId: number): string {
  if (blockId === BlockId.TntPowerful) return 'block/tnt_powerful';
  if (blockId === BlockId.TntDestructive) return 'block/tnt_destructive';
  return PRIMED_TNT_TEXTURE_KEY;
}

export function tntItemId(blockId: number): string {
  if (blockId === BlockId.TntPowerful) return 'tnt_powerful';
  if (blockId === BlockId.TntDestructive) return 'tnt_destructive';
  return 'tnt';
}

export function tntBlockIdFromItem(itemId: string | undefined): TntBlockId | undefined {
  if (itemId === 'tnt') return BlockId.Tnt;
  if (itemId === 'tnt_powerful') return BlockId.TntPowerful;
  if (itemId === 'tnt_destructive') return BlockId.TntDestructive;
  return undefined;
}
