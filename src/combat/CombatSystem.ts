import * as THREE from 'three';
import { TICK_RATE, clamp } from '../core/constants';
import { tryGetItemDefinition, type ItemDefinition } from '../items';

export const FULL_ATTACK_THRESHOLD = 0.9;
export const DEFAULT_SHIELD_WINDUP_TICKS = 5;
export const DEFAULT_SHIELD_DISABLE_TICKS = 100;

export interface AttackProfile {
  readonly itemId?: string;
  readonly baseDamage: number;
  readonly attackSpeed: number;
  readonly weapon: 'fist' | 'sword' | 'pickaxe' | 'shovel' | 'axe' | 'hoe' | 'other';
}

export interface CriticalConditions {
  readonly fallDistance: number;
  readonly onGround: boolean;
  readonly sprinting?: boolean;
  readonly inWater?: boolean;
  readonly onLadder?: boolean;
  readonly blinded?: boolean;
  readonly riding?: boolean;
}

export interface MeleeAttackOptions {
  readonly critical?: Partial<CriticalConditions>;
  readonly bonusDamage?: number;
  readonly knockbackLevel?: number;
  readonly attackerSprinting?: boolean;
  readonly attackerYaw?: number;
}

export interface MeleeAttackResult {
  readonly profile: AttackProfile;
  readonly strength: number;
  readonly damageFactor: number;
  readonly baseDamage: number;
  readonly bonusDamage: number;
  readonly damage: number;
  readonly critical: boolean;
  readonly fullyCharged: boolean;
  readonly sprintKnockback: boolean;
  /** World-space impulse in blocks/s. */
  readonly knockback: THREE.Vector3;
}

export interface KnockbackOptions {
  readonly targetGrounded?: boolean;
  readonly sprinting?: boolean;
  readonly enchantmentLevel?: number;
  readonly resistance?: number;
  readonly random?: () => number;
}

export interface ShieldConfig {
  readonly windupTicks: number;
  readonly disableTicks: number;
  /** Exact Java 1.9 release melee reduction was 66%, not a complete block. */
  readonly meleeDamageReduction: number;
  readonly projectileDamageReduction: number;
  readonly frontalArcDegrees: number;
  readonly axeBaseDisableChance: number;
  readonly axeEfficiencyBonusChance: number;
  readonly axeSprintingBonusChance: number;
}

export interface ShieldHitOptions {
  readonly damage: number;
  /** Normalized or non-normalized direction from defender to attacker. */
  readonly directionToAttacker: Readonly<{ x: number; z: number }>;
  readonly defenderYaw: number;
  readonly projectile?: boolean;
  readonly attackerItemId?: string;
  readonly attackerSprinting?: boolean;
  readonly axeEfficiencyLevel?: number;
  readonly random?: () => number;
}

