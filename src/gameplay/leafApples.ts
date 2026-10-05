import { BlockId } from '../blocks';

/** Broken leaf blocks required before the next apple. */
export const LEAF_APPLE_INTERVAL = 5;

const LEAF_BLOCKS = new Set<number>([
  BlockId.OakLeaves,
  BlockId.BirchLeaves,
  BlockId.SpruceLeaves,
]);

export function isLeafBlock(blockId: number): boolean {
  return LEAF_BLOCKS.has(blockId);
}

/**
 * Advance one player's leaf counter by `brokenNow` destroyed leaves.
 * A batch of N is the same as N single breaks: apples = floor(total / 5),
 * and the stored counter is the remainder that starts the next cycle.
 */
export function applesForBrokenLeaves(
  previous: number,
  brokenNow: number,
): { readonly apples: number; readonly next: number } {
  const safePrevious = Number.isInteger(previous) && previous > 0
    ? previous % LEAF_APPLE_INTERVAL
    : 0;
  const count = Number.isInteger(brokenNow) && brokenNow > 0 ? brokenNow : 0;
  const total = safePrevious + count;
  return {
    apples: Math.floor(total / LEAF_APPLE_INTERVAL),
    next: total % LEAF_APPLE_INTERVAL,
  };
}
