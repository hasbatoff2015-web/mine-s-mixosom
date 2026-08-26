import { BlockId, getBlockDefinition } from '../blocks';
import type { VoxelWorld } from './World';
import {
  fluidSurfaceHeight,
  isFluidBlock,
  isFluidSource,
  readFluidFalling,
  readFluidLevel,
} from './fluids';

export type FluidCornerHeights = {
  readonly h00: number;
  readonly h10: number;
  readonly h01: number;
  readonly h11: number;
};

export type FluidSideId = 'px' | 'nx' | 'pz' | 'nz';

export interface FluidCellGeometry {
  readonly type: BlockId;
  readonly top: FluidCornerHeights | null;
  readonly bottom: boolean;
  readonly sides: Record<FluidSideId, boolean>;
}

function sameFluid(block: BlockId, type: BlockId): boolean {
  return block === type && isFluidBlock(type);
}

/** Simulation level mapped to a per-cell surface height (not a render corner). */
export function cellRenderHeight(world: VoxelWorld, x: number, y: number, z: number, type: BlockId): number {
  if (!sameFluid(world.getBlock(x, y, z, false), type)) return 0;
  if (sameFluid(world.getBlock(x, y + 1, z, false), type)) return 1;
  return fluidSurfaceHeight(readFluidLevel(world, x, y, z), readFluidFalling(world, x, y, z));
}

/**
 * World-space deterministic corner height for the vertical edge at integer
 * `(cornerX, y, cornerZ)`. Identical from every adjacent block's perspective.
 */
export function fluidCornerHeight(
  world: VoxelWorld,
  cornerX: number,
  y: number,
  cornerZ: number,
  type: BlockId,
): number {
  const cells: ReadonlyArray<readonly [number, number]> = [
    [cornerX - 1, cornerZ - 1],
    [cornerX, cornerZ - 1],
    [cornerX - 1, cornerZ],
    [cornerX, cornerZ],
  ];
  const heights: number[] = [];
  let holdHigh = false;
  for (const [x, z] of cells) {
    const id = world.getBlock(x, y, z, false);
    if (!sameFluid(id, type)) continue;
    if (sameFluid(world.getBlock(x, y + 1, z, false), type)) return 1;
    heights.push(fluidSurfaceHeight(readFluidLevel(world, x, y, z), readFluidFalling(world, x, y, z)));
    if (isFluidSource(world, x, y, z) || readFluidFalling(world, x, y, z)) holdHigh = true;
  }
  if (heights.length === 0) return 0;
  if (holdHigh) return Math.max(...heights);
  let sum = 0;
  for (const height of heights) sum += height;
  return sum / heights.length;
}

function shouldRenderSide(
  world: VoxelWorld,
  type: BlockId,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  edgeA: number,
  edgeB: number,
): boolean {
  const neighbor = world.getBlock(x + dx, y, z + dz, false);
  if (sameFluid(neighbor, type)) return false;
  if (getBlockDefinition(neighbor).occludesFaces) return false;
  return Math.max(edgeA, edgeB) > 1e-4;
}

export function fluidCellGeometry(world: VoxelWorld, x: number, y: number, z: number): FluidCellGeometry | null {
  const type = world.getBlock(x, y, z, false);
  if (!isFluidBlock(type)) return null;
  const filledAbove = sameFluid(world.getBlock(x, y + 1, z, false), type);
  const h00 = filledAbove ? 1 : fluidCornerHeight(world, x, y, z, type);
  const h10 = filledAbove ? 1 : fluidCornerHeight(world, x + 1, y, z, type);
  const h01 = filledAbove ? 1 : fluidCornerHeight(world, x, y, z + 1, type);
  const h11 = filledAbove ? 1 : fluidCornerHeight(world, x + 1, y, z + 1, type);
  const top = filledAbove ? null : { h00, h10, h01, h11 };
  const below = world.getBlock(x, y - 1, z, false);
  const bottom = !sameFluid(below, type) && !getBlockDefinition(below).occludesFaces;
  return {
    type,
    top,
    bottom,
    sides: {
      px: shouldRenderSide(world, type, x, y, z, 1, 0, h10, h11),
      nx: shouldRenderSide(world, type, x, y, z, -1, 0, h00, h01),
      pz: shouldRenderSide(world, type, x, y, z, 0, 1, h01, h11),
      nz: shouldRenderSide(world, type, x, y, z, 0, -1, h00, h10),
    },
  };
}

export function fluidTopHasSlope(top: FluidCornerHeights, epsilon = 1e-4): boolean {
  const values = [top.h00, top.h10, top.h01, top.h11];
  return Math.max(...values) - Math.min(...values) > epsilon;
}