export interface ShieldHitResult {
  readonly blocked: boolean;
  readonly blockedDamage: number;
  readonly receivedDamage: number;
  /** Amount the inventory layer should subtract from the shield stack. */
  readonly shieldDurabilityDamage: number;
  readonly shieldDisabled: boolean;
  readonly disableChance: number;
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

export interface CombatOptions {
  readonly shield?: Partial<ShieldConfig>;
  readonly heldItemId?: string;
  readonly offhandItemId?: string;
}

export interface SerializedCombatState {
  readonly ticksSinceAttack: number;
  readonly heldItemId: string | null;
  readonly offhandItemId: string | null;
  readonly usingShield: boolean;
  readonly shieldUseTicks: number;
  readonly shieldDisabledTicks: number;
}

const DEFAULT_SHIELD_CONFIG: ShieldConfig = Object.freeze({
  windupTicks: DEFAULT_SHIELD_WINDUP_TICKS,
  disableTicks: DEFAULT_SHIELD_DISABLE_TICKS,
  meleeDamageReduction: 0.66,
  projectileDamageReduction: 1,
  frontalArcDegrees: 180,
  axeBaseDisableChance: 0.25,
  axeEfficiencyBonusChance: 0.05,
  axeSprintingBonusChance: 0.75,
});

const EXACT_ITEM_PROFILES: Readonly<Record<string, Omit<AttackProfile, 'itemId'>>> = Object.freeze({
  wooden_sword: { baseDamage: 4, attackSpeed: 1.6, weapon: 'sword' },
  stone_sword: { baseDamage: 5, attackSpeed: 1.6, weapon: 'sword' },
  iron_sword: { baseDamage: 6, attackSpeed: 1.6, weapon: 'sword' },
  diamond_sword: { baseDamage: 7, attackSpeed: 1.6, weapon: 'sword' },

  wooden_pickaxe: { baseDamage: 2, attackSpeed: 1.2, weapon: 'pickaxe' },
  stone_pickaxe: { baseDamage: 3, attackSpeed: 1.2, weapon: 'pickaxe' },
  iron_pickaxe: { baseDamage: 4, attackSpeed: 1.2, weapon: 'pickaxe' },
  diamond_pickaxe: { baseDamage: 5, attackSpeed: 1.2, weapon: 'pickaxe' },

  wooden_shovel: { baseDamage: 2.5, attackSpeed: 1, weapon: 'shovel' },
  stone_shovel: { baseDamage: 3.5, attackSpeed: 1, weapon: 'shovel' },
  iron_shovel: { baseDamage: 4.5, attackSpeed: 1, weapon: 'shovel' },
  diamond_shovel: { baseDamage: 5.5, attackSpeed: 1, weapon: 'shovel' },

  wooden_axe: { baseDamage: 7, attackSpeed: 0.8, weapon: 'axe' },
  stone_axe: { baseDamage: 9, attackSpeed: 0.8, weapon: 'axe' },
  iron_axe: { baseDamage: 9, attackSpeed: 0.9, weapon: 'axe' },
  diamond_axe: { baseDamage: 9, attackSpeed: 1, weapon: 'axe' },
});

function itemIdOf(item?: string | ItemDefinition | null): string | undefined {
  return typeof item === 'string' ? item : item?.id;
}

export function getAttackProfile(item?: string | ItemDefinition | null): AttackProfile {
  const itemId = itemIdOf(item);
  if (!itemId) return { baseDamage: 1, attackSpeed: 4, weapon: 'fist' };
  const exact = EXACT_ITEM_PROFILES[itemId];
  if (exact) return { itemId, ...exact };
  const definition = typeof item === 'string' ? tryGetItemDefinition(item) : item;
  if (definition?.kind === 'weapon' && definition.weapon === 'sword') {
    return { itemId, baseDamage: definition.attackDamage, attackSpeed: 1.6, weapon: 'sword' };
  }
  if (definition?.kind === 'tool') {
    const speed = definition.tool === 'pickaxe' ? 1.2 : definition.tool === 'shovel' ? 1 : 1;
    return { itemId, baseDamage: definition.attackDamage, attackSpeed: speed, weapon: definition.tool };
  }
  return { itemId, baseDamage: 1, attackSpeed: 4, weapon: 'other' };
}

export function attackCooldownTicks(attackSpeed: number): number {
  return TICK_RATE / Math.max(0.01, attackSpeed);
}

/** Java 1.9 cooldown meter, including the vanilla +0.5 partial-tick offset. */
export function attackStrength(attackSpeed: number, ticksSinceAttack: number, partialTick = 0.5): number {
  return clamp((Math.max(0, ticksSinceAttack) + partialTick) / attackCooldownTicks(attackSpeed), 0, 1);
}

export function attackDamageFactor(strength: number): number {
  const charge = clamp(strength, 0, 1);
  return 0.2 + 0.8 * charge * charge;
}

export function isCriticalHit(strength: number, conditions: CriticalConditions): boolean {
  return strength > FULL_ATTACK_THRESHOLD
    && conditions.fallDistance > 0
    && !conditions.onGround
    && !conditions.sprinting
    && !conditions.inWater
    && !conditions.onLadder
    && !conditions.blinded
    && !conditions.riding;
}

/**
 * Mutates `velocity` using Java-style knockback translated from blocks/tick to
 * this project's blocks/second velocities.
 */
export function applyKnockback(
  velocity: THREE.Vector3,
  directionAwayFromAttacker: Readonly<{ x: number; z: number }>,
  options: KnockbackOptions = {},
): THREE.Vector3 {
  const resistance = clamp(options.resistance ?? 0, 0, 1);
  if ((options.random ?? Math.random)() < resistance) return velocity;
  const length = Math.hypot(directionAwayFromAttacker.x, directionAwayFromAttacker.z);
  if (length < 1e-8) return velocity;
  const nx = directionAwayFromAttacker.x / length;
  const nz = directionAwayFromAttacker.z / length;
  velocity.x = velocity.x / 2 + nx * 0.4 * TICK_RATE;
  velocity.z = velocity.z / 2 + nz * 0.4 * TICK_RATE;
  if (options.targetGrounded) velocity.y = Math.min(velocity.y / 2 + 0.4 * TICK_RATE, 0.4 * TICK_RATE);
  const extraLevel = Math.max(0, Math.floor(options.enchantmentLevel ?? 0)) + Number(options.sprinting ?? false);
  if (extraLevel > 0) {
    velocity.x += nx * 0.5 * TICK_RATE * extraLevel;
    velocity.z += nz * 0.5 * TICK_RATE * extraLevel;
    velocity.y += 0.1 * TICK_RATE;
  }
  return velocity;
}

export function bowCharge(ticksHeld: number): BowChargeResult {
  const held = Math.max(0, ticksHeld);
  const x = held / 20;
  const power = clamp((x * x + 2 * x) / 3, 0, 1);
  const launchSpeed = 3 * power;
  return {
    ticksHeld: held,
    power,
    launchSpeed,
    canFire: power >= 0.1,
    critical: power >= 1,
    baseDamage: Math.ceil(launchSpeed * 2),
  };
}

export function shieldDisableChance(
  efficiencyLevel: number,
  attackerSprinting: boolean,
  config: ShieldConfig = DEFAULT_SHIELD_CONFIG,
): number {
  return clamp(
    config.axeBaseDisableChance
      + Math.max(0, Math.floor(efficiencyLevel)) * config.axeEfficiencyBonusChance
      + (attackerSprinting ? config.axeSprintingBonusChance : 0),
    0,
    1,
  );
}

export function isAttackInShieldArc(
  defenderYaw: number,
  directionToAttacker: Readonly<{ x: number; z: number }>,
  arcDegrees = DEFAULT_SHIELD_CONFIG.frontalArcDegrees,
): boolean {
  const length = Math.hypot(directionToAttacker.x, directionToAttacker.z);
  if (length < 1e-8) return true;
  const forwardX = -Math.sin(defenderYaw);
  const forwardZ = -Math.cos(defenderYaw);
  const dot = (forwardX * directionToAttacker.x + forwardZ * directionToAttacker.z) / length;
  return dot >= Math.cos(clamp(arcDegrees, 0, 360) * Math.PI / 360);
}

/** Stateful cooldown and shield helper; entity health remains owned by SurvivalSystem. */
export class CombatSystem {
  ticksSinceAttack = Number.POSITIVE_INFINITY;
  heldItemId: string | null;
  offhandItemId: string | null;
  usingShield = false;
  shieldUseTicks = 0;
  shieldDisabledTicks = 0;
  readonly shieldConfig: ShieldConfig;

