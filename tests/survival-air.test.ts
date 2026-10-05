import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/core/constants';
import { MAX_AIR_TICKS, SurvivalSystem } from '../src/survival';

describe('survival air contract', () => {
  it('spends one air tick while the head is submerged and refills by four after surfacing', () => {
    const submerged = new SurvivalSystem();
    expect(submerged.airTicks).toBe(MAX_AIR_TICKS);
    expect(MAX_AIR_TICKS).toBe(300);
    for (let tick = 0; tick < 30; tick += 1) {
      submerged.tick(FIXED_DT, { inWater: true, headSubmerged: true, inLava: false });
    }
    expect(submerged.airTicks).toBe(270);
    expect(submerged.health).toBe(20);

    const empty = new SurvivalSystem();
    for (let tick = 0; tick < MAX_AIR_TICKS; tick += 1) {
      empty.tick(FIXED_DT, { inWater: true, headSubmerged: true, inLava: false });
    }
    expect(empty.airTicks).toBe(0);
    expect(empty.health).toBe(20);

    empty.tick(FIXED_DT, { inWater: false, headSubmerged: false, inLava: false });
    expect(empty.airTicks).toBe(4);
  });
});
