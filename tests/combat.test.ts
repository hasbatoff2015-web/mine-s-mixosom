import { describe, expect, it } from 'vitest';
import {
  CombatSystem, applyKnockback, applyExtraKnockback, completeMeleeAttack,
  bowCharge, getAttackProfile, isCriticalHit,
  MELEE_EXTRA_VERTICAL, MELEE_KB_VERTICAL,
} from '../src/combat';
import { HurtResistance, MAX_HURT_RESISTANT_TICKS } from '../src/combat/HurtResistance';
import { MAX_AIR_TICKS, SurvivalSystem, reduceDamageByArmor, type DamageSource } from '../src/survival';
import { tryGetItemDefinition } from '../src/items';

describe('classic 1.8 melee', () => {
  it.each([
    ['wooden', 0], ['stone', 1], ['iron', 2], ['diamond', 3],
  ] as const)('uses total damage for every %s sword and tool', (tier, bonus) => {
    for (const [weapon, base] of [['sword', 5], ['axe', 4], ['pickaxe', 3], ['shovel', 2]] as const) {
      const id = tier + '_' + weapon;
      expect(getAttackProfile(id).baseDamage).toBe(base + bonus);
      expect(tryGetItemDefinition(id)).toMatchObject({ attackDamage: base + bonus });
    }
  });

  it('every immediate attack and item switch retains full damage', () => {
    const combat = new CombatSystem();
    expect(combat.attack().damage).toBe(1);
    for (let i = 0; i < 40; i++) expect(combat.attack('diamond_sword').damage).toBe(8);
    expect(combat.attack('wooden_sword').damage).toBe(5);
    expect(combat.attack('iron_axe').damage).toBe(6);
    expect(combat.attack('bow').damage).toBe(1);
    expect(tryGetItemDefinition('golden_sword')).toBeUndefined();
  });

  it('ignores obsolete saved fields and never restores transient use', () => {
    const combat = new CombatSystem({ heldItemId: 'diamond_sword' });
    combat.updateUse(true, true, true);
    const legacy = { ticksSinceAttack: 0, heldItemId: 'iron_sword', offhandItemId: 'shield',
      usingShield: true, shieldUseTicks: 20, swordBlocking: true };
    combat.restore(legacy);
    expect(combat.serialize()).toEqual({ heldItemId: 'iron_sword', offhandItemId: null });
    expect(combat.swordBlocking).toBe(false);
    expect(combat.attack().damage).toBe(7);
    expect(combat).not.toHaveProperty('ticksSinceAttack');
  });

  it('permits falling sprint crit + sprint KB, with no charge gate', () => {
    const hit = new CombatSystem().attack('diamond_sword', {
      critical: { fallDistance: 0.1, onGround: false, sprinting: true }, attackerSprinting: true,
    });
    expect(hit).toMatchObject({ baseDamage: 8, damage: 12, critical: true, extraKnockbackLevel: 1 });
    expect(new CombatSystem().attack(null, { critical: { fallDistance: 1, onGround: false } }).damage).toBe(1.5);
  });

  it.each([
    { fallDistance: 0 }, { onGround: true }, { inWater: true }, { onLadder: true },
    { blinded: true }, { riding: true }, { targetLiving: false },
  ])('rejects a crit for %j', (condition) => {
    expect(isCriticalHit({ fallDistance: 1, onGround: false, ...condition })).toBe(false);
  });
});

