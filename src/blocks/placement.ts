import type { BlockAttachment, DoorHinge, HorizontalFacing } from './types';
import { BlockId } from './types';

export interface OrientedPlacement {
  readonly attachment: BlockAttachment;
  readonly facing: HorizontalFacing;
}

export function horizontalFacingFromXZ(x: number, z: number): HorizontalFacing {
  return Math.abs(x) > Math.abs(z)
    ? (x >= 0 ? 'east' : 'west')
    : (z >= 0 ? 'south' : 'north');
}

export function doorFacingFromYaw(yaw: number): HorizontalFacing {
  return horizontalFacingFromXZ(-Math.sin(yaw), -Math.cos(yaw));
}

export function oppositeHorizontalFacing(facing: HorizontalFacing): HorizontalFacing {
  switch (facing) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}

/** World-space unit normal for a horizontal facing (north = −Z). */
export function horizontalFacingNormal(facing: HorizontalFacing): readonly [number, number, number] {
  switch (facing) {
    case 'north': return [0, 0, -1];
    case 'south': return [0, 0, 1];
    case 'east': return [1, 0, 0];
    case 'west': return [-1, 0, 0];
  }
}

/**
 * Vanilla chest `facing` is the latch/front. Java places with
 * `player.getHorizontalFacing().getOpposite()`, so the latch faces the player.
 */
export function chestFacingFromYaw(yaw: number): HorizontalFacing {
  return oppositeHorizontalFacing(doorFacingFromYaw(yaw));
}

/**
 * Vanilla furnace `facing` is the front (lit opening). Same opposite-of-look
 * convention as chests, kept as a separate helper so doors stay look-aligned.
 */
export function furnaceFacingFromYaw(yaw: number): HorizontalFacing {
  return oppositeHorizontalFacing(doorFacingFromYaw(yaw));
}

/** Missing block-state facing: cube front already lives on −Z (north). */
export const DEFAULT_FURNACE_FACING: HorizontalFacing = 'north';

export function furnaceCubeFaceSlot(
  nx: number,
  ny: number,
  nz: number,
  facing: HorizontalFacing,
): 'top' | 'bottom' | 'side' | 'front' {
  if (ny > 0.5) return 'top';
  if (ny < -0.5) return 'bottom';
  const [fx, , fz] = horizontalFacingNormal(facing);
  if (nx === fx && nz === fz) return 'front';
  return 'side';
}

export function furnaceFaceTextureKey(
  textures: { front?: string; litFront?: string; side?: string; all?: string; top?: string; bottom?: string },
  slot: 'top' | 'bottom' | 'side' | 'front',
  burning: boolean,
): string {
  if (slot === 'top') return textures.top ?? textures.all ?? textures.side ?? 'block/missing';
  if (slot === 'bottom') return textures.bottom ?? textures.all ?? textures.side ?? 'block/missing';
  if (slot === 'front') {
    if (burning && textures.litFront) return textures.litFront;
    return textures.front ?? textures.side ?? textures.all ?? 'block/missing';
  }
  return textures.side ?? textures.all ?? textures.top ?? 'block/missing';
}

/**
 * 2D inventory/hotbar tile for a cube block. Prefer the authored FRONT
 * (furnace opening, crafting-table tools) over the side/back.
 */
export function blockItemIconTexture(
  textures: { front?: string; all?: string; side?: string; top?: string },
  fallbackKey: string,
): string {
  return textures.front
    ?? textures.all
    ?? textures.side
    ?? textures.top
    ?? `block/${fallbackKey}`;
}

export function attachmentFromHitNormal(_nx: number, ny: number, _nz: number): BlockAttachment {
  if (ny > 0.5) return 'floor';
  if (ny < -0.5) return 'ceiling';
  return 'wall';
}

export function facingFromHit(
  attachment: BlockAttachment,
  nx: number,
  _ny: number,
  nz: number,
  viewX: number,
  viewZ: number,
): HorizontalFacing {
  if (attachment === 'wall') return horizontalFacingFromXZ(nx, nz);
  return horizontalFacingFromXZ(viewX, viewZ);
}

