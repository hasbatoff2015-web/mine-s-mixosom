import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from '../src/core/constants';
import {
  advanceFixedStep,
  interpolationAlpha,
  interpolateAfterFixedTicks,
  restoreInterpolationOrigin,
} from '../src/core/fixedStep';

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

describe('fixed-step render interpolation window', () => {
  const dt = FIXED_DT;
  const step = 0.21585;
  const s0 = { x: 0, y: 1, z: 0 };
  const s1 = { x: 0, y: 1, z: step };
  const s2 = { x: 0, y: 1, z: step * 2 };
  const s3 = { x: 0, y: 1, z: step * 3 };

  it('one tick: leftover/dt lerp from pre-tick pose is a no-op vs inner previousPosition', () => {
    const renderBefore = interpolateAfterFixedTicks(s0, s1, 0.049, dt);
    expect(renderBefore.alpha).toBeCloseTo(0.98, 8);
    expect(renderBefore.z).toBeCloseTo(step * 0.98, 8);

    const after = advanceFixedStep(0.049, 0.012);
    expect(after.ticks).toBe(1);
    const previous = { ...s1 };
    restoreInterpolationOrigin(previous, s1, after.ticks);
    expect(previous).toEqual(s1);
    const renderAfter = interpolateAfterFixedTicks(previous, s2, after.nextAccumulator, dt);
    expect(renderAfter.z).toBeCloseTo(
      s1.z + (s2.z - s1.z) * interpolationAlpha(after.nextAccumulator, dt),
      8,
    );
    expect(Math.abs(renderAfter.z - renderBefore.z)).toBeLessThan(step * 0.25);
  });

  it('two ticks in one frame: leftover/dt against last-inner previousPosition hitch-steps one tick', () => {
    const renderBefore = interpolateAfterFixedTicks(s0, s1, 0.049, dt);
    const hitch = advanceFixedStep(0.049, 0.055);
    expect(hitch.ticks).toBe(2);
    expect(hitch.nextAccumulator).toBeCloseTo(0.004, 8);

    const naivePrevious = { ...s2 };
    const naive = interpolateAfterFixedTicks(naivePrevious, s3, hitch.nextAccumulator, dt);
    expect(naive.z).toBeCloseTo(s2.z + (s3.z - s2.z) * (0.004 / dt), 8);
    expect(naive.z - renderBefore.z).toBeGreaterThan(step * 0.8);

    const origin = { ...s1 };
    const previous = { ...s2 };
    restoreInterpolationOrigin(previous, origin, hitch.ticks);
    expect(previous).toEqual(s1);
    const corrected = interpolateAfterFixedTicks(previous, s3, hitch.nextAccumulator, dt);
    expect(corrected.alpha).toBeCloseTo(hitch.nextAccumulator / dt, 8);
    expect(corrected.z).toBeCloseTo(s1.z + (s3.z - s1.z) * corrected.alpha, 8);
    expect(Math.abs(corrected.z - renderBefore.z)).toBeLessThan(step * 0.35);
  });

  it('ticks=0 does not rewrite previousPosition', () => {
    const previous = { ...s1 };
    restoreInterpolationOrigin(previous, s0, 0);
    expect(previous).toEqual(s1);
  });
});
