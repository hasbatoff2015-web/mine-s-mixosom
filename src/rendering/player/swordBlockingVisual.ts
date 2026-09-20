import { type Object3D } from 'three';

/**
 * Raise/lower duration. Classic Java applied BLOCK immediately; we keep a
 * short render-only ease so tap/release does not teleport the sword.
 */
export const SWORD_BLOCKING_TRANSITION_SECONDS = 0.1;

/**
 * First-person extra TRS on top of `FIRST_PERSON_SPRITE_POSE` / QA overlay.
 * Adapted from the 1.5.2 BLOCK pose (raise toward center, blade across view),
 * not a copy of vanilla GL numbers.
 *
 * Third-person does not extra-transform the sword mesh. The held item stays on
 * `rightArm` → `heldItem` with `/moveitems` local calibration, same as LMB
 * swing: only the arm pose changes, so the sword follows the hand.
 */
export const FIRST_PERSON_SWORD_BLOCKING_OFFSET = Object.freeze({
  position: Object.freeze({ x: -0.30, y: 0.18, z: 0.08 }),
  rotation: Object.freeze({ x: -0.65, y: 0.52, z: 1.00 }),
});

/** Fully-raised third-person right-arm pose while blocking. */
export const THIRD_PERSON_SWORD_BLOCKING_ARM = Object.freeze({
  x: 0.86,
  y: -0.62,
  z: 0.42,
});

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
