import { getAttackProfile } from '../combat/CombatSystem';
import { dropScatterVelocity } from '../gameplay/random';
import { ItemId } from '../items';
import { getBlockDefinition } from '../blocks';
import { isSpaceClear } from './voxelPhysics';
import type { VoxelWorld } from '../world/World';

/**
 * Mega Zombie boss numbers.
 *
 * A normal titanium sword hit is `getAttackProfile(titanium_sword).baseDamage`
 * (10) with no critical multiplier. Mobs have no armor. The original pool was
 * 10 × 300 = 3000. Maximum health is now half of that: 1500.
 *
 * Critical hits exist (`CombatSystem.isCriticalHit`, airborne, ×1.5). They are
 * not baked into the pool.
 *
 * Melee damage is the raw attack before the player's armor formula
 * `incoming * (25 - armorPoints) / 25`. The base attack is 5.
 * Full titanium is 20 points, so 5 becomes 1. An unarmored player takes 5.
 */

export const TITANIUM_SWORD_NORMAL_HIT = getAttackProfile(ItemId.TitaniumSword).baseDamage;
/** Half of the original 3000 HP pool (10 damage × 300 hits). */
export const MEGA_ZOMBIE_MAX_HEALTH = 1500;
export const MEGA_ZOMBIE_ATTACK_DAMAGE = 5;
export const MEGA_ZOMBIE_ATTACK_COOLDOWN_SECONDS = 1.25;
export const MEGA_ZOMBIE_SPEED = 2.6;
export const MEGA_ZOMBIE_WIDTH = 2.3;
export const MEGA_ZOMBIE_HEIGHT = 3.7;
export const MEGA_ZOMBIE_EYE_HEIGHT = 3.15;
export const MEGA_ZOMBIE_ATTACK_RANGE = 4.2;

/** Original MutantZombieRenderer.preRenderCallback scale. Applied to the whole model. */
export const MEGA_ZOMBIE_MODEL_SCALE = 1.3;
/**
 * Scaled lower-leg inflate sits 0.13 blocks under y=0.
 * The rig itself is not resized; the whole model is lifted this far.
 */
export const MEGA_ZOMBIE_FOOT_LIFT = 0.13;

export const MEGA_ZOMBIE_REVENGE_SECONDS = 4.5;
export const MEGA_ZOMBIE_LIFETIME_SECONDS = 30 * 60;
export const MEGA_ZOMBIE_CYCLE_SECONDS = 30 * 60;
export const MEGA_ZOMBIE_WARNING_LEAD_SECONDS = 5 * 60;
export const MEGA_ZOMBIE_DEATH_SECONDS = 1.25;
/** Items appear next to the corpse. The burst is velocity, not a position teleport. */
export const MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS = 0.9;
/** `dropScatterVelocity` horizontal span is 1.4 × this, so about ±4.5 blocks/s. */
export const MEGA_ZOMBIE_LOOT_HORIZONTAL_SCALE = 6.4;
/** Upward speed before the existing item gravity (-18). Apex stays about 1.5–2 blocks. */
export const MEGA_ZOMBIE_LOOT_UP_MIN = 7.5;
export const MEGA_ZOMBIE_LOOT_UP_SPAN = 2.5;
/** Death rockets use flights 1, 2, and 3 so the three bursts are not the same tick. */
export const MEGA_ZOMBIE_DEATH_FIREWORK_FLIGHTS = [1, 2, 3] as const;
/** 3D distance from the configured `/boss setspawn` point. Matches entity interest (XYZ). */
export const MEGA_ZOMBIE_BAR_RADIUS = 30;
export const MEGA_ZOMBIE_SPAWN_SEARCH_RADIUS = 4;
export const MEGA_ZOMBIE_SPAWN_SEARCH_DOWN = 6;
export const MEGA_ZOMBIE_SPAWN_SEARCH_UP = 2;

export const MEGA_ZOMBIE_ENTITY_ID_PREFIX = 'mega-zombie-';

export const MEGA_ZOMBIE_WARNING_TEXT = 'Через 5 минут появится босс Мега-зомби на арене!';
export const MEGA_ZOMBIE_SPAWN_TEXT = 'Мега-зомби появился на арене!';
export const MEGA_ZOMBIE_TIMEOUT_TEXT = 'Мега-зомби покинул арену.';
export const MEGA_ZOMBIE_NO_BOSS_TEXT = 'Активного Мега-зомби нет.';
export const MEGA_ZOMBIE_KILL_COMMAND_TEXT = 'Мега-зомби убит.';
export const MEGA_ZOMBIE_ARENA_TOO_SMALL_TEXT = 'Арена слишком низкая или узкая для Мега-зомби. Раздвиньте точки хотя бы на 4 блока по Y и на 3 блока по X и Z.';
export const MEGA_ZOMBIE_SPAWN_UNSAFE_TEXT = 'Не удалось найти безопасную точку появления рядом со spawn.';

export function megaZombieKillText(name: string): string {
  return `Мега-зомби был убит игроком ${name}!`;
}

