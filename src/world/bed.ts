import { BlockId, horizontalFacingNormal, type BlockRenderState, type HorizontalFacing } from '../blocks';
import type { VoxelWorld } from './World';

export interface BedCell { readonly x: number; readonly y: number; readonly z: number }

export function bedOtherCell(x: number, y: number, z: number, state: BlockRenderState): BedCell | undefined {
  if (!state.bedPart || !state.facing) return undefined;
  const [dx, , dz] = horizontalFacingNormal(state.facing);
  const sign = state.bedPart === 'foot' ? 1 : -1;
  return { x: x + dx * sign, y, z: z + dz * sign };
}

export function isMatchingBedHalf(world: VoxelWorld, x: number, y: number, z: number, state: BlockRenderState): boolean {
  const other = bedOtherCell(x, y, z, state);
  if (!other || world.getBlock(other.x, other.y, other.z, false) !== BlockId.WhiteBed) return false;
  const otherState = world.getBlockState(other.x, other.y, other.z);
  return otherState?.facing === state.facing
    && otherState?.bedPart === (state.bedPart === 'foot' ? 'head' : 'foot');
}

/** Removes the one or two related cells in a single world mutation. */
export function clearBedBlocks(world: VoxelWorld, x: number, y: number, z: number): number {
  const state = world.getBlockState(x, y, z);
  const other = state && isMatchingBedHalf(world, x, y, z, state)
    ? bedOtherCell(x, y, z, state)
    : undefined;
  const changes = [{ x, y, z, block: BlockId.Air }];
  if (other) changes.push({ ...other, block: BlockId.Air });
  return world.applyBlockBatch(changes, { deferLighting: true }).applied;
}

export function bedHeadCell(x: number, y: number, z: number, facing: HorizontalFacing): BedCell {
  const [dx, , dz] = horizontalFacingNormal(facing);
  return { x: x + dx, y, z: z + dz };
}