/** Java 1.9 torches attach to floor or wall, never the ceiling. */
export function torchPlacementFromHit(
  nx: number,
  ny: number,
  nz: number,
  viewX: number,
  viewZ: number,
): OrientedPlacement | undefined {
  const attachment = attachmentFromHitNormal(nx, ny, nz);
  if (attachment === 'ceiling') return undefined;
  return {
    attachment,
    facing: facingFromHit(attachment, nx, ny, nz, viewX, viewZ),
  };
}

/** Java 1.8/1.9 stone buttons attach to wall, floor and ceiling. */
export function buttonPlacementFromHit(
  nx: number,
  ny: number,
  nz: number,
  viewX: number,
  viewZ: number,
): OrientedPlacement {
  const attachment = attachmentFromHitNormal(nx, ny, nz);
  return {
    attachment,
    facing: facingFromHit(attachment, nx, ny, nz, viewX, viewZ),
  };
}

/**
 * Ladder attaches only to a vertical face. `facing` is the clicked-face
 * normal (same convention as wall torch): support is opposite that direction.
 */
export function ladderPlacementFromHit(
  nx: number,
  ny: number,
  nz: number,
): OrientedPlacement | undefined {
  if (Math.abs(ny) >= 0.5) return undefined;
  return {
    attachment: 'wall',
    facing: horizontalFacingFromXZ(nx, nz),
  };
}

/** Closed door occupies `facing`; open door swings 90° by hinge. */
export function occupiedDoorFacing(
  facing: HorizontalFacing,
  open: boolean,
  hinge: DoorHinge = 'left',
): HorizontalFacing {
  if (!open) return facing;
  if (hinge === 'left') {
    switch (facing) {
      case 'north': return 'west';
      case 'west': return 'south';
      case 'south': return 'east';
      case 'east': return 'north';
    }
  }
  switch (facing) {
    case 'north': return 'east';
    case 'east': return 'south';
    case 'south': return 'west';
    case 'west': return 'north';
  }
}

export function oppositeFacing(facing: HorizontalFacing): HorizontalFacing {
  switch (facing) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}

export function counterClockwiseFacing(facing: HorizontalFacing): HorizontalFacing {
  switch (facing) {
    case 'north': return 'west';
    case 'west': return 'south';
    case 'south': return 'east';
    case 'east': return 'north';
  }
}

export function facingAxis(facing: HorizontalFacing): 'x' | 'z' {
  return facing === 'east' || facing === 'west' ? 'x' : 'z';
}

export const HORIZONTAL_OFFSET: Readonly<Record<HorizontalFacing, readonly [number, number, number]>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

export interface SlabPlacement {
  readonly slabType: 'bottom' | 'top';
}

/**
 * Vanilla-like slab half from the clicked face and hit height on that block.
 * Top face → bottom slab in the adjacent cell; bottom face → top slab;
 * side faces use whether the hit was above the midline.
 */
export function slabsCanMerge(existing: BlockId, placing: BlockId): boolean {
  return existing === placing;
}

export function slabTypeFromHit(nx: number, ny: number, nz: number, localY: number): 'bottom' | 'top' {
  void nx;
  void nz;
  if (ny > 0.5) return 'bottom';
  if (ny < -0.5) return 'top';
  return localY > 0.5 ? 'top' : 'bottom';
}

export interface StairPlacement {
  readonly facing: HorizontalFacing;
  readonly stairHalf: 'bottom' | 'top';
}

/**
 * Vanilla stairs: facing is the player's horizontal look. Half is bottom unless
 * the clicked face is the underside or a side hit above the midline.
 */
export function stairPlacementFromHit(
  nx: number,
  ny: number,
  nz: number,
  localY: number,
  viewX: number,
  viewZ: number,
): StairPlacement {
  void nx;
  void nz;
  const facing = horizontalFacingFromXZ(viewX, viewZ);
  if (ny < -0.5) return { facing, stairHalf: 'top' };
  if (ny > 0.5) return { facing, stairHalf: 'bottom' };
  return { facing, stairHalf: localY > 0.5 ? 'top' : 'bottom' };
}