export interface ArenaPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ArenaAabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface MegaZombieRuntime {
  arena: ArenaAabb | null;
  /** Configured `/boss setspawn` point. HP-bar range uses this, not the resolved feet. */
  configuredSpawn: ArenaPoint | null;
  revengePlayerId: string | null;
  revengeSeconds: number;
  lastPlayerAttackerId: string | null;
  lastPlayerAttackerName: string | null;
}

export function createMegaZombieRuntime(
  arena: ArenaAabb | null = null,
  configuredSpawn: ArenaPoint | null = null,
): MegaZombieRuntime {
  return {
    arena,
    configuredSpawn,
    revengePlayerId: null,
    revengeSeconds: 0,
    lastPlayerAttackerId: null,
    lastPlayerAttackerName: null,
  };
}

/** 3D distance, same axes as entity interest and boss targeting. */
export function megaZombieHealthBarVisible(
  player: ArenaPoint,
  spawn: ArenaPoint | null | undefined,
  radius = MEGA_ZOMBIE_BAR_RADIUS,
): boolean {
  if (!spawn || !Number.isFinite(radius) || radius < 0) return false;
  const dx = player.x - spawn.x;
  const dy = player.y - spawn.y;
  const dz = player.z - spawn.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function arenaCanHoldBoss(
  arena: ArenaAabb,
  width = MEGA_ZOMBIE_WIDTH,
  height = MEGA_ZOMBIE_HEIGHT,
): boolean {
  return arena.maxX - arena.minX >= width - 1e-4
    && arena.maxZ - arena.minZ >= width - 1e-4
    && arena.maxY - arena.minY >= height - 1e-4;
}

export function isFinitePoint(point: ArenaPoint | null | undefined): point is ArenaPoint {
  return !!point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z);
}

export function arenaFromCorners(pos1: ArenaPoint, pos2: ArenaPoint): ArenaAabb | undefined {
  if (!isFinitePoint(pos1) || !isFinitePoint(pos2)) return undefined;
  return {
    minX: Math.min(pos1.x, pos2.x),
    maxX: Math.max(pos1.x, pos2.x),
    minY: Math.min(pos1.y, pos2.y),
    maxY: Math.max(pos1.y, pos2.y),
    minZ: Math.min(pos1.z, pos2.z),
    maxZ: Math.max(pos1.z, pos2.z),
  };
}

export function pointInArena(arena: ArenaAabb, x: number, y: number, z: number): boolean {
  return x >= arena.minX && x <= arena.maxX
    && y >= arena.minY && y <= arena.maxY
    && z >= arena.minZ && z <= arena.maxZ;
}

export function clampBossToArena(
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  arena: ArenaAabb,
  width: number,
  height: number,
): void {
  const half = Math.max(0, width) * 0.5;
  const body = Math.max(0, height);
  clampAxis(position, velocity, 'x', arena.minX + half, arena.maxX - half, (arena.minX + arena.maxX) * 0.5);
  clampAxis(position, velocity, 'z', arena.minZ + half, arena.maxZ - half, (arena.minZ + arena.maxZ) * 0.5);
  const feetMax = arena.maxY - body;
  if (feetMax > arena.minY) {
    clampAxis(position, velocity, 'y', arena.minY, feetMax, (arena.minY + arena.maxY) * 0.5);
  }
}

function clampAxis(
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  axis: 'x' | 'y' | 'z',
  min: number,
  max: number,
  center: number,
): void {
  if (!(max > min)) {
    position[axis] = center;
    velocity[axis] = 0;
    return;
  }
  if (position[axis] < min) {
    position[axis] = min;
    if (velocity[axis] < 0) velocity[axis] = 0;
  } else if (position[axis] > max) {
    position[axis] = max;
    if (velocity[axis] > 0) velocity[axis] = 0;
  }
}

export interface BossFocus {
  id: string;
  x: number;
  y: number;
  z: number;
  eyeY: number;
  alive: boolean;
  targetable: boolean;
}

/**
 * Nearest living, targetable player inside the 3D arena.
 * An active revenge id wins when that player is still eligible.
 */
export function selectMegaZombieTarget(
  bossX: number,
  bossY: number,
  bossZ: number,
  arena: ArenaAabb | null,
  foci: readonly BossFocus[],
  revengePlayerId: string | null,
  revengeActive: boolean,
): BossFocus | undefined {
  if (!arena) return undefined;
  let revenge: BossFocus | undefined;
  let nearest: BossFocus | undefined;
  let nearestDistance = Infinity;
  for (let index = 0; index < foci.length; index += 1) {
    const focus = foci[index]!;
    if (!focus.alive || !focus.targetable) continue;
    if (!pointInArena(arena, focus.x, focus.y, focus.z)) continue;
    if (revengeActive && revengePlayerId && focus.id === revengePlayerId) revenge = focus;
    const dx = focus.x - bossX;
    const dy = focus.y - bossY;
    const dz = focus.z - bossZ;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = focus;
    }
  }
  return revenge ?? nearest;
}