describe('shared 20-tick hurt resistance', () => {
  it('rejects equal/lower damage through tick 9, accepts at exactly tick 10', () => {
    const gate = new HurtResistance();
    expect(gate.receive(5)).toEqual({ accepted: true, fullHurt: true, rawDamage: 5 });
    expect(gate.remainingTicks).toBe(MAX_HURT_RESISTANT_TICKS);
    for (let tick = 0; tick < 10; tick++) {
      expect(gate.receive(5).accepted).toBe(false);
      expect(gate.receive(4).accepted).toBe(false);
      gate.advance(0.05);
    }
    expect(gate.remainingTicks).toBe(10);
    expect(gate.receive(5)).toEqual({ accepted: true, fullHurt: true, rawDamage: 5 });
    expect(gate.remainingTicks).toBe(20);
  });

  it('applies a stronger difference without timer restart or full hurt', () => {
    const gate = new HurtResistance();
    gate.receive(5); gate.advance(0.15);
    expect(gate.receive(8)).toEqual({ accepted: true, fullHurt: false, rawDamage: 3 });
    expect(gate.remainingTicks).toBe(17);
    expect(gate.lastRawDamage).toBe(8);
    expect(gate.receive(7).accepted).toBe(false);
    expect(gate.receive(10).rawDamage).toBe(2);
    gate.advance(0.35);
    expect(gate.receive(4)).toEqual({ accepted: true, fullHurt: true, rawDamage: 4 });
  });

  it('counts fixed ticks, resets on reload/respawn, rejects invalid damage', () => {
    const gate = new HurtResistance();
    for (const damage of [NaN, Infinity, -1, 0]) expect(gate.receive(damage).accepted).toBe(false);
    gate.receive(1);
    gate.advance(0.025);
    expect(gate.remainingTicks).toBe(20);
    gate.advance(0.025);
    expect(gate.remainingTicks).toBe(19);
    const survival = new SurvivalSystem();
    survival.damage(3);
    survival.restore(survival.serialize());
    expect(survival.hurtResistance.remainingTicks).toBe(0);
    survival.damage(2);
    survival.respawn();
    expect(survival.hurtResistance.remainingTicks).toBe(0);
  });

  it('compares raw damage before sword block and armor, including the difference', () => {
    const target = new SurvivalSystem({ hunger: 15 });
    const options = { swordBlocking: true, armor: { points: 20, toughness: 99 } };
    expect(target.damage(5, 'melee', options)).toMatchObject({ dealt: 0.6, fullHurt: true });
    expect(target.damage(8, 'projectile', options)).toMatchObject({ dealt: 0.4, fullHurt: false, accepted: true });
    expect(target.damage(8, 'melee', { swordBlocking: false }).ignored).toBe(true);
    expect(target.health).toBe(19);
  });

  it('absorbed hits still count as accepted full hurt, but repeated hits do not', () => {
    const target = new SurvivalSystem();
    target.absorption = 10;
    expect(target.damage(4, 'melee')).toMatchObject({ accepted: true, fullHurt: true, dealt: 0, absorbed: 4 });
    expect(target.damage(4, 'projectile')).toMatchObject({ accepted: false, fullHurt: false });
  });
});

describe('knockback velocity transforms in blocks/second', () => {
  it.each([0, 10, -10])('halves all old velocity components and caps Y in air too (vy=%s)', (y) => {
    const velocity = { x: 6, y, z: -4 };
    expect(applyKnockback(velocity, { x: 3, z: 4 })).toBe(velocity);
    expect(velocity.x).toBeCloseTo(3 + 4.8);
    expect(velocity.z).toBeCloseTo(-2 + 6.4);
    expect(velocity.y).toBe(Math.min(y / 2 + MELEE_KB_VERTICAL, MELEE_KB_VERTICAL));
  });

  it('separates base away direction from sprint facing and extra Y is not level-scaled', () => {
    const velocity = { x: 0, y: 0, z: 0 };
    applyKnockback(velocity, { x: 1, z: 0 });
    expect(velocity).toEqual({ x: 8, y: MELEE_KB_VERTICAL, z: 0 });
    applyExtraKnockback(velocity, 0, 2);
    expect(velocity).toEqual({ x: 8, y: MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL, z: -20 });
  });

  it('normal and sprint impulses are 8/18 horizontal and 8/10 vertical from rest', () => {
    const normal = { x: 0, y: 0, z: 0 };
    applyKnockback(normal, { x: 0, z: -1 });
    expect(normal).toEqual({ x: 0, y: MELEE_KB_VERTICAL, z: -8 });
    applyExtraKnockback(normal, 0, 1);
    expect(normal).toEqual({ x: 0, y: MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL, z: -18 });
  });

  it('has a finite coincident-centre fallback and preserves resistance semantics', () => {
    const v = { x: 2, y: -2, z: 3 };
    applyKnockback(v, { x: 0, z: 0 }, { resistance: 1, random: () => 0.5 });
    expect(v).toEqual({ x: 2, y: -2, z: 3 });
    applyKnockback(v, { x: 0, z: 0 });
    expect(v).toEqual({ x: 9, y: Math.min(-1 + MELEE_KB_VERTICAL, MELEE_KB_VERTICAL), z: 1.5 });
  });

  it('slows only a successful extra-KB attacker, never ordinary/rejected hits', () => {
    for (const sprinting of [false, true]) for (const accepted of [false, true]) {
      const attacker = { velocity: { x: 5, y: 3, z: -10 } };
      const attack = new CombatSystem().attack('iron_sword', { attackerSprinting: sprinting });
      completeMeleeAttack(attack, accepted, attacker);
      const extra = sprinting && accepted;
      expect(attacker.velocity).toEqual({ x: extra ? 3 : 5, y: 3, z: extra ? -6 : -10 });
    }
  });
});

