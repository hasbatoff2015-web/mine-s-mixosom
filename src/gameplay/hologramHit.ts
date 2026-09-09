import { rayAabbDistance, type CollisionBox } from '../world/collision';
import { hologramWorldSize, type HologramKind } from '../../shared/hologramStyle';

export interface HologramHitTarget {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lines: readonly string[];
  readonly size?: number;
  readonly enabled?: boolean;
  readonly kind?: HologramKind;
  readonly backgroundEnabled?: boolean;
  readonly backgroundWidth?: number;
  readonly backgroundHeight?: number;
}

export interface HologramRayHit {
  readonly name: string;
  readonly distance: number;
}

export function hologramAabb(hologram: HologramHitTarget): CollisionBox {
  const extents = hologramWorldSize(hologram);
  const halfW = extents.width * 0.5;
  const halfH = extents.height * 0.5;
  const halfD = Math.max(extents.depth * 0.5, 0.65 * (hologram.size ?? 1));
  return {
    minX: hologram.x - halfW,
    maxX: hologram.x + halfW,
    minY: hologram.y - halfH,
    maxY: hologram.y + halfH,
    minZ: hologram.z - halfD,
    maxZ: hologram.z + halfD,
  };
}

export function closestPointOnAabb(
  point: { x: number; y: number; z: number },
  box: CollisionBox,
): { x: number; y: number; z: number } {
  return {
    x: Math.max(box.minX, Math.min(box.maxX, point.x)),
    y: Math.max(box.minY, Math.min(box.maxY, point.y)),
    z: Math.max(box.minZ, Math.min(box.maxZ, point.z)),
  };
}

export function distanceToHologramAabb(
  point: { x: number; y: number; z: number },
  hologram: HologramHitTarget,
): number {
  const closest = closestPointOnAabb(point, hologramAabb(hologram));
  const dx = point.x - closest.x;
  const dy = point.y - closest.y;
  const dz = point.z - closest.z;
  return Math.hypot(dx, dy, dz);
}

export function playerCanReachHologram(
  eye: { x: number; y: number; z: number },
  hologram: HologramHitTarget,
  maxDistance: number,
): boolean {
  return distanceToHologramAabb(eye, hologram) <= maxDistance;
}

export function pickHologramRayHit(
  holograms: readonly HologramHitTarget[],
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number,
): HologramRayHit | undefined {
  let closest: HologramRayHit | undefined;
  for (const hologram of holograms) {
    if (hologram.enabled === false) continue;
    const hit = rayAabbDistance(origin, direction, hologramAabb(hologram));
    if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
    if (closest && hit.distance >= closest.distance) continue;
    closest = { name: hologram.name, distance: hit.distance };
  }
  return closest;
}

/**
 * Hologram RMB wins when it is at least as close as the block under the crosshair.
 * Otherwise the existing block/item use pipeline runs.
 */
export function resolveHologramUseTarget(
  hologramHit: HologramRayHit | undefined,
  blockDistance: number | undefined,
): { kind: 'hologram'; name: string } | { kind: 'world' } {
  if (!hologramHit) return { kind: 'world' };
  if (blockDistance !== undefined && blockDistance < hologramHit.distance) return { kind: 'world' };
  return { kind: 'hologram', name: hologramHit.name };
}
