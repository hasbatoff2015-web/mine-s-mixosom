import { describe, expect, it } from 'vitest';
import { SurvivalSystem } from '../src/survival';
import { heartHudIcons } from '../src/ui/heartHud';

describe('health/death invariant', () => {
  it('20 HP - 5 = 15 living', () => {
    const survival = new SurvivalSystem({ health: 20 });
    const result = survival.damage(5, 'melee', { ignoreInvulnerability: true, bypassArmor: true });
    expect(result.healthAfter).toBe(15);
    expect(survival.health).toBe(15);
    expect(survival.dead).toBe(false);
  });

  it('20 HP - 20 and overkill both become dead at 0', () => {
    const exact = new SurvivalSystem({ health: 20 });
    expect(exact.damage(20, 'void', { ignoreInvulnerability: true, bypassArmor: true }).killed).toBe(true);
    expect(exact.health).toBe(0);
    expect(exact.dead).toBe(true);

    const overkill = new SurvivalSystem({ health: 20 });
    expect(overkill.damage(21, 'explosion', { ignoreInvulnerability: true, bypassArmor: true }).killed).toBe(true);
    expect(overkill.health).toBe(0);
    expect(overkill.dead).toBe(true);
  });

  it('1 HP - 1 dies and cannot stay alive at 0', () => {
    const survival = new SurvivalSystem({ health: 1 });
    expect(survival.damage(1, 'melee', { ignoreInvulnerability: true, bypassArmor: true }).killed).toBe(true);
    expect(survival.health).toBe(0);
    expect(survival.dead).toBe(true);
    expect(survival.isAlive).toBe(false);
    expect(survival.damage(4, 'melee', { ignoreInvulnerability: true }).killed).toBe(false);
    expect(survival.health).toBe(0);
  });

  it('restore cannot create health=0 and alive=true', () => {
    const survival = new SurvivalSystem({ health: 8 });
    survival.restore({ health: 0, dead: false });
    expect(survival.health).toBe(0);
    expect(survival.dead).toBe(true);
    survival.restore({ health: 20, dead: false });
    expect(survival.health).toBe(20);
    expect(survival.dead).toBe(false);
  });

  it('HUD shows a half heart for any remaining HP above 0, including armor leftovers', () => {
    expect(heartHudIcons(0.4).icons[0]).toBe('half');
    expect(heartHudIcons(1.5).icons[0]).toBe('half');
    expect(heartHudIcons(0).icons[0]).toBe('empty');
    expect(heartHudIcons(20).icons.every((icon) => icon === 'full')).toBe(true);
  });

  it.each(['melee', 'projectile', 'fire', 'lava', 'fall', 'explosion'] as const)(
    '%s damage to 0 starts the death flow',
    (source) => {
      const survival = new SurvivalSystem({ health: 4 });
      const result = survival.damage(99, source, { ignoreInvulnerability: true, bypassArmor: true });
      expect(result.killed).toBe(true);
      expect(survival.health).toBe(0);
      expect(survival.dead).toBe(true);
    },
  );
});
