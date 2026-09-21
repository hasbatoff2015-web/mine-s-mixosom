import { rayAabbDistance, type CollisionBox } from '../world/collision';
import { getMobDefinition, type MobKind } from './mobDefinitions';

export interface MobPoseLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
}

/**
 * Targeting/interact volume in model space (feet origin, +Z = legacy back).
 * Physics collision keeps `MobDefinition.width/height`; this is ray hits only.
 *
 * Wolf/cat values are standing visual core (muzzle/head through rump), not the tail.
 */
export function mobTargetBounds(kind: MobKind): CollisionBox {
  if (kind === 'wolf') {
    return { minX: -0.3125, minY: 0, minZ: -0.75, maxX: 0.1875, maxY: 0.875, maxZ: 0.5625 };
  }
  if (kind === 'cat') {
    // Standing visual core after body origin Z=-8: muzzle reaches z=-0.8125,
    // torso to ~0.56, legs under the sausage. Tail is not required.
    return { minX: -0.1563, minY: 0, minZ: -0.85, maxX: 0.1563, maxY: 0.9, maxZ: 0.62 };
  }
  const definition = getMobDefinition(kind);
  const halfWidth = definition.width * 0.5;
  return {
    minX: -halfWidth,
    minY: 0,
    minZ: -halfWidth,
    maxX: halfWidth,
    maxY: definition.height,
    maxZ: halfWidth,
  };
}

/** Inverse of `visual.rotation.y = yaw` (Three.js Y rotation). */
export function worldDeltaToMobLocal(
  dx: number,
  dz: number,
  yaw: number,
): { readonly x: number; readonly z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

export function raycastMobTarget(
  origin: { readonly x: number; readonly y: number; readonly z: number },
  direction: { readonly x: number; readonly y: number; readonly z: number },
  pose: MobPoseLike,
  kind: MobKind,
): { readonly distance: number } | undefined {
  const yaw = pose.yaw ?? 0;
  const localOrigin = worldDeltaToMobLocal(origin.x - pose.x, origin.z - pose.z, yaw);
  const localDir = worldDeltaToMobLocal(direction.x, direction.z, yaw);
  return rayAabbDistance(
    { x: localOrigin.x, y: origin.y - pose.y, z: localOrigin.z },
    { x: localDir.x, y: direction.y, z: localDir.z },
    mobTargetBounds(kind),
  );
}
