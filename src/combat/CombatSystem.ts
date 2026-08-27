import { TICK_RATE, clamp } from '../core/constants';
import { tryGetItemDefinition, type ItemDefinition } from '../items';

export interface AttackProfile {
  readonly itemId?: string;
  /** Total HP, including the player's base 1 HP. Registry is the single table. */
  readonly baseDamage: number;
  readonly weapon: 'fist' | 'sword' | 'pickaxe' | 'shovel' | 'axe' | 'other';
  readonly durabilityCost: number;
}

export interface CriticalConditions {
  readonly fallDistance: number;
  readonly onGround: boolean;
  readonly sprinting?: boolean;
  readonly inWater?: boolean;
  readonly onLadder?: boolean;
  readonly blinded?: boolean;
  readonly riding?: boolean;
  readonly targetLiving?: boolean;
}

export interface MeleeAttackOptions {
  readonly critical?: Partial<CriticalConditions>;
  readonly attackerSprinting?: boolean;
  readonly attackerYaw?: number;
}

export interface MeleeAttackResult {
  readonly profile: AttackProfile;
  readonly baseDamage: number;
  readonly damage: number;
  readonly critical: boolean;
  /** Applied only after the target accepts damage, separately from full-hurt KB. */
  readonly extraKnockbackLevel: number;
  readonly attackerYaw: number;
}

export interface Velocity { x: number; y: number; z: number }

export interface KnockbackOptions {
  readonly resistance?: number;
  readonly random?: () => number;
}

/**
 * Frontier visual adaptation: melee apex height is ~½ Java 1.8.
 * Applied only to Y. Horizontal 1.8 constants stay untouched.
 * 0.67 is the scale that halves measured flat apex, not initial Y/2
 * (gravity would otherwise undershoot).
 */
export const FRONTIER_MELEE_VERTICAL_SCALE = 0.67;
const MELEE_KB_HORIZONTAL = 0.4 * TICK_RATE;
/** Vertical base kick after Frontier apex scaling. Horizontal 8 b/s is unchanged. */
export const MELEE_KB_VERTICAL = MELEE_KB_HORIZONTAL * FRONTIER_MELEE_VERTICAL_SCALE;
export const MELEE_EXTRA_VERTICAL = 0.1 * TICK_RATE * FRONTIER_MELEE_VERTICAL_SCALE;

/** Java 1.8 full-hurt transform. Inputs/outputs are blocks/s, never an impulse length. */
export function applyKnockback<T extends Velocity>(
  velocity: T,
  directionAwayFromAttacker: Readonly<{ x: number; z: number }>,
  options: KnockbackOptions = {},
): T {
  const resistance = clamp(options.resistance ?? 0, 0, 1);
  if (resistance > 0 && (options.random ?? Math.random)() < resistance) return velocity;
  const length = Math.hypot(directionAwayFromAttacker.x, directionAwayFromAttacker.z);
  // Coincident centres: deterministic fallback, avoiding NaN/random vector allocations.
  const nx = length > 1e-8 ? directionAwayFromAttacker.x / length : 1;
  const nz = length > 1e-8 ? directionAwayFromAttacker.z / length : 0;
  velocity.x = velocity.x * 0.5 + nx * MELEE_KB_HORIZONTAL;
  velocity.z = velocity.z * 0.5 + nz * MELEE_KB_HORIZONTAL;
  velocity.y = Math.min(velocity.y * 0.5 + MELEE_KB_VERTICAL, MELEE_KB_VERTICAL);
  return velocity;
}

/** Successful attack extra KB uses attacker facing, not target displacement. */
export function applyExtraKnockback(velocity: Velocity, yaw: number, level: number): void {
  const levels = Math.max(0, Math.floor(level));
  if (levels === 0) return;
  velocity.x -= Math.sin(yaw) * 0.5 * TICK_RATE * levels;
  // Frontier yaw 0 faces -Z (the Java +Z convention is converted here).
  velocity.z -= Math.cos(yaw) * 0.5 * TICK_RATE * levels;
  velocity.y += MELEE_EXTRA_VERTICAL;
}

/** Living travel drag, applied after collision/movement, only during melee recoil. */
export function applyMeleeDrag(velocity: Velocity, groundedBeforeMove: boolean, dt: number): void {
  const drag = Math.pow(groundedBeforeMove ? 0.6 * 0.91 : 0.91, dt * TICK_RATE);
  velocity.x *= drag;
  velocity.z *= drag;
}

export function completeMeleeAttack(
  result: MeleeAttackResult,
  accepted: boolean,
  attacker: { velocity: Velocity },
): void {
  if (!accepted || result.extraKnockbackLevel <= 0) return;
  attacker.velocity.x *= 0.6;
  attacker.velocity.z *= 0.6;
}

