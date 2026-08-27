import { FIXED_DT } from '../core/constants';

export const MAX_HURT_RESISTANT_TICKS = 20;

export interface HurtResult {
  readonly accepted: boolean;
  readonly fullHurt: boolean;
  /** Raw incoming damage or its positive difference, before blocking/armor. */
  readonly rawDamage: number;
}

/** One 1.8 living-entity damage gate shared by player, mobs and projectile hits. */
export class HurtResistance {
  remainingTicks = 0;
  lastRawDamage = 0;
  private accumulator = 0;

  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += dt;
    const ticks = Math.floor((this.accumulator + 1e-9) / FIXED_DT);
    this.accumulator -= ticks * FIXED_DT;
    this.remainingTicks = Math.max(0, this.remainingTicks - ticks);
  }

  receive(rawDamage: number, ignoreInvulnerability = false): HurtResult {
    if (!Number.isFinite(rawDamage) || rawDamage <= 0) {
      return { accepted: false, fullHurt: false, rawDamage: 0 };
    }
    if (!ignoreInvulnerability && this.remainingTicks > MAX_HURT_RESISTANT_TICKS / 2) {
      if (rawDamage <= this.lastRawDamage) return { accepted: false, fullHurt: false, rawDamage: 0 };
      const difference = rawDamage - this.lastRawDamage;
      this.lastRawDamage = rawDamage;
      return { accepted: true, fullHurt: false, rawDamage: difference };
    }
    this.remainingTicks = MAX_HURT_RESISTANT_TICKS;
    this.lastRawDamage = rawDamage;
    return { accepted: true, fullHurt: true, rawDamage };
  }

  reset(): void {
    this.remainingTicks = 0;
    this.lastRawDamage = 0;
    this.accumulator = 0;
  }
}
