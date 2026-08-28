import { BlockId } from '../blocks';
import type { VoxelWorld } from '../world/World';
import { getDirectSkyLight } from '../world/LightEngine';

/** Tick-based fire HP interval: 1 damage per second at 20 TPS. */
export const FIRE_DAMAGE_INTERVAL_TICKS = 20;
export const FIRE_DAMAGE_INTERVAL_SECONDS = 1;

/**
 * Daylight factor at which the sun is high enough for hostile burning.
 * Continuous (not a one-shot dawn event). Matches the existing day/night curve
 * used by mob spawning (~full day until 11_000, night 0.2).
 */
export const SUNLIGHT_DAYLIGHT_MIN = 0.82;

/** Raw skylight (0–15, time-independent) required for "open sky". */
export const SUNLIGHT_SKY_MIN = 14;

export type BurnCause = 'FIRE_CONTACT' | 'FIRE_ARROW' | 'SUNLIGHT' | 'LAVA';

export interface EntityAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export function aabbFromBody(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): EntityAabb {
  const half = width * 0.5;
  return {
    minX: x - half,
    minY: y,
    minZ: z - half,
    maxX: x + half,
    maxY: y + height,
    maxZ: z + half,
  };
}

/** True when the AABB volume overlaps any cell of `block`. Fire is non-solid. */
export function aabbOverlapsBlockType(
  world: VoxelWorld,
  box: EntityAabb,
  block: BlockId,
): boolean {
  const minX = Math.floor(box.minX + 1e-6);
  const maxX = Math.floor(box.maxX - 1e-6);
  const minY = Math.floor(box.minY + 1e-6);
  const maxY = Math.floor(box.maxY - 1e-6);
  const minZ = Math.floor(box.minZ + 1e-6);
  const maxZ = Math.floor(box.maxZ - 1e-6);
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (world.getBlock(x, y, z, false) === block) return true;
      }
    }
  }
  return false;
}

export function isSunHighEnough(daylight: number): boolean {
  return daylight >= SUNLIGHT_DAYLIGHT_MIN;
}

export function hasDirectSkyLight(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return world.skyLightAt(x, y, z) >= SUNLIGHT_SKY_MIN
    && getDirectSkyLight(world, x, y, z) >= SUNLIGHT_SKY_MIN;
}
