import { BlockId, horizontalFacingNormal, type BlockRenderState, type HorizontalFacing } from '../blocks';
import type { VoxelWorld } from './World';
import { blockCollisionBoxes } from './collision';

export interface BedCell { readonly x: number; readonly y: number; readonly z: number }
export interface BedRestState extends BedCell { readonly facing: HorizontalFacing }
export const BED_REST_ANCHOR_HEIGHT = 0.81;

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

/** A rest is always identified by its head, regardless of the half clicked. */
export function resolveBedRest(world: VoxelWorld, x: number, y: number, z: number): BedRestState | undefined {
  if (world.getBlock(x, y, z, false) !== BlockId.WhiteBed) return undefined;
  const state = world.getBlockState(x, y, z);
  if (!state?.facing || !state.bedPart || !isMatchingBedHalf(world, x, y, z, state)) return undefined;
  const head = state.bedPart === 'head' ? { x, y, z } : bedHeadCell(x, y, z, state.facing);
  return { ...head, facing: state.facing };
}

export function isBedRestValid(world: VoxelWorld, rest: BedRestState): boolean {
  return resolveBedRest(world, rest.x, rest.y, rest.z)?.facing === rest.facing;
}

export function bedRestPosition(rest: BedRestState): readonly [number, number, number] {
  const [dx, , dz] = horizontalFacingNormal(rest.facing);
  return [rest.x - dx * 1.5 + 0.5, rest.y + BED_REST_ANCHOR_HEIGHT, rest.z - dz * 1.5 + 0.5];
}

export function bedRestCameraPosition(rest: BedRestState): readonly [number, number, number] {
  return [rest.x + 0.5, rest.y + 0.95, rest.z + 0.5];
}

/** Side exits first; never place standing feet in either bed half. */
export function bedExitPosition(world: VoxelWorld, rest: BedRestState): readonly [number, number, number] {
  const [dx, , dz] = horizontalFacingNormal(rest.facing);
  const footX = rest.x - dx;
  const footZ = rest.z - dz;
  const sideX = -dz;
  const sideZ = dx;
  const cells = [
    [footX + sideX, footZ + sideZ], [footX - sideX, footZ - sideZ],
    [rest.x + sideX, rest.z + sideZ], [rest.x - sideX, rest.z - sideZ],
    [footX - dx, footZ - dz], [rest.x + dx, rest.z + dz],
  ];
  for (const [x, z] of cells) {
    if (x === undefined || z === undefined) continue;
    if (!world.isSolid(x, rest.y - 1, z)) continue;
    if (blockCollisionBoxes(world, x, rest.y, z).length || blockCollisionBoxes(world, x, rest.y + 1, z).length) continue;
    return [x + 0.5, rest.y + 0.01, z + 0.5];
  }
  return [footX + 0.5, rest.y + 1.01, footZ + 0.5];
}
