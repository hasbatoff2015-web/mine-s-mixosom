import type { BlockRenderState, HorizontalFacing } from '../blocks';
import { horizontalFacingNormal } from '../blocks/placement';
import { isCollectiblePaintingItemId } from '../items/collectiblePaintings';

/**
 * Shared 1×1 wall frame. Art is a separate renderer, not a chunk-atlas face.
 * Admins hang copies by hand. This file does not spawn, scatter, or restore
 * a "missing original".
 */
export const PAINTING_OUTER = 0.94;
export const PAINTING_RAIL = 0.075;
export const PAINTING_ART = 0.81;
export const PAINTING_BACKPLATE = 0.86;
export const PAINTING_BACK_Z0 = 0.002;
export const PAINTING_BACK_Z1 = 0.026;
export const PAINTING_ART_Z0 = 0.028;
export const PAINTING_ART_Z1 = 0.032;
export const PAINTING_RAIL_Z0 = 0.034;
export const PAINTING_RAIL_Z1 = 0.076;
export const PAINTING_SELECTION_INSET = 0.03;
export const PAINTING_SELECTION_DEPTH = 0.12;
export const PAINTING_WOOD_TINT = [0.78, 0.72, 0.62] as const;

export interface PaintingAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** South is identity: local +Z is the front, the wall sits on local z = 0. */
export function paintingYaw(facing: HorizontalFacing): number {
  switch (facing) {
    case 'south': return 0;
    case 'east': return Math.PI / 2;
    case 'north': return Math.PI;
    case 'west': return -Math.PI / 2;
  }
}

/** Rotate a cell-local XZ point around the cell center. */
export function paintingRotateLocal(x: number, z: number, facing: HorizontalFacing): { x: number; z: number } {
  const yaw = paintingYaw(facing);
  const dx = x - 0.5;
  const dz = z - 0.5;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: 0.5 + dx * cos + dz * sin,
    z: 0.5 - dx * sin + dz * cos,
  };
}

export function paintingPlaneCenterZ(z0: number, z1: number): number {
  return (z0 + z1) / 2 - 0.5;
}

/**
 * Image-left (u = 0) or image-right (u = 1) on the art plane.
 * East/west keep the image's left on the viewer's left.
 */
export function paintingArtEdge(
  facing: HorizontalFacing,
  side: 'left' | 'right',
): { x: number; z: number } {
  const half = PAINTING_ART / 2;
  const x = 0.5 + (side === 'left' ? -half : half);
  const z = (PAINTING_ART_Z0 + PAINTING_ART_Z1) / 2;
  return paintingRotateLocal(x, z, facing);
}

/** Viewer's left when looking at the front. `facing × up`. */
export function paintingViewerLeft(facing: HorizontalFacing): { x: number; z: number } {
  const [nx, , nz] = horizontalFacingNormal(facing);
  return { x: -nz, z: nx };
}

export function paintingSelectionLocalBox(facing: HorizontalFacing = 'south'): PaintingAabb {
  const inset = PAINTING_SELECTION_INSET;
  const depth = PAINTING_SELECTION_DEPTH;
  const corners: Array<readonly [number, number]> = [
    [inset, 0],
    [1 - inset, 0],
    [inset, depth],
    [1 - inset, depth],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of corners) {
    const point = paintingRotateLocal(x, z, facing);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minY: inset, maxY: 1 - inset, minZ, maxZ };
}

/** Drop unknown painting ids. Other state fields stay so old saves keep loading. */
export function sanitizeBlockRenderState(state: BlockRenderState): BlockRenderState {
  if (state.paintingItemId === undefined) return state;
  if (isCollectiblePaintingItemId(state.paintingItemId)) return state;
  const { paintingItemId: _ignored, ...rest } = state;
  return rest;
}