describe('classic armor and sword blocking', () => {
  it.each([0, 5, 10, 15, 20])('uses a fixed percentage at %s armor, ignoring toughness', (points) => {
    for (const raw of [1, 10, 100]) {
      expect(reduceDamageByArmor(raw, { points, toughness: 99 })).toBeCloseTo(raw * (25 - points) / 25);
    }
  });

  it('enters/exits sword use without windup and rejects other held items/death/pause', () => {
    const combat = new CombatSystem({ heldItemId: 'diamond_sword' });
    combat.updateUse(true, true, true);
    expect(combat.swordBlocking).toBe(true);
    for (const flags of [[false, true, true], [true, false, true], [true, true, false]]) {
      combat.updateUse(flags[0]!, flags[1]!, flags[2]!);
      expect(combat.swordBlocking).toBe(false);
    }
    combat.updateUse(true, true, true);
    combat.setHeldItem('iron_axe');
    expect(combat.swordBlocking).toBe(false);
    for (const id of ['bow', 'apple', 'iron_pickaxe', null]) {
      combat.setHeldItem(id); combat.updateUse(true, true, true);
      expect(combat.swordBlocking).toBe(false);
    }
  });

  it.each(['melee', 'projectile', 'explosion', 'lava', 'cactus'] as DamageSource[])('blocks %s before armor', (source) => {
    const target = new SurvivalSystem();
    const result = target.damage(7, source, { swordBlocking: true, armor: { points: 15, toughness: 0 } });
    expect(result.dealt).toBeCloseTo(1.6);
  });

  it.each(['void', 'starvation', 'drowning', 'fall', 'suffocation', 'generic', 'fire'] as DamageSource[])('does not sword-block %s', (source) => {
    const target = new SurvivalSystem();
    expect(target.damage(7, source, { swordBlocking: true }).dealt).toBe(7);
  });

  it('distinguishes contact fire from afterburn for sword use, preserving existing fire armor', () => {
    const target = new SurvivalSystem();
    expect(target.damage(3, 'fire', { swordBlocking: true, fireContact: true }).dealt).toBe(2);
    const bypass = new SurvivalSystem();
    expect(bypass.damage(7, 'melee', { swordBlocking: true, bypassArmor: true }).dealt).toBe(7);
  });
});

describe('survival and bow regressions', () => {
  it('keeps all bow charge thresholds, launch speed and critical flag', () => {
    expect(bowCharge(1).canFire).toBe(false);
    expect(bowCharge(3).canFire).toBe(true);
    expect(bowCharge(10)).toMatchObject({ power: 5 / 12, launchSpeed: 1.25, critical: false });
    expect(bowCharge(20)).toMatchObject({ power: 1, launchSpeed: 3, canFire: true, critical: true });
    expect(bowCharge(40).launchSpeed).toBe(3);
  });
  it('tracks drowning, death, respawn and food', () => {
    const target = new SurvivalSystem();
    for (let t = 0; t < MAX_AIR_TICKS + 18; t++) target.tick(0.05, { inWater: true, headSubmerged: true });
    expect(target.health).toBe(20);
    target.tick(0.05, { inWater: true, headSubmerged: true });
    expect(target.health).toBe(18);
    target.damage(100, 'void', { ignoreInvulnerability: true });
    expect(target.dead).toBe(true);
    target.respawn();
    expect(target).toMatchObject({ health: 20, hunger: 20, saturation: 5, dead: false });
    target.hunger = 12;
    expect(target.consumeFood('cooked_beef')).toBe(true);
    expect(target.hunger).toBe(20);
    expect(target.consumeFood('apple')).toBe(false);
  });
});
