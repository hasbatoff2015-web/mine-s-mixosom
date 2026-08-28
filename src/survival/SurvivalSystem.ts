import { BlockId } from '../blocks';
import { FIRE_ARROW_IGNITE_TICKS } from '../combat/fireArrow';
import { HurtResistance } from '../combat/HurtResistance';
import { FIRE_DAMAGE_INTERVAL_TICKS } from '../combat/fireSources';
import { FIXED_DT, clamp } from '../core/constants';
import type { Inventory } from '../inventory';
import { tryGetItemDefinition, type FoodItemDefinition, type StatusEffectId, type StatusEffectSpec } from '../items';
import type { PlayerController } from '../player';
import type { VoxelWorld } from '../world/World';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR_TICKS = 300;
/** Vanilla Java armor bar: 20 points, 10 icons. */
export const MAX_ARMOR_POINTS = 20;

export type DamageSource =
  | 'generic'
  | 'melee'
  | 'projectile'
  | 'explosion'
  | 'fall'
  | 'drowning'
  | 'starvation'
  | 'fire'
  | 'lava'
  | 'cactus'
  | 'suffocation'
  | 'void';

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface ArmorStats {
  readonly points: number;
  readonly toughness: number;
}

export type ArmorSource = ArmorStats | Pick<Inventory, 'getSlot'>;

export interface DamageOptions {
  readonly armor?: ArmorSource;
  readonly bypassArmor?: boolean;
  readonly ignoreInvulnerability?: boolean;
  readonly swordBlocking?: boolean;
  /** Distinguishes inFire contact from onFire DOT without a new damage-source system. */
  readonly fireContact?: boolean;
  readonly onDamage?: (result: DamageResult) => void;
  readonly onDeath?: (source: DamageSource) => void;
}

export interface DamageResult {
  readonly source: DamageSource;
  readonly requested: number;
  readonly afterArmor: number;
  readonly absorbed: number;
  readonly dealt: number;
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly killed: boolean;
  readonly ignored: boolean;
  readonly accepted: boolean;
  readonly fullHurt: boolean;
}

export interface SurvivalTickContext {
  readonly player?: PlayerController;
  readonly world?: VoxelWorld;
  readonly armor?: ArmorSource;
  readonly difficulty?: Difficulty;
  readonly inWater?: boolean;
  readonly inLava?: boolean;
  readonly inFire?: boolean;
  readonly headSubmerged?: boolean;
  readonly touchingCactus?: boolean;
  readonly horizontalDistance?: number;
  readonly sprinting?: boolean;
  readonly swimming?: boolean;
  readonly jumped?: boolean;
  readonly attacked?: boolean;
  readonly minedBlock?: boolean;
  readonly onDamage?: (result: DamageResult) => void;
  readonly onDeath?: (source: DamageSource) => void;
}

export interface SurvivalTickResult {
  readonly health: number;
  readonly hunger: number;
  readonly saturation: number;
  readonly airTicks: number;
  readonly fireTicks: number;
  readonly arrowFireTicks: number;
  readonly contactFire: boolean;
  readonly onFire: boolean;
  readonly dead: boolean;
  readonly damage: readonly DamageResult[];
}

export interface SurvivalOptions {
  readonly health?: number;
  readonly hunger?: number;
  readonly saturation?: number;
  readonly difficulty?: Difficulty;
  readonly isSwordBlocking?: () => boolean;
  readonly onDamage?: (result: DamageResult) => void;
  readonly onDeath?: (source: DamageSource) => void;
}

export interface SerializedSurvivalState {
  readonly health: number;
  readonly hunger: number;
  readonly saturation: number;
  readonly exhaustion: number;
  readonly absorption: number;
  readonly absorptionTicks?: number;
  readonly airTicks: number;
  readonly fireTicks: number;
  readonly arrowFireTicks?: number;
  readonly dead: boolean;
  readonly spawnPoint: [number, number, number];
}

const ARMOR_BYPASS_SOURCES: ReadonlySet<DamageSource> = new Set([
  'fall', 'drowning', 'starvation', 'suffocation', 'void',
]);