export function getAttackProfile(item?: string | ItemDefinition | null): AttackProfile {
  const definition = typeof item === 'string' ? tryGetItemDefinition(item) : item;
  const itemId = typeof item === 'string' ? item : item?.id;
  if (definition?.kind === 'weapon' && definition.weapon === 'sword') {
    return { itemId, baseDamage: definition.attackDamage, weapon: 'sword', durabilityCost: 1 };
  }
  if (definition?.kind === 'tool') {
    // Task §55 deliberately preserves Frontier's one-point tool wear (Java uses two).
    return { itemId, baseDamage: definition.attackDamage, weapon: definition.tool, durabilityCost: 1 };
  }
  return { itemId, baseDamage: 1, weapon: itemId ? 'other' : 'fist', durabilityCost: 0 };
}

export function isCriticalHit(conditions: CriticalConditions): boolean {
  return conditions.fallDistance > 0 && !conditions.onGround
    && !conditions.inWater && !conditions.onLadder && !conditions.blinded
    && !conditions.riding && conditions.targetLiving !== false;
}

export interface BowChargeResult {
  readonly ticksHeld: number;
  readonly power: number;
  /** Vanilla projectile launch speed, measured in blocks/tick. */
  readonly launchSpeed: number;
  readonly canFire: boolean;
  readonly critical: boolean;
  readonly baseDamage: number;
}

export function bowCharge(ticksHeld: number): BowChargeResult {
  const held = Math.max(0, ticksHeld);
  const x = held / 20;
  const power = clamp((x * x + 2 * x) / 3, 0, 1);
  const launchSpeed = 3 * power;
  return {
    ticksHeld: held, power, launchSpeed,
    canFire: power >= 0.1, critical: power >= 1,
    baseDamage: Math.ceil(launchSpeed * 2),
  };
}

export interface CombatOptions {
  readonly heldItemId?: string;
  readonly offhandItemId?: string;
}

export interface SerializedCombatState {
  readonly heldItemId: string | null;
  readonly offhandItemId: string | null;
}

/** Click-driven melee and transient sword use. Target owns damage immunity. */
export class CombatSystem {
  heldItemId: string | null;
  offhandItemId: string | null;
  swordBlocking = false;

  constructor(options: CombatOptions = {}) {
    this.heldItemId = options.heldItemId ?? null;
    this.offhandItemId = options.offhandItemId ?? null;
  }

  setHeldItem(itemId?: string | null): void {
    const next = itemId ?? null;
    if (next !== this.heldItemId) this.swordBlocking = false;
    this.heldItemId = next;
  }

  setOffhand(itemId?: string | null): void {
    this.offhandItemId = itemId ?? null;
  }

  updateUse(using: boolean, gameplayActive: boolean, alive: boolean): void {
    const held = this.heldItemId ? tryGetItemDefinition(this.heldItemId) : undefined;
    this.swordBlocking = using && gameplayActive && alive
      && held?.kind === 'weapon' && held.weapon === 'sword';
  }

  performMeleeAttack(
    item: string | ItemDefinition | null = this.heldItemId,
    options: MeleeAttackOptions = {},
  ): MeleeAttackResult {
    this.setHeldItem(typeof item === 'string' ? item : item?.id);
    const profile = getAttackProfile(item);
    const critical = isCriticalHit({ fallDistance: 0, onGround: true, ...options.critical });
    return {
      profile, baseDamage: profile.baseDamage,
      damage: profile.baseDamage * (critical ? 1.5 : 1), critical,
      extraKnockbackLevel: Number(options.attackerSprinting === true),
      attackerYaw: options.attackerYaw ?? 0,
    };
  }

  attack(item: string | ItemDefinition | null = this.heldItemId, options: MeleeAttackOptions = {}): MeleeAttackResult {
    return this.performMeleeAttack(item, options);
  }

  bowCharge(ticksHeld: number): BowChargeResult { return bowCharge(ticksHeld); }

  serialize(): SerializedCombatState {
    return { heldItemId: this.heldItemId, offhandItemId: this.offhandItemId };
  }

  restore(state: Partial<SerializedCombatState>): void {
    this.swordBlocking = false;
    if (state.heldItemId !== undefined) {
      this.heldItemId = state.heldItemId && tryGetItemDefinition(state.heldItemId) ? state.heldItemId : null;
    }
    if (state.offhandItemId !== undefined) {
      this.offhandItemId = state.offhandItemId && tryGetItemDefinition(state.offhandItemId) ? state.offhandItemId : null;
    }
  }
}
