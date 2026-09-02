import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from '../src/core/constants';
import {
  compareLatestInputCoalesce,
  compareLockstepControllers,
  walkStepDistance,
} from '../src/player/moveSimCompare';
import { gameplayTicksDue } from '../server/tickScheduler';

describe('client vs server PlayerController lockstep', () => {
  it('does not diverge over 1, 2, 5, 10, 20 walk ticks', () => {
    for (const ticks of [1, 2, 5, 10, 20]) {
      const result = compareLockstepControllers(ticks, { forward: 1 });
      expect(result.identical, `walk diverged at tick ${result.firstDivergedTick}`).toBe(true);
    }
  });

  it('does not diverge for sprint, jump, or fly+descend', () => {
    expect(compareLockstepControllers(20, { forward: 1, sprint: true }).identical).toBe(true);
    expect(compareLockstepControllers(12, { jump: true }).identical).toBe(true);
    expect(compareLockstepControllers(12, { forward: 1, jump: true }).identical).toBe(true);
  });

  it('latest-input coalescing (2 client ticks vs 1 server tick) is ~one walk step', () => {
    const result = compareLatestInputCoalesce(2, 1, { forward: 1 });
    expect(result.xz).toBeGreaterThan(0.12);
    expect(result.xz).toBeLessThan(walkStepDistance() + 0.08);
    expect(result.y).toBeLessThan(0.05);
  });

  it('matching tick counts of the same latest input stay aligned', () => {
    const result = compareLatestInputCoalesce(2, 2, { forward: 1 });
    expect(result.xz).toBeLessThan(1e-6);
    expect(result.dist).toBeLessThan(1e-6);
  });
});

describe('server gameplay tick catch-up math', () => {
  it('turns 50ms into one tick and leftover 5ms plus 50ms into one more', () => {
    const first = gameplayTicksDue(0, 0.05, FIXED_DT);
    expect(first.ticks).toBe(1);
    expect(first.nextAccumulator).toBeCloseTo(0, 10);
    const late = gameplayTicksDue(0, 0.055, FIXED_DT);
    expect(late.ticks).toBe(1);
    expect(late.nextAccumulator).toBeGreaterThan(0.004);
    const catchUp = gameplayTicksDue(late.nextAccumulator, 0.055, FIXED_DT);
    expect(catchUp.ticks).toBe(1);
  });

  it('accumulates a second tick after repeated 55ms polls without changing dt', () => {
    let acc = 0;
    let ticks = 0;
    for (let i = 0; i < 20; i += 1) {
      const due = gameplayTicksDue(acc, 0.055, FIXED_DT);
      acc = due.nextAccumulator;
      ticks += due.ticks;
    }
    expect(ticks).toBeGreaterThanOrEqual(20);
    expect(ticks).toBeLessThanOrEqual(22);
    expect(FIXED_DT).toBe(0.05);
    expect(MAX_CATCH_UP_TICKS).toBe(4);
    expect(MAX_FRAME_DELTA).toBe(0.25);
  });
});
