import type { BlockAttachment, DoorHinge, HorizontalFacing } from './types';

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
