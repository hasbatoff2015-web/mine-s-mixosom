import { MIN_WORLD_Y, PLAYER_WIDTH, WORLD_HEIGHT } from '../core/constants';

/**
 * Inclusive minimum playable block X/Z.
 * Playable blocks satisfy `WORLD_BORDER_MIN <= x < WORLD_BORDER_MAX`.
 */
export const WORLD_BORDER_MIN = -10_000;
/**
 * Exclusive maximum playable block X/Z.
 * Physical border planes sit on X/Z = ±10_000.
 */
export const WORLD_BORDER_MAX = 10_000;

export const WORLD_BORDER_SPAN = WORLD_BORDER_MAX - WORLD_BORDER_MIN;

export const WORLD_BORDER_FADE_START = 50;
export const WORLD_BORDER_FADE_MID = 20;
export const WORLD_BORDER_FADE_NEAR = 5;
export const WORLD_BORDER_MID_ALPHA = 0.10;
export const WORLD_BORDER_NEAR_ALPHA = 0.22;
export const WORLD_BORDER_MAX_ALPHA = 0.28;

export const WORLD_BORDER_CLAIM_ERROR = 'Приват выходит за границу мира.';
export const WORLD_BORDER_HOME_SET_ERROR = 'Дом должен быть внутри границы мира.';
export const WORLD_BORDER_HOME_TELEPORT_ERROR = 'Дом находится за границей мира.';
export const WORLD_BORDER_SPAWN_SET_ERROR = 'Точка спавна должна быть внутри границы мира.';
export const WORLD_BORDER_TELEPORT_ERROR = 'Точка телепорта за границей мира.';
export const WORLD_BORDER_CLAN_BASE_ERROR = 'База клана должна быть внутри границы мира.';

export type WorldBorderSide = 'east' | 'west' | 'north' | 'south';

