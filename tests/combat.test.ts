import { describe, expect, it } from 'vitest';
import {
  CombatSystem,
  attackDamageFactor,
  attackStrength,
  bowCharge,
  getAttackProfile,
  shieldDisableChance,
} from '../src/combat';
import { MAX_AIR_TICKS, SurvivalSystem, reduceDamageByArmor } from '../src/survival';

describe('Java 1.9 combat helpers', () => {
  it('uses the quadratic cooldown damage curve with partial-tick offset', () => {
    expect(attackStrength(1.6, 0)).toBeCloseTo(0.04, 6);
    expect(attackStrength(1.6, 12)).toBe(1);
    expect(attackDamageFactor(0.5)).toBeCloseTo(0.4, 6);
  });

  it('uses the release 1.9 weapon profiles', () => {
    expect(getAttackProfile('stone_axe')).toMatchObject({ baseDamage: 9, attackSpeed: 0.8 });
    expect(getAttackProfile('diamond_sword')).toMatchObject({ baseDamage: 7, attackSpeed: 1.6 });
    expect(getAttackProfile()).toMatchObject({ baseDamage: 1, attackSpeed: 4 });
  });

  it('activates a shield after five ticks and applies 1.9 melee reduction', () => {
    const combat = new CombatSystem({ offhandItemId: 'shield' });
    combat.setUsingShield(true);
    combat.tick(0.25);
    expect(combat.shieldActive).toBe(true);
    const result = combat.resolveShieldHit({
      damage: 10,
      defenderYaw: 0,
      directionToAttacker: { x: 0, z: -1 },
    });
    expect(result.blockedDamage).toBeCloseTo(6.6, 6);
    expect(result.receivedDamage).toBeCloseTo(3.4, 6);
  });

  it('supports the configurable axe disable roll and bow curve', () => {
    expect(shieldDisableChance(0, false)).toBe(0.25);
    expect(shieldDisableChance(0, true)).toBe(1);
    expect(bowCharge(20)).toMatchObject({ power: 1, launchSpeed: 3, canFire: true, critical: true });
    expect(bowCharge(1).canFire).toBe(false);
  });

  it('applies the release 1.9 armor formula without implicit toughness', () => {
    expect(reduceDamageByArmor(10, { points: 20, toughness: 8 })).toBeCloseTo(4, 6);
    expect(reduceDamageByArmor(10, { points: 20, toughness: 8 }, true)).toBeCloseTo(3, 6);
  });
});

describe('SurvivalSystem', () => {
  it('tracks drowning, death and respawn deterministically at 20 TPS', () => {
    const survival = new SurvivalSystem();
    for (let tick = 0; tick < MAX_AIR_TICKS + 18; tick += 1) {
      survival.tick(0.05, { inWater: true, headSubmerged: true });
    }
    expect(survival.health).toBe(20);
    survival.tick(0.05, { inWater: true, headSubmerged: true });
    expect(survival.health).toBe(18);
    survival.damage(100, 'void', { ignoreInvulnerability: true });
    expect(survival.dead).toBe(true);
    survival.respawn();
    expect(survival).toMatchObject({ health: 20, hunger: 20, saturation: 5, dead: false });
  });

  it('consumes registered food while respecting the hunger cap', () => {
    const survival = new SurvivalSystem({ hunger: 12, saturation: 0 });
    expect(survival.consumeFood('cooked_beef')).toBe(true);
    expect(survival.hunger).toBe(20);
    expect(survival.saturation).toBeCloseTo(12.8, 6);
    expect(survival.consumeFood('apple')).toBe(false);
    survival.hunger = 16;
    expect(survival.consumeFood('apple')).toBe(true);
    expect(survival.hunger).toBe(20);
  });
});
