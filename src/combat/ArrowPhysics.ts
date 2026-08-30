import * as THREE from 'three';
import { systemRandomFn, type RandomFn } from '../gameplay/random';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { blockSelectionBoxes } from '../world/selection';

/** Transient support record shared by both projectile owners. */
export interface EmbeddedArrowState {
  readonly x: number; readonly y: number; readonly z: number;
  readonly block: VoxelHit['block'];
  readonly impactPoint: THREE.Vector3;
  readonly impactVelocity: THREE.Vector3;
}

export function embedArrow(hit: VoxelHit, velocity: THREE.Vector3): EmbeddedArrowState {
  return { x: hit.x, y: hit.y, z: hit.z, block: hit.block,
    impactPoint: hit.point.clone().addScaledVector(hit.normal, -0.001),
    impactVelocity: velocity.clone() };
}

export function arrowSupportIntact(world: VoxelWorld, support: EmbeddedArrowState): boolean {
  if (world.getBlock(support.x, support.y, support.z, false) !== support.block) return false;
  const p = support.impactPoint;
  return blockSelectionBoxes(world, support.x, support.y, support.z).some((box) =>
    p.x >= box.minX - 1e-6 && p.x <= box.maxX + 1e-6
    && p.y >= box.minY - 1e-6 && p.y <= box.maxY + 1e-6
    && p.z >= box.minZ - 1e-6 && p.z <= box.maxZ + 1e-6);
}

/** 1.8 residual motion: each pre-impact component times random [0, 0.2). */
export function releaseEmbeddedArrow(velocity: THREE.Vector3, support: EmbeddedArrowState, random: () => number): void {
  velocity.set(support.impactVelocity.x * random() * 0.2,
    support.impactVelocity.y * random() * 0.2, support.impactVelocity.z * random() * 0.2);
}

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
  random: RandomFn = systemRandomFn,
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
