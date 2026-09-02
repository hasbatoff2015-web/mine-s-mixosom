import { BlockId } from '../blocks';

/** Blocks whose use action is interact, not place-adjacent. */
export function isUseTargetBlock(block: BlockId): boolean {
  return block === BlockId.CraftingTable
    || block === BlockId.Chest
    || block === BlockId.Furnace
    || block === BlockId.Lever
    || block === BlockId.StoneButton
    || block === BlockId.OakDoor
    || block === BlockId.WhiteBed;
}
