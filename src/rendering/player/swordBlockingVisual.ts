import { Euler, Quaternion, type Object3D } from 'three';
import {
  applyThirdPersonHeldItemTransform,
  type ThirdPersonHeldItemTransform,
} from './thirdPersonHeldItem';

/**
 * Raise/lower duration. Classic Java applied BLOCK immediately; we keep a
 * short render-only ease so tap/release does not teleport the sword.
 */
export const SWORD_BLOCKING_TRANSITION_SECONDS = 0.1;

/**
 * First-person extra TRS on top of `FIRST_PERSON_SPRITE_POSE` / QA overlay.
 * Adapted from the 1.5.2 BLOCK pose (raise toward center, blade across view),
 * not a copy of vanilla GL numbers.
 */
export const FIRST_PERSON_SWORD_BLOCKING_OFFSET = Object.freeze({
  position: Object.freeze({ x: -0.30, y: 0.18, z: 0.08 }),
  rotation: Object.freeze({ x: -0.65, y: 0.52, z: 1.00 }),
});

/**
 * Third-person extra TRS on top of the `/moveitems` sword calibration.
 * Local extra rotation is multiplied onto the base quaternion.
 */
export const THIRD_PERSON_SWORD_BLOCKING_OFFSET = Object.freeze({
  position: Object.freeze({ x: 0.05, y: 0.05, z: -0.08 }),
  rotation: Object.freeze({ x: -0.18, y: -0.85, z: -1.25 }),
});

/** Fully-raised third-person right-arm pose while blocking. */
export const THIRD_PERSON_SWORD_BLOCKING_ARM = Object.freeze({
  x: 0.86,
  y: -0.62,
  z: 0.42,
});

const _baseEuler = new Euler(0, 0, 0, 'XYZ');
const _extraEuler = new Euler(0, 0, 0, 'XYZ');
const _resultEuler = new Euler(0, 0, 0, 'XYZ');
const _baseQuat = new Quaternion();
const _extraQuat = new Quaternion();
const _workQuat = new Quaternion();
const _identityQuat = new Quaternion();

export function advanceSwordBlockingProgress(
  current: number,
  blocking: boolean,
  deltaSeconds: number,
): number {
  const target = blocking ? 1 : 0;
  if (current === target) return current;
  const step = Math.max(0, deltaSeconds) / SWORD_BLOCKING_TRANSITION_SECONDS;
  return blocking ? Math.min(1, current + step) : Math.max(0, current - step);
}

export function applyFirstPersonSwordBlockingOverlay(model: Object3D, progress: number): void {
  if (progress <= 0) return;
  const t = progress >= 1 ? 1 : progress;
  const position = FIRST_PERSON_SWORD_BLOCKING_OFFSET.position;
  const rotation = FIRST_PERSON_SWORD_BLOCKING_OFFSET.rotation;
  model.position.x += position.x * t;
  model.position.y += position.y * t;
  model.position.z += position.z * t;
  model.rotation.x += rotation.x * t;
  model.rotation.y += rotation.y * t;
  model.rotation.z += rotation.z * t;
}

export function applyThirdPersonSwordBlockingTransform(
  model: Object3D,
  base: ThirdPersonHeldItemTransform,
  progress: number,
): void {
  if (progress <= 1e-5) {
    applyThirdPersonHeldItemTransform(model, base);
    return;
  }
  const t = progress >= 1 ? 1 : progress;
  const offset = THIRD_PERSON_SWORD_BLOCKING_OFFSET;
  model.position.set(
    base.position.x + offset.position.x * t,
    base.position.y + offset.position.y * t,
    base.position.z + offset.position.z * t,
  );
  _baseEuler.set(base.rotation.x, base.rotation.y, base.rotation.z, 'XYZ');
  _baseQuat.setFromEuler(_baseEuler);
  _extraEuler.set(offset.rotation.x, offset.rotation.y, offset.rotation.z, 'XYZ');
  _extraQuat.setFromEuler(_extraEuler);
  _workQuat.copy(_identityQuat).slerp(_extraQuat, t);
  _baseQuat.multiply(_workQuat);
  _resultEuler.setFromQuaternion(_baseQuat, 'XYZ');
  model.rotation.set(_resultEuler.x, _resultEuler.y, _resultEuler.z);
  model.scale.set(base.scale.x, base.scale.y, base.scale.z);
}