/**
 * Successful player or projectile damage records the attacker.
 * Fire and other environment damage do not. Revenge requires the attacker
 * to be inside the arena at the moment the hit is accepted.
 */
export function noteMegaZombieHit(
  runtime: MegaZombieRuntime,
  source: string | undefined,
  attackerId: string | undefined,
  attackerInsideArena: boolean,
  attackerName?: string,
): void {
  if (!attackerId) return;
  if (source !== 'player' && source !== 'projectile') return;
  runtime.lastPlayerAttackerId = attackerId;
  if (attackerName) runtime.lastPlayerAttackerName = attackerName;
  if (!attackerInsideArena || !runtime.arena) return;
  runtime.revengePlayerId = attackerId;
  runtime.revengeSeconds = MEGA_ZOMBIE_REVENGE_SECONDS;
}

export interface MegaZombieLootMotion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
}

/**
 * Spawn beside the corpse, toss upward, and fan out on X/Z.
 * Gravity and collisions stay in `DroppedItemManager`.
 */
export function megaZombieLootMotion(random: () => number = Math.random): MegaZombieLootMotion {
  const [vx, , vz] = dropScatterVelocity(random, { horizontalScale: MEGA_ZOMBIE_LOOT_HORIZONTAL_SCALE });
  const span = MEGA_ZOMBIE_LOOT_ORIGIN_RADIUS;
  return {
    x: (random() * 2 - 1) * span,
    y: 0.55,
    z: (random() * 2 - 1) * span,
    vx,
    vy: MEGA_ZOMBIE_LOOT_UP_MIN + random() * MEGA_ZOMBIE_LOOT_UP_SPAN,
    vz,
  };
}

export interface MegaZombieSpawnResult {
  readonly ok: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly message?: string;
}

function bodyInsideArena(
  arena: ArenaAabb,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): boolean {
  const half = width * 0.5;
  return x - half >= arena.minX - 1e-4
    && x + half <= arena.maxX + 1e-4
    && z - half >= arena.minZ - 1e-4
    && z + half <= arena.maxZ + 1e-4
    && y >= arena.minY - 1e-4
    && y + height <= arena.maxY + 1e-4;
}

function columnSupportedFeet(
  world: VoxelWorld,
  x: number,
  z: number,
  requestedY: number,
  arena: ArenaAabb,
  width: number,
  height: number,
): number | undefined {
  const top = Math.floor(requestedY + MEGA_ZOMBIE_SPAWN_SEARCH_UP);
  const bottom = Math.floor(requestedY - MEGA_ZOMBIE_SPAWN_SEARCH_DOWN);
  let best: number | undefined;
  let bestDistance = Infinity;
  for (let blockY = top; blockY >= bottom; blockY -= 1) {
    const block = world.getBlock(Math.floor(x), blockY, Math.floor(z));
    if (getBlockDefinition(block).solid !== true) continue;
    const feet = blockY + 1;
    if (!bodyInsideArena(arena, x, feet, z, width, height)) continue;
    if (!isSpaceClear(world, { x, y: feet, z }, { width, height })) continue;
    const distance = Math.abs(feet - requestedY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = feet;
    }
  }
  return best;
}

/**
 * Prefer a supported column near the configured spawn.
 * A clear point inside a tall arena is kept so the boss can fall.
 * A body that does not fit the arena is refused instead of being pinned in the air.
 */
export function resolveMegaZombieSpawn(
  world: VoxelWorld,
  requested: ArenaPoint,
  arena: ArenaAabb,
  width = MEGA_ZOMBIE_WIDTH,
  height = MEGA_ZOMBIE_HEIGHT,
): MegaZombieSpawnResult {
  if (!isFinitePoint(requested)) {
    return { ok: false, x: 0, y: 0, z: 0, message: 'Некорректная точка появления.' };
  }
  if (!arenaCanHoldBoss(arena, width, height)) {
    return { ok: false, x: requested.x, y: requested.y, z: requested.z, message: MEGA_ZOMBIE_ARENA_TOO_SMALL_TEXT };
  }
  let best: { x: number; y: number; z: number; score: number } | undefined;
  const radius = MEGA_ZOMBIE_SPAWN_SEARCH_RADIUS;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const x = requested.x + dx;
      const z = requested.z + dz;
      const feet = columnSupportedFeet(world, x, z, requested.y, arena, width, height);
      if (feet === undefined) continue;
      const score = dx * dx + dz * dz + Math.abs(feet - requested.y) * 0.01;
      if (!best || score < best.score) best = { x, y: feet, z, score };
    }
  }
  if (best) return { ok: true, x: best.x, y: best.y, z: best.z };
  if (
    bodyInsideArena(arena, requested.x, requested.y, requested.z, width, height)
    && isSpaceClear(world, requested, { width, height })
  ) {
    return { ok: true, x: requested.x, y: requested.y, z: requested.z };
  }
  return { ok: false, x: requested.x, y: requested.y, z: requested.z, message: MEGA_ZOMBIE_SPAWN_UNSAFE_TEXT };
}