  private tickRemainder = 0;
  private heldItemInitialized: boolean;

  constructor(options: CombatOptions = {}) {
    this.heldItemId = options.heldItemId ?? null;
    this.offhandItemId = options.offhandItemId ?? null;
    this.heldItemInitialized = options.heldItemId !== undefined;
    this.shieldConfig = Object.freeze({ ...DEFAULT_SHIELD_CONFIG, ...options.shield });
  }

  get shieldActive(): boolean {
    return this.usingShield
      && this.shieldDisabledTicks <= 0
      && this.shieldUseTicks >= this.shieldConfig.windupTicks
      && (this.offhandItemId === 'shield' || this.heldItemId === 'shield');
  }

  get movementMultiplier(): number {
    return this.usingShield ? 0.3 : 1;
  }

  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const elapsedTicks = dt * TICK_RATE;
    const ticks = elapsedTicks + this.tickRemainder;
    const wholeTicks = Math.floor(ticks + 1e-9);
    this.tickRemainder = ticks - wholeTicks;
    if (Number.isFinite(this.ticksSinceAttack)) this.ticksSinceAttack += elapsedTicks;
    if (wholeTicks <= 0) return;
    this.shieldDisabledTicks = Math.max(0, this.shieldDisabledTicks - wholeTicks);
    if (this.usingShield && this.shieldDisabledTicks === 0
      && (this.offhandItemId === 'shield' || this.heldItemId === 'shield')) {
      this.shieldUseTicks += wholeTicks;
    } else this.shieldUseTicks = 0;
  }