export function getArmorStats(source?: ArmorSource): ArmorStats {
  if (!source) return { points: 0, toughness: 0 };
  if ('points' in source) {
    return {
      points: clamp(Number.isFinite(source.points) ? source.points : 0, 0, MAX_ARMOR_POINTS),
      toughness: Math.max(0, Number.isFinite(source.toughness) ? source.toughness : 0),
    };
  }
  let points = 0;
  let toughness = 0;
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    const stack = source.getSlot({ section: 'armor', slot });
    if (!stack) continue;
    const definition = tryGetItemDefinition(stack.itemId);
    if (definition?.kind !== 'armor' || definition.slot !== slot) continue;
    points += definition.defense;
    toughness += definition.toughness;
  }
  return { points: clamp(points, 0, MAX_ARMOR_POINTS), toughness: Math.max(0, toughness) };
}

/** Canonical equipped armor total. Damage mitigation and the HUD both read this. */
export function getArmorPoints(source?: ArmorSource): number {
  return getArmorStats(source).points;
}

/** Classic fixed protection: each armor point reduces incoming damage by 4%. */
export function reduceDamageByArmor(
  damage: number,
  armor: ArmorSource | undefined,
): number {
  const incoming = Math.max(0, damage);
  return incoming * (25 - getArmorPoints(armor)) / 25;
}

export function isSwordBlockable(source: DamageSource, fireContact = false): boolean {
  return source === 'melee' || source === 'projectile' || source === 'explosion'
    || source === 'lava' || source === 'cactus' || (source === 'fire' && fireContact);
}

/** Health, hunger and environmental hazards, advanced in deterministic 20 Hz ticks. */
export class SurvivalSystem {
  health: number;
  hunger: number;
  saturation: number;
  exhaustion = 0;
  absorption = 0;
  airTicks = MAX_AIR_TICKS;
  fireTicks = 0;
  arrowFireTicks = 0;
  contactFire = false;
  dead = false;
  difficulty: Difficulty;
  spawnPoint: [number, number, number] = [0.5, 64, 0.5];
  lastDamage?: DamageResult;
  private readonly effects = new Map<StatusEffectId, { amplifier: number; ticks: number }>();
  private effectRegenTimer = 0;

  private accumulator = 0;
  readonly hurtResistance = new HurtResistance();
  private drownTimer = 0;
  private lavaTimer = 0;
  private cactusTimer = 0;
  private fireTimer = 0;
  private regenTimer = 0;
  private starvationTimer = 0;
  private readonly onDamage?: (result: DamageResult) => void;
  private readonly onDeath?: (source: DamageSource) => void;
  private readonly isSwordBlocking?: () => boolean;

  constructor(options: SurvivalOptions = {}) {
    this.health = clamp(options.health ?? MAX_HEALTH, 0, MAX_HEALTH);
    this.hunger = clamp(options.hunger ?? MAX_HUNGER, 0, MAX_HUNGER);
    this.saturation = clamp(options.saturation ?? 5, 0, this.hunger);
    this.dead = this.health <= 0;
    this.difficulty = options.difficulty ?? 'normal';
    this.isSwordBlocking = options.isSwordBlocking;
    this.onDamage = options.onDamage;
    this.onDeath = options.onDeath;
  }

  get isAlive(): boolean {
    return !this.dead;
  }

  get healthRatio(): number {
    return this.health / MAX_HEALTH;
  }

  get hungerRatio(): number {
    return this.hunger / MAX_HUNGER;
  }

  setSpawnPoint(position: readonly [number, number, number] | Readonly<{ x: number; y: number; z: number }>): void {
    this.spawnPoint = 'x' in position
      ? [position.x, position.y, position.z]
      : [position[0], position[1], position[2]];
  }

