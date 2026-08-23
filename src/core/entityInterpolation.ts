import { ENTITY_SNAP_DISTANCE, lerp } from './constants';

export interface EntityRenderPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  walkPhase: number;
}

export const ENTITY_SNAP_DISTANCE_SQ = ENTITY_SNAP_DISTANCE * ENTITY_SNAP_DISTANCE;

export function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}

export function shouldSnapPose(
  previous: Readonly<EntityRenderPose>,
  current: Readonly<EntityRenderPose>,
  thresholdSq = ENTITY_SNAP_DISTANCE_SQ,
): boolean {
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const dz = current.z - previous.z;
  return dx * dx + dy * dy + dz * dz >= thresholdSq;
}

export function copyPose(source: Readonly<EntityRenderPose>): EntityRenderPose {
  return {
    x: source.x,
    y: source.y,
    z: source.z,
    yaw: source.yaw,
    walkPhase: source.walkPhase,
  };
}

export function snapPose(previous: EntityRenderPose, current: Readonly<EntityRenderPose>): void {
  previous.x = current.x;
  previous.y = current.y;
  previous.z = current.z;
  previous.yaw = current.yaw;
  previous.walkPhase = current.walkPhase;
}

export function interpolatePose(
  previous: Readonly<EntityRenderPose>,
  current: Readonly<EntityRenderPose>,
  alpha: number,
): EntityRenderPose {
  const t = Math.max(0, Math.min(1, alpha));
  if (shouldSnapPose(previous, current)) {
    return copyPose(current);
  }
  return {
    x: lerp(previous.x, current.x, t),
    y: lerp(previous.y, current.y, t),
    z: lerp(previous.z, current.z, t),
    yaw: lerpAngle(previous.yaw, current.yaw, t),
    walkPhase: lerp(previous.walkPhase, current.walkPhase, t),
  };
}

export function interpolateVec3(
  prevX: number,
  prevY: number,
  prevZ: number,
  curX: number,
  curY: number,
  curZ: number,
  alpha: number,
  snapDistanceSq = ENTITY_SNAP_DISTANCE_SQ,
): { x: number; y: number; z: number } {
  const t = Math.max(0, Math.min(1, alpha));
  const dx = curX - prevX;
  const dy = curY - prevY;
  const dz = curZ - prevZ;
  if (dx * dx + dy * dy + dz * dz >= snapDistanceSq) {
    return { x: curX, y: curY, z: curZ };
  }
  return {
    x: lerp(prevX, curX, t),
    y: lerp(prevY, curY, t),
    z: lerp(prevZ, curZ, t),
  };
}
