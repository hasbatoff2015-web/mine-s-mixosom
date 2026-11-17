import { BlockId } from './types';

/** Ordinary fire and soul fire share support, damage and fluid displacement. */
export function isLiveFire(block: BlockId): boolean {
  return block === BlockId.Fire || block === BlockId.SoulFire;
}
