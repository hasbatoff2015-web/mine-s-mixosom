import * as THREE from 'three';

export const ARROW_AIR_DRAG_PER_TICK = 0.99;
export const ARROW_WATER_DRAG_PER_TICK = 0.6;
export const ARROW_GRAVITY_PER_TICK = 0.05;

export function applyArrowDragAndGravity(velocity: THREE.Vector3, inWater = false): THREE.Vector3 {
  velocity.multiplyScalar(inWater ? ARROW_WATER_DRAG_PER_TICK : ARROW_AIR_DRAG_PER_TICK);
  velocity.y -= ARROW_GRAVITY_PER_TICK;
  return velocity;
}

export function arrowDamageFromVelocity(velocity: Readonly<THREE.Vector3>, critical = false): number {
  const speedDamage = Math.max(1, Math.ceil(Math.hypot(velocity.x, velocity.y, velocity.z) * 2));
  return critical ? speedDamage + Math.max(1, Math.floor(speedDamage * 0.25)) : speedDamage;
}

export function inaccurateArrowDirection(
  direction: Readonly<THREE.Vector3>,
  random: () => number = Math.random,
  spread = 0.0075,
): THREE.Vector3 {
  const result = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  result.x += gaussian(random) * spread;
  result.y += gaussian(random) * spread;
  result.z += gaussian(random) * spread;
  return result.normalize();
}

function gaussian(random: () => number): number {
  const u = Math.max(Number.EPSILON, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}