  setHeldItem(itemId?: string | null): void {
    const next = itemId ?? null;
    if (next === this.heldItemId) return;
    const initialized = this.heldItemInitialized;
    this.heldItemId = next;
    this.heldItemInitialized = true;
    if (initialized) this.resetCooldown();
    if (next !== 'shield' && this.offhandItemId !== 'shield') this.setUsingShield(false);
  }

  setOffhand(itemId?: string | null): void {
    this.offhandItemId = itemId ?? null;
    if (this.offhandItemId !== 'shield' && this.heldItemId !== 'shield') this.setUsingShield(false);
  }

  setUsingShield(using: boolean): void {
    const canUse = this.shieldDisabledTicks <= 0 && (this.offhandItemId === 'shield' || this.heldItemId === 'shield');
    this.usingShield = using && canUse;
    if (!this.usingShield) this.shieldUseTicks = 0;
  }

  resetCooldown(): void {
    this.ticksSinceAttack = 0;
  }

  getAttackStrength(item: string | ItemDefinition | null = this.heldItemId, partialTick = 0.5): number {
    return attackStrength(getAttackProfile(item).attackSpeed, this.ticksSinceAttack, partialTick);
  }

  performMeleeAttack(
    item: string | ItemDefinition | null = this.heldItemId,
    options: MeleeAttackOptions = {},
  ): MeleeAttackResult {
    const itemId = itemIdOf(item) ?? null;
    if (!this.heldItemInitialized) {
      this.heldItemId = itemId;
      this.heldItemInitialized = true;
    }
    else if (itemId !== this.heldItemId) this.setHeldItem(itemId);
    const profile = getAttackProfile(item);
    const strength = attackStrength(profile.attackSpeed, this.ticksSinceAttack);
    const damageFactor = attackDamageFactor(strength);
    const criticalConditions: CriticalConditions = {
      fallDistance: options.critical?.fallDistance ?? 0,
      onGround: options.critical?.onGround ?? true,
      sprinting: options.critical?.sprinting ?? options.attackerSprinting ?? false,
      inWater: options.critical?.inWater ?? false,
      onLadder: options.critical?.onLadder ?? false,
      blinded: options.critical?.blinded ?? false,
      riding: options.critical?.riding ?? false,
    };
    const critical = isCriticalHit(strength, criticalConditions);
    const bonusDamage = Math.max(0, options.bonusDamage ?? 0);
    const scaledBase = profile.baseDamage * damageFactor;
    const damage = scaledBase * (critical ? 1.5 : 1) + bonusDamage;
    const fullyCharged = strength > FULL_ATTACK_THRESHOLD;
    const sprintKnockback = fullyCharged && (options.attackerSprinting ?? false) && !critical;
    const yaw = options.attackerYaw ?? 0;
    const knockback = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const knockbackLevels = Math.max(0, Math.floor(options.knockbackLevel ?? 0)) + Number(sprintKnockback);
    knockback.multiplyScalar((0.4 + knockbackLevels * 0.5) * TICK_RATE);
    if (knockbackLevels > 0) knockback.y = 0.1 * TICK_RATE;
    this.resetCooldown();
    this.setUsingShield(false);
    return {
      profile,
      strength,
      damageFactor,
      baseDamage: scaledBase,
      bonusDamage,
      damage,
      critical,
      fullyCharged,
      sprintKnockback,
      knockback,
    };
  }

