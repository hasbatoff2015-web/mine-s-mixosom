import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/core/constants';
import { advanceFixedStep, interpolationAlpha } from '../src/core/fixedStep';
import {
  LocalPlayerRenderState,
  describeTickTimeline,
  runSyntheticRenderLoop,
  signedHorizontalDelta,
} from '../src/core/localPlayerRenderState';

const dt = FIXED_DT;
const step = 0.2;
const along = { x: 0, z: 1 };

function pose(z: number, tickSpeed = step / dt): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  return { x: 0, y: 1, z, vx: 0, vy: 0, vz: tickSpeed };
}

describe('local player render state timelines', () => {
  it('case A: 0 ticks — leftover grows, render stays on last adjacent pair and moves forward', () => {
    const render = new LocalPlayerRenderState();
    render.reset(pose(0));
    render.pushAfterTick(pose(step), dt);
    const before = render.sample(0.02, dt);
    const after = describeTickTimeline(render, 0.02, 0.016, [], dt);
    expect(after.ticks).toBe(0);
    expect(after.leftoverAfter).toBeCloseTo(0.036, 8);
    expect(after.render.z).toBeGreaterThan(before.z);
    expect(after.render.fromTick).toBe(before.fromTick);
    expect(after.render.toTick).toBe(before.toTick);
    expect(signedHorizontalDelta(before, after.render, along)).toBeGreaterThan(0);
  });

  it('case B: 1 tick — last pair slides one step, leftover drops, render is continuous', () => {
    const render = new LocalPlayerRenderState();
    render.reset(pose(0));
    render.pushAfterTick(pose(step), dt);
    const before = render.sample(0.049, dt);
    expect(before.z).toBeCloseTo(step * interpolationAlpha(0.049), 8);
    const hitch = advanceFixedStep(0.049, 0.012, dt);
    expect(hitch.ticks).toBe(1);
    const after = describeTickTimeline(render, 0.049, 0.012, [pose(step * 2)], dt);
    expect(after.ticks).toBe(1);
    expect(after.render.fromTick).toBe(1);
    expect(after.render.toTick).toBe(2);
    expect(signedHorizontalDelta(before, after.render, along)).toBeGreaterThan(-1e-6);
    expect(Math.abs(after.render.z - before.z)).toBeLessThan(step * 0.35);
  });

  it('case C: 2 ticks — interpolates S2→S3, does not jump back toward S1', () => {
    const render = new LocalPlayerRenderState();
    render.reset(pose(0));
    render.pushAfterTick(pose(step), dt); // S1
    render.pushAfterTick(pose(step * 2), dt); // S2
    const before = render.sample(0.049, dt); // ≈ S2
    expect(before.z).toBeCloseTo(step * 2 * 0.98 + step * 0.02, 5);
    expect(before.z).toBeCloseTo(step + (step * 2 - step) * 0.98, 5);

    const hitch = advanceFixedStep(0.049, 0.055, dt);
    expect(hitch.ticks).toBe(2);
    const after = describeTickTimeline(render, 0.049, 0.055, [pose(step * 3), pose(step * 4)], dt);
    expect(after.states).toHaveLength(2);
    expect(after.render.fromTick).toBe(3);
    expect(after.render.toTick).toBe(4);
    expect(signedHorizontalDelta(before, after.render, along)).toBeGreaterThan(0);

    const wrongRestoreZ = step + after.alpha * (step * 4 - step);
    expect(before.z - wrongRestoreZ).toBeGreaterThan(step * 0.5);
  });

  it('case D: 3 ticks — interpolates last adjacent pair, still not backward', () => {
    const render = new LocalPlayerRenderState();
    render.reset(pose(0));
    render.pushAfterTick(pose(step), dt);
    const before = render.sample(0.049, dt);
    const hitch = advanceFixedStep(0.049, 0.12, dt);
    expect(hitch.ticks).toBe(3);
    const after = describeTickTimeline(
      render,
      0.049,
      0.12,
      [pose(step * 2), pose(step * 3), pose(step * 4)],
      dt,
    );
    expect(after.render.fromTick).toBe(3);
    expect(after.render.toTick).toBe(4);
    expect(signedHorizontalDelta(before, after.render, along)).toBeGreaterThan(0);
  });
});

describe('synthetic 20 TPS render loop without network', () => {
  const speed = 4.317;

  it.each([
    ['60 fps', 1 / 60],
    ['120 fps', 1 / 120],
    ['144 fps', 1 / 144],
    ['165 fps', 1 / 165],
  ])('%s is monotonic with no negative render deltas', (_label, frameDt) => {
    const run = runSyntheticRenderLoop({ seconds: 2, frameDt, speed });
    expect(run.stats.negative).toBe(0);
    expect(run.stats.min).toBeGreaterThan(-1e-6);
    expect(run.stats.max).toBeLessThan(speed * frameDt * 1.5 + 1e-6);
    expect(run.samples.at(-1)!.z).toBeGreaterThan(speed * 1.5);
  });
});
