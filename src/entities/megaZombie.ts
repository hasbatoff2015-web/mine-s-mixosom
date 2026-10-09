import { getAttackProfile } from '../combat/CombatSystem';
import { ItemId } from '../items';

/**
 * Mega Zombie boss numbers.
 *
 * A normal titanium sword hit is `getAttackProfile(titanium_sword).baseDamage`
 * with no critical multiplier. Mobs have no armor, so that value is the HP
 * removed by one accepted hit. Three hundred of those hits set max health.
 *
 * Critical hits exist (`CombatSystem.isCriticalHit`, airborne, ×1.5) and are
 * not included in this pool. A crit still deals 15 and simply ends the fight sooner.
 *
 * Melee damage is raw damage before the player's armor formula
 * `incoming * (25 - armorPoints) / 25`. Full titanium is 20 points (3+8+6+3),
 * so 15 becomes 3. Max health is 20, which survives six hits and dies on the
 * seventh. An unarmored player takes 15 and dies on the second hit.
 * Leather (7) takes 10.8, iron (15) takes 6, diamond (17) takes 4.8.
 * One ordinary hit does not kill a full-titanium player.
 */

export const TITANIUM_SWORD_NORMAL_HIT = getAttackProfile(ItemId.TitaniumSword).baseDamage;
export const MEGA_ZOMBIE_HITS_TO_KILL = 300;
export const MEGA_ZOMBIE_MAX_HEALTH = TITANIUM_SWORD_NORMAL_HIT * MEGA_ZOMBIE_HITS_TO_KILL;
export const MEGA_ZOMBIE_ATTACK_DAMAGE = 15;
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
export const MEGA_ZOMBIE_LOOT_SPREAD = 4;

export const MEGA_ZOMBIE_ENTITY_ID_PREFIX = 'mega-zombie-';

export const MEGA_ZOMBIE_WARNING_TEXT = 'Через 5 минут появится босс Мега-зомби на арене!';
export const MEGA_ZOMBIE_SPAWN_TEXT = 'Мега-зомби появился на арене!';
export const MEGA_ZOMBIE_TIMEOUT_TEXT = 'Мега-зомби покинул арену.';

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
  revengePlayerId: string | null;
  revengeSeconds: number;
  lastPlayerAttackerId: string | null;
  lastPlayerAttackerName: string | null;
}

export function createMegaZombieRuntime(arena: ArenaAabb | null = null): MegaZombieRuntime {
  return {
    arena,
    revengePlayerId: null,
    revengeSeconds: 0,
    lastPlayerAttackerId: null,
    lastPlayerAttackerName: null,
  };
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
  clampAxis(position, velocity, 'y', arena.minY, arena.maxY - body, (arena.minY + arena.maxY) * 0.5);
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

export function megaZombieLootOffset(
  random: () => number,
  radius = MEGA_ZOMBIE_LOOT_SPREAD,
): { readonly x: number; readonly z: number } {
  const span = Math.max(0, radius);
  return {
    x: (random() * 2 - 1) * span,
    z: (random() * 2 - 1) * span,
  };
}
