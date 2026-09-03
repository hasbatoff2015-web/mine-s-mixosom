import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from '../src/core/constants';
import { advanceFixedStep } from '../src/core/fixedStep';

describe('fixed-step catch-up', () => {
  it('runs about 20 ticks per second of 60 Hz frames', () => {
    let accumulator = 0;
    let ticks = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const step = advanceFixedStep(accumulator, 1 / 60);
      ticks += step.ticks;
      accumulator = step.nextAccumulator;
    }
    expect(ticks).toBeGreaterThanOrEqual(19);
    expect(ticks).toBeLessThanOrEqual(21);
  });

  it('does not run an unbounded catch-up after a 300ms stall', () => {
    const step = advanceFixedStep(0, 0.3);
    expect(step.elapsed).toBe(MAX_FRAME_DELTA);
    expect(step.ticks).toBe(MAX_CATCH_UP_TICKS);
    expect(step.ticks).toBeLessThan(Math.floor(0.3 / FIXED_DT));
    expect(step.droppedSeconds).toBeGreaterThan(0);
  });

  it('keeps leftover accumulator below one tick', () => {
    const step = advanceFixedStep(0.049, 0.016);
    expect(step.nextAccumulator).toBeLessThan(FIXED_DT);
    expect(step.ticks).toBeGreaterThanOrEqual(1);
  });
});