export interface PlayableAabb {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PlayableVolume {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function hermite01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Inclusive playable block cell. `x = 10000` and `x = -10001` are outside. */
export function isInsidePlayableBlock(x: number, z: number): boolean {
  return x >= WORLD_BORDER_MIN && x < WORLD_BORDER_MAX
    && z >= WORLD_BORDER_MIN && z < WORLD_BORDER_MAX;
}

/** A point is inside when it is not beyond the four border planes. Touching a plane is inside. */
export function isInsidePlayablePoint(x: number, z: number): boolean {
  return x >= WORLD_BORDER_MIN && x <= WORLD_BORDER_MAX
    && z >= WORLD_BORDER_MIN && z <= WORLD_BORDER_MAX;
}

export function isAabbInsidePlayableWorld(box: PlayableAabb): boolean {
  return box.minX >= WORLD_BORDER_MIN && box.maxX <= WORLD_BORDER_MAX
    && box.minZ >= WORLD_BORDER_MIN && box.maxZ <= WORLD_BORDER_MAX;
}

/** Inclusive block AABB must sit entirely in playable cells. */
export function isVolumeInsidePlayableWorld(volume: PlayableVolume): boolean {
  return volume.minX >= WORLD_BORDER_MIN && volume.maxX < WORLD_BORDER_MAX
    && volume.minZ >= WORLD_BORDER_MIN && volume.maxZ < WORLD_BORDER_MAX;
}

export function gameplayMayMutateBlock(x: number, z: number): boolean {
  return isInsidePlayableBlock(x, z);
}

export function distanceToWorldBorder(x: number, z: number): number {
  return Math.min(
    x - WORLD_BORDER_MIN,
    WORLD_BORDER_MAX - x,
    z - WORLD_BORDER_MIN,
    WORLD_BORDER_MAX - z,
  );
}

export function distanceToWorldBorderPlane(x: number, z: number, side: WorldBorderSide): number {
  if (side === 'east') return Math.abs(WORLD_BORDER_MAX - x);
  if (side === 'west') return Math.abs(x - WORLD_BORDER_MIN);
  if (side === 'south') return Math.abs(WORLD_BORDER_MAX - z);
  return Math.abs(z - WORLD_BORDER_MIN);
}

/**
 * Visual alpha vs camera distance to one border plane.
 * Fully invisible at `>= 50`, still translucent even at distance 0.
 */
export function worldBorderOpacity(distance: number): number {
  if (!Number.isFinite(distance) || distance >= WORLD_BORDER_FADE_START) return 0;
  if (distance <= WORLD_BORDER_FADE_NEAR) {
    const t = 1 - Math.max(0, distance) / WORLD_BORDER_FADE_NEAR;
    return WORLD_BORDER_NEAR_ALPHA
      + (WORLD_BORDER_MAX_ALPHA - WORLD_BORDER_NEAR_ALPHA) * hermite01(t);
  }
  if (distance <= WORLD_BORDER_FADE_MID) {
    const t = (WORLD_BORDER_FADE_MID - distance)
      / (WORLD_BORDER_FADE_MID - WORLD_BORDER_FADE_NEAR);
    return WORLD_BORDER_MID_ALPHA
      + (WORLD_BORDER_NEAR_ALPHA - WORLD_BORDER_MID_ALPHA) * hermite01(t);
  }
  const t = (WORLD_BORDER_FADE_START - distance)
    / (WORLD_BORDER_FADE_START - WORLD_BORDER_FADE_MID);
  return WORLD_BORDER_MID_ALPHA * hermite01(t);
}

export function clipAabbAxisToWorldBorder(
  min: number,
  max: number,
  requested: number,
  planeMin = WORLD_BORDER_MIN,
  planeMax = WORLD_BORDER_MAX,
): number {
  if (requested > 0) {
    const room = planeMax - max;
    if (room <= 0) return 0;
    return Math.min(requested, room);
  }
  if (requested < 0) {
    const room = min - planeMin;
    if (room <= 0) return 0;
    return Math.max(requested, -room);
  }
  return 0;
}

export function clampHorizontalCenterToWorldBorder(
  x: number,
  z: number,
  width = PLAYER_WIDTH,
): { x: number; z: number } {
  const half = Math.max(0, width * 0.5);
  const minCenter = WORLD_BORDER_MIN + half;
  const maxCenter = WORLD_BORDER_MAX - half;
  return {
    x: Math.max(minCenter, Math.min(maxCenter, x)),
    z: Math.max(minCenter, Math.min(maxCenter, z)),
  };
}

export const clampPlayerCenterToWorldBorder = clampHorizontalCenterToWorldBorder;

export function playerAabbAt(
  x: number,
  z: number,
  width = PLAYER_WIDTH,
): PlayableAabb {
  const half = width * 0.5;
  return {
    minX: x - half,
    maxX: x + half,
    minZ: z - half,
    maxZ: z + half,
  };
}

export function isPlayerCenterInsidePlayableWorld(
  x: number,
  z: number,
  width = PLAYER_WIDTH,
): boolean {
  return isAabbInsidePlayableWorld(playerAabbAt(x, z, width));
}

export interface StandingWorld {
  surfaceY(x: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
  isLiquid?(x: number, y: number, z: number): boolean;
}

function standingPoseAt(
  world: StandingWorld,
  x: number,
  y: number,
  z: number,
  keepHintY: boolean,
): { x: number; y: number; z: number } {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const surface = world.surfaceY(bx, bz);
  let feetY = Math.max(MIN_WORLD_Y + 1, surface + 1.01);
  if (keepHintY && Number.isFinite(y)) feetY = y;
  let guard = 0;
  while (
    guard < WORLD_HEIGHT
    && (
      world.isSolid(bx, Math.floor(feetY), bz)
      || world.isSolid(bx, Math.floor(feetY) + 1, bz)
    )
  ) {
    feetY += 1;
    guard += 1;
  }
  return { x, y: feetY, z };
}

function standingColumnUnsafe(
  world: StandingWorld,
  pose: { x: number; y: number; z: number },
): boolean {
  if (!world.isLiquid) return false;
  const bx = Math.floor(pose.x);
  const bz = Math.floor(pose.z);
  return world.isLiquid(bx, Math.floor(pose.y), bz)
    || world.isLiquid(bx, Math.floor(pose.y) + 1, bz);
}

/**
 * Clamp XZ so the body fits between the planes, then stand on solid ground.
 * Y is never limited by the border.
 */
export function relocateStandingPoseInsidePlayableWorld(
  world: StandingWorld,
  x: number,
  y: number,
  z: number,
  width = PLAYER_WIDTH,
): { x: number; y: number; z: number } {
  const clamped = clampHorizontalCenterToWorldBorder(x, z, width);
  const keepHintY = Math.abs(clamped.x - x) < 1e-8 && Math.abs(clamped.z - z) < 1e-8;
  const first = standingPoseAt(world, clamped.x, y, clamped.z, keepHintY);
  if (!standingColumnUnsafe(world, first)) return first;
  const towardX = clamped.x >= 0 ? -1 : 1;
  const towardZ = clamped.z >= 0 ? -1 : 1;
  for (let step = 1; step <= 48; step += 1) {
    const trials = [
      { x: clamped.x + towardX * step, z: clamped.z },
      { x: clamped.x, z: clamped.z + towardZ * step },
      { x: clamped.x + towardX * step, z: clamped.z + towardZ * step },
    ];
    for (const trial of trials) {
      const next = clampHorizontalCenterToWorldBorder(trial.x, trial.z, width);
      const pose = standingPoseAt(world, next.x, y, next.z, false);
      if (!standingColumnUnsafe(world, pose)) return pose;
    }
  }
  return first;
}
