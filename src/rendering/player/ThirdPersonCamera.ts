import * as THREE from 'three';
import {
  blockCollisionBoxes,
  collisionCandidateCellRange,
  type CollisionBox,
} from '../../world/collision';
import type { BlockNeighborView } from '../../world/blockGeometry';

export type CameraPerspective = 'firstPerson' | 'thirdPersonBack' | 'thirdPersonFront';

export const THIRD_PERSON_CAMERA_DISTANCE = 4;
export const THIRD_PERSON_CAMERA_PROBE_RADIUS = 0.1;
export const THIRD_PERSON_CAMERA_CLEARANCE = 0.04;

export function nextCameraPerspective(current: CameraPerspective): CameraPerspective {
  if (current === 'firstPerson') return 'thirdPersonBack';
  if (current === 'thirdPersonBack') return 'thirdPersonFront';
  return 'firstPerson';
}

export interface CameraCollisionSource {
  collisionBoxes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): readonly CollisionBox[];
}

export function worldCameraCollisionSource(world: BlockNeighborView): CameraCollisionSource {
  return {
    collisionBoxes: (minX, minY, minZ, maxX, maxY, maxZ) => {
      const range = collisionCandidateCellRange(minX, minY, minZ, maxX, maxY, maxZ);
      const boxes: CollisionBox[] = [];
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let z = range.minZ; z <= range.maxZ; z += 1) {
          for (let x = range.minX; x <= range.maxX; x += 1) {
            boxes.push(...blockCollisionBoxes(world, x, y, z));
          }
        }
      }
      return boxes;
    },
  };
}

const PROBE_SIGNS: readonly (readonly [number, number, number])[] = Object.freeze([
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
]);

/** Slab ray parameter in world units. Returns undefined when the segment misses the AABB. */
export function segmentAabbDistance(origin: THREE.Vector3, direction: THREE.Vector3, length: number, box: CollisionBox): number | undefined {
  let enter = 0;
  let exit = length;
  for (const [axis, min, max] of [
    ['x', box.minX, box.maxX], ['y', box.minY, box.maxY], ['z', box.minZ, box.maxZ],
  ] as const) {
    const component = direction[axis];
    const start = origin[axis];
    if (Math.abs(component) < 1e-9) {
      if (start < min || start > max) return undefined;
      continue;
    }
    let near = (min - start) / component;
    let far = (max - start) / component;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return undefined;
  }
  return enter >= 0 && enter <= length ? enter : undefined;
}

/** Eight corner probes approximate the swept near-camera volume, including fences/slabs/stairs. */
export function availableThirdPersonDistance(
  pivot: THREE.Vector3,
  direction: THREE.Vector3,
  desiredDistance: number,
  source: CameraCollisionSource,
  radius = THIRD_PERSON_CAMERA_PROBE_RADIUS,
): number {
  const length = Math.max(0, desiredDistance);
  if (length === 0) return 0;
  const rayDirection = direction.clone().normalize();
  const desired = pivot.clone().addScaledVector(rayDirection, length);
  const boxes = source.collisionBoxes(
    Math.min(pivot.x, desired.x) - radius,
    Math.min(pivot.y, desired.y) - radius,
    Math.min(pivot.z, desired.z) - radius,
    Math.max(pivot.x, desired.x) + radius,
    Math.max(pivot.y, desired.y) + radius,
    Math.max(pivot.z, desired.z) + radius,
  );
  let available = length;
  for (const sign of PROBE_SIGNS) {
    const origin = pivot.clone().add(new THREE.Vector3(sign[0] * radius, sign[1] * radius, sign[2] * radius));
    for (const box of boxes) {
      const hit = segmentAabbDistance(origin, rayDirection, length, box);
      if (hit !== undefined) available = Math.min(available, Math.max(0, hit - THIRD_PERSON_CAMERA_CLEARANCE));
    }
  }
  return available;
}

/** Obstructions pull in immediately; clear space restores smoothly to avoid wall-edge popping. */
export function smoothThirdPersonDistance(current: number, available: number, deltaSeconds: number): number {
  if (available <= current) return available;
  const blend = 1 - Math.exp(-Math.max(0, deltaSeconds) * 12);
  return current + (available - current) * blend;
}
