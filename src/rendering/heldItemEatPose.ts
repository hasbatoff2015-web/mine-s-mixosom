import type { Object3D } from 'three';

/**
 * Canonical first-person eat/drink bobble. Potions are food-kind items and use
 * this same pose; do not invent a second drink animation.
 */
export function applyEatDrinkHeldItemPose(model: Object3D, progress: number): void {
  if (progress <= 0) return;
  const cadence = Math.abs(Math.cos(progress * Math.PI * 8));
  const settle = Math.sin(Math.min(1, progress * 1.5) * Math.PI * 0.5);
  model.position.x -= 0.08 * settle;
  model.position.y += 0.10 * settle + cadence * 0.018;
  model.position.z += 0.11 * settle;
  model.rotation.x += 0.38 * settle;
  model.rotation.y += 0.25 * settle;
  model.rotation.z += 0.18 * cadence;
}