  addExhaustion(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || this.difficulty === 'peaceful') return;
    this.exhaustion += amount;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (this.hunger > 0) this.hunger -= 1;
    }
  }

  heal(amount: number): number {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    return this.health - before;
  }

  /** Called once per accepted living-target melee hit, never for an air click. */
  recordAttack(): void { this.addExhaustion(0.3); }

  damage(amount: number, source: DamageSource = 'generic', options: DamageOptions = {}): DamageResult {
    const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const healthBefore = this.health;
    if (requested <= 0 || this.dead) return this.emptyDamageResult(source, requested, healthBefore);

    const hurt = this.hurtResistance.receive(requested, options.ignoreInvulnerability);
    if (!hurt.accepted) return this.emptyDamageResult(source, requested, healthBefore);
    const blocking = options.swordBlocking ?? this.isSwordBlocking?.() ?? false;
    const rawToApply = blocking && !options.bypassArmor && isSwordBlockable(source, options.fireContact)
      ? (1 + hurt.rawDamage) * 0.5 : hurt.rawDamage;

    const bypassArmor = options.bypassArmor ?? ARMOR_BYPASS_SOURCES.has(source);
    const afterArmor = bypassArmor
      ? rawToApply
      : reduceDamageByArmor(rawToApply, options.armor);
    const absorbed = Math.min(this.absorption, afterArmor);
    this.absorption -= absorbed;
    const dealt = Math.max(0, afterArmor - absorbed);
    this.health = Math.max(0, this.health - dealt);
    const killed = this.health <= 0;
    if (killed) this.dead = true;
    const result: DamageResult = {
      source,
      requested,
      afterArmor,
      absorbed,
      dealt,
      healthBefore,
      healthAfter: this.health,
      killed,
      ignored: false,
      accepted: true,
      fullHurt: hurt.fullHurt,
    };
    this.lastDamage = result;
    options.onDamage?.(result);
    this.onDamage?.(result);
    if (killed) {
      options.onDeath?.(source);
      this.onDeath?.(source);
    }
    return result;
  }

  applyEffect(effect: StatusEffectSpec): void {
    if (effect.id === 'absorption') {
      this.absorption = 4 * (effect.amplifier + 1);
      this.effects.set(effect.id, { amplifier: effect.amplifier, ticks: effect.durationTicks });
      return;
    }
    const current = this.effects.get(effect.id);
    if (!current || effect.amplifier > current.amplifier || effect.durationTicks > current.ticks) {
      this.effects.set(effect.id, { amplifier: effect.amplifier, ticks: effect.durationTicks });
    }
  }

  hasEffect(id: StatusEffectId): boolean {
    return (this.effects.get(id)?.ticks ?? 0) > 0;
  }

  get invisible(): boolean {
    return this.hasEffect('invisibility');
  }

  effectTicks(id: StatusEffectId): number {
    return this.effects.get(id)?.ticks ?? 0;
  }

  get isOnFire(): boolean {
    return this.contactFire || this.arrowFireTicks > 0 || this.fireTicks > 0;
  }

  ignite(ticks = 160): void {
    if (Number.isFinite(ticks)) this.fireTicks = Math.max(this.fireTicks, Math.max(0, Math.floor(ticks)));
  }

  igniteFromArrow(ticks = FIRE_ARROW_IGNITE_TICKS): void {
    if (Number.isFinite(ticks)) {
      this.arrowFireTicks = Math.max(this.arrowFireTicks, Math.max(0, Math.floor(ticks)));
    }
  }

  extinguish(): void {
    this.fireTicks = 0;
    this.arrowFireTicks = 0;
    this.contactFire = false;
    this.fireTimer = 0;
  }

  canConsumeFood(itemId: string): boolean {
    const item = tryGetItemDefinition(itemId);
    return item?.kind === 'food' && (this.hunger < MAX_HUNGER || item.food.alwaysEdible === true);
  }

  /** Applies a food item and optionally removes one from the supplied inventory. */
  consumeFood(itemOrId: string | FoodItemDefinition, inventory?: Pick<Inventory, 'has' | 'remove' | 'addItem'>): boolean {
    const item = typeof itemOrId === 'string' ? tryGetItemDefinition(itemOrId) : itemOrId;
    if (item?.kind !== 'food' || !this.canConsumeFood(item.id)) return false;
    if (inventory && !inventory.has(item.id, 1)) return false;
    if (inventory && inventory.remove(item.id, 1) !== 1) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + item.food.nutrition);
    this.saturation = Math.min(this.hunger, this.saturation + item.food.saturation);
    for (const effect of item.food.effects ?? []) this.applyEffect(effect);
    if (item.food.returnsItem) inventory?.addItem(item.food.returnsItem, 1);
    return true;
  }

  tick(dt: number, context: SurvivalTickContext = {}): SurvivalTickResult {
    const events: DamageResult[] = [];
    if (!Number.isFinite(dt) || dt <= 0) return this.tickResult(events);
    this.applyActivityExhaustion(context);
    this.accumulator = Math.min(this.accumulator + dt, 1);
    while (this.accumulator + 1e-9 >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.tickOnce(context, events);
    }
    return this.tickResult(events);
  }

  respawn(
    player?: Pick<PlayerController, 'teleport'>,
    position: readonly [number, number, number] | Readonly<{ x: number; y: number; z: number }> = this.spawnPoint,
  ): void {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.absorption = 0;
    this.airTicks = MAX_AIR_TICKS;
    this.fireTicks = 0;
    this.arrowFireTicks = 0;
    this.contactFire = false;
    this.dead = false;
    this.hurtResistance.reset();
    this.drownTimer = 0;
    this.lavaTimer = 0;
    this.cactusTimer = 0;
    this.fireTimer = 0;
    this.regenTimer = 0;
    this.starvationTimer = 0;
    this.effects.clear();
    this.effectRegenTimer = 0;
    player?.teleport(position);
  }

  serialize(): SerializedSurvivalState {
    return {
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      absorption: this.absorption,
      absorptionTicks: this.effectTicks('absorption'),
      airTicks: this.airTicks,
      fireTicks: this.fireTicks,
      arrowFireTicks: this.arrowFireTicks,
      dead: this.dead,
      spawnPoint: [...this.spawnPoint],
    };
  }

  restore(state: Partial<SerializedSurvivalState>): void {
    this.hurtResistance.reset();
    if (state.health !== undefined) this.health = clamp(state.health, 0, MAX_HEALTH);
    if (state.hunger !== undefined) this.hunger = clamp(state.hunger, 0, MAX_HUNGER);
    if (state.saturation !== undefined) this.saturation = clamp(state.saturation, 0, this.hunger);
    if (state.exhaustion !== undefined) this.exhaustion = clamp(state.exhaustion, 0, 4);
    if (state.absorption !== undefined) this.absorption = Math.max(0, state.absorption);
    if (state.absorptionTicks !== undefined) {
      const ticks = Math.max(0, Math.floor(state.absorptionTicks));
      if (ticks > 0) this.effects.set('absorption', { amplifier: 0, ticks });
      else this.effects.delete('absorption');
    }
    if (state.airTicks !== undefined) this.airTicks = clamp(Math.floor(state.airTicks), 0, MAX_AIR_TICKS);
    if (state.fireTicks !== undefined) this.fireTicks = Math.max(0, Math.floor(state.fireTicks));
    if (state.arrowFireTicks !== undefined) this.arrowFireTicks = Math.max(0, Math.floor(state.arrowFireTicks));
    if (state.spawnPoint?.length === 3 && state.spawnPoint.every(Number.isFinite)) this.spawnPoint = [...state.spawnPoint];
    this.dead = state.dead ?? this.health <= 0;
  }

  private tickOnce(context: SurvivalTickContext, events: DamageResult[]): void {
    this.hurtResistance.advance(FIXED_DT);
    if (this.dead) return;

    const player = context.player;
    const world = context.world;
    const inWater = context.inWater ?? player?.inWater ?? false;
    const inLava = context.inLava ?? player?.inLava ?? false;
    const headSubmerged = context.headSubmerged ?? player?.headSubmerged ?? false;
    const touchingCactus = context.touchingCactus
      ?? (player && world ? player.intersectsBlockType(world, BlockId.Cactus, 0.08) : false);

    if (inWater && !inLava) {
      this.fireTicks = 0;
      this.arrowFireTicks = 0;
    }
    this.contactFire = context.inFire ?? player?.inFire ?? false;
    if (headSubmerged && inWater && !inLava) {
      this.airTicks = Math.max(0, this.airTicks - 1);
      if (this.airTicks === 0) {
        this.drownTimer += 1;
        if (this.drownTimer >= 20) {
          this.drownTimer = 0;
          this.dealEnvironmentDamage(2, 'drowning', context, events);
        }
      }
    } else {
      this.airTicks = Math.min(MAX_AIR_TICKS, this.airTicks + 4);
      this.drownTimer = 0;
    }

    if (inLava) {
      this.ignite(300);
      this.lavaTimer += 1;
      if (this.lavaTimer >= 10) {
        this.lavaTimer = 0;
        this.dealEnvironmentDamage(4, 'lava', context, events);
      }
    } else this.lavaTimer = 0;

    if (touchingCactus) {
      this.cactusTimer += 1;
      if (this.cactusTimer >= 10) {
        this.cactusTimer = 0;
        this.dealEnvironmentDamage(1, 'cactus', context, events);
      }
    } else this.cactusTimer = 0;

    if (this.fireTicks > 0) this.fireTicks -= 1;
    if (this.arrowFireTicks > 0) this.arrowFireTicks -= 1;
    if (this.contactFire || this.arrowFireTicks > 0 || this.fireTicks > 0) {
      this.fireTimer += 1;
      if (this.fireTimer >= FIRE_DAMAGE_INTERVAL_TICKS) {
        this.fireTimer = 0;
        this.dealEnvironmentDamage(1, 'fire', context, events);
      }
    } else this.fireTimer = 0;

    this.tickStatusEffects(context, events);
    this.tickHunger(context, events);
  }

  private tickStatusEffects(context: SurvivalTickContext, events: DamageResult[]): void {
    void context;
    void events;
    for (const [id, effect] of [...this.effects]) {
      effect.ticks -= 1;
      if (id === 'regeneration' && this.health < MAX_HEALTH) {
        this.effectRegenTimer += 1;
        const interval = effect.amplifier >= 1 ? 25 : 50;
        if (this.effectRegenTimer >= interval) {
          this.effectRegenTimer = 0;
          this.heal(1);
        }
      }
      if (effect.ticks <= 0) {
        this.effects.delete(id);
        if (id === 'absorption') this.absorption = 0;
        if (id === 'regeneration') this.effectRegenTimer = 0;
      }
    }
  }

  private tickHunger(context: SurvivalTickContext, events: DamageResult[]): void {
    const difficulty = context.difficulty ?? this.difficulty;
    if (difficulty === 'peaceful') {
      if (this.hunger < MAX_HUNGER) this.hunger = Math.min(MAX_HUNGER, this.hunger + 1 / 200);
      if (this.health < MAX_HEALTH) {
        this.regenTimer += 1;
        if (this.regenTimer >= 20) {
          this.regenTimer = 0;
          this.heal(1);
        }
      }
      return;
    }

    if (this.health < MAX_HEALTH && this.hunger >= 20 && this.saturation > 0) {
      this.regenTimer += 1;
      if (this.regenTimer >= 10) {
        this.regenTimer = 0;
        this.heal(1);
        this.addExhaustion(6);
      }
    } else if (this.health < MAX_HEALTH && this.hunger >= 18) {
      this.regenTimer += 1;
      if (this.regenTimer >= 80) {
        this.regenTimer = 0;
        this.heal(1);
        this.addExhaustion(6);
      }
    } else this.regenTimer = 0;

    if (this.hunger === 0) {
      this.starvationTimer += 1;
      if (this.starvationTimer >= 80) {
        this.starvationTimer = 0;
        const minimumHealth = difficulty === 'easy' ? 10 : difficulty === 'normal' ? 1 : 0;
        if (this.health > minimumHealth) this.dealEnvironmentDamage(1, 'starvation', context, events);
      }
    } else this.starvationTimer = 0;
  }

  private applyActivityExhaustion(context: SurvivalTickContext): void {
    const distance = Math.max(0, context.horizontalDistance ?? 0);
    if (context.swimming) this.addExhaustion(distance * 0.01);
    else if (context.sprinting) this.addExhaustion(distance * 0.1);
    if (context.jumped) this.addExhaustion(context.sprinting ? 0.2 : 0.05);
    if (context.attacked) this.recordAttack();
    if (context.minedBlock) this.addExhaustion(0.005);
  }

  private dealEnvironmentDamage(
    amount: number,
    source: DamageSource,
    context: SurvivalTickContext,
    events: DamageResult[],
  ): void {
    const result = this.damage(amount, source, {
      armor: context.armor,
      fireContact: this.contactFire,
      onDamage: context.onDamage,
      onDeath: context.onDeath,
    });
    if (!result.ignored) events.push(result);
  }

  private emptyDamageResult(source: DamageSource, requested: number, health: number): DamageResult {
    return {
      source,
      requested,
      afterArmor: 0,
      absorbed: 0,
      dealt: 0,
      healthBefore: health,
      healthAfter: health,
      killed: false,
      ignored: true,
      accepted: false,
      fullHurt: false,
    };
  }

  private tickResult(events: readonly DamageResult[]): SurvivalTickResult {
    return {
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      airTicks: this.airTicks,
      fireTicks: this.fireTicks,
      arrowFireTicks: this.arrowFireTicks,
      contactFire: this.contactFire,
      onFire: this.isOnFire,
      dead: this.dead,
      damage: events,
    };
  }
}
