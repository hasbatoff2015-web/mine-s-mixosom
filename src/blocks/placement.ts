import type { BlockAttachment, HorizontalFacing } from './types';

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