  attack(item: string | ItemDefinition | null = this.heldItemId, options: MeleeAttackOptions = {}): MeleeAttackResult {
    return this.performMeleeAttack(item, options);
  }

  resolveShieldHit(options: ShieldHitOptions): ShieldHitResult {
    const damage = Math.max(0, options.damage);
    if (!this.shieldActive
      || !isAttackInShieldArc(options.defenderYaw, options.directionToAttacker, this.shieldConfig.frontalArcDegrees)) {
      return {
        blocked: false,
        blockedDamage: 0,
        receivedDamage: damage,
        shieldDurabilityDamage: 0,
        shieldDisabled: false,
        disableChance: 0,
      };
    }
    const attackerProfile = getAttackProfile(options.attackerItemId);
    let disableChance = 0;
    let shieldDisabled = false;
    if (attackerProfile.weapon === 'axe' && !options.projectile) {
      disableChance = shieldDisableChance(
        options.axeEfficiencyLevel ?? 0,
        options.attackerSprinting ?? false,
        this.shieldConfig,
      );
      shieldDisabled = (options.random ?? Math.random)() < disableChance;
      if (shieldDisabled) this.disableShield();
    }
    const reduction = options.projectile
      ? this.shieldConfig.projectileDamageReduction
      : this.shieldConfig.meleeDamageReduction;
    const blockedDamage = damage * clamp(reduction, 0, 1);
    return {
      blocked: blockedDamage > 0,
      blockedDamage,
      receivedDamage: damage - blockedDamage,
      shieldDurabilityDamage: blockedDamage > 0 ? 1 + Math.floor(damage) : 0,
      shieldDisabled,
      disableChance,
    };
  }

  disableShield(ticks = this.shieldConfig.disableTicks): void {
    this.shieldDisabledTicks = Math.max(this.shieldDisabledTicks, Math.max(0, Math.floor(ticks)));
    this.usingShield = false;
    this.shieldUseTicks = 0;
  }

  bowCharge(ticksHeld: number): BowChargeResult {
    return bowCharge(ticksHeld);
  }

  serialize(): SerializedCombatState {
    return {
      ticksSinceAttack: Number.isFinite(this.ticksSinceAttack) ? this.ticksSinceAttack : 1_000_000,
      heldItemId: this.heldItemId,
      offhandItemId: this.offhandItemId,
      usingShield: this.usingShield,
      shieldUseTicks: this.shieldUseTicks,
      shieldDisabledTicks: this.shieldDisabledTicks,
    };
  }

  restore(state: Partial<SerializedCombatState>): void {
    if (state.ticksSinceAttack !== undefined) this.ticksSinceAttack = Math.max(0, state.ticksSinceAttack);
    if (state.heldItemId !== undefined) {
      this.heldItemId = state.heldItemId;
      this.heldItemInitialized = true;
    }
    if (state.offhandItemId !== undefined) this.offhandItemId = state.offhandItemId;
    if (state.shieldDisabledTicks !== undefined) this.shieldDisabledTicks = Math.max(0, Math.floor(state.shieldDisabledTicks));
    if (state.shieldUseTicks !== undefined) this.shieldUseTicks = Math.max(0, Math.floor(state.shieldUseTicks));
    this.usingShield = state.usingShield === true && this.shieldDisabledTicks <= 0
      && (this.offhandItemId === 'shield' || this.heldItemId === 'shield');
  }
}
