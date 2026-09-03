import { describe, expect, it } from 'vitest';
import {
  REMOTE_EXTRAPOLATION_MS,
  REMOTE_INTERP_DELAY_MS,
  REMOTE_INTERP_DELAY_TICKS,
  REMOTE_TICK_MS,
  RemoteInterpolationBuffer,
  remoteSampleFromSnapshot,
} from '../src/net/remotePlayerInterpolation';

function snap(
  tick: number,
  extra: {
    x?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    yaw?: number;
    pitch?: number;
    onGround?: boolean;
    sprinting?: boolean;
    sneaking?: boolean;
    invisible?: boolean;
    receivedAt?: number;
  } = {},
  receivedAt = tick * REMOTE_TICK_MS,
) {
  return remoteSampleFromSnapshot({
    x: extra.x ?? (tick - 100) * 0.2,
    y: 70,
    z: 0,
    yaw: extra.yaw ?? 0,
    pitch: extra.pitch ?? 0,
    vx: extra.vx ?? 4,
    vy: extra.vy ?? 0,
    vz: extra.vz ?? 0,
    onGround: extra.onGround ?? true,
    sprinting: extra.sprinting ?? false,
    sneaking: extra.sneaking ?? false,
    invisible: extra.invisible ?? false,
  }, tick, extra.receivedAt ?? receivedAt);
}

function fillPerfect(buffer: RemoteInterpolationBuffer, from: number, to: number): void {
  for (let tick = from; tick <= to; tick += 1) {
    buffer.push(snap(tick));
  }
}

describe('remote player server-tick interpolation', () => {
  it('A: perfect 20Hz snapshots interpolate two ticks behind latest', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 110);
    const now = 110 * REMOTE_TICK_MS;
    const pose = buffer.sample(now)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.renderTick).toBeCloseTo(110 - REMOTE_INTERP_DELAY_TICKS, 5);
    expect(pose.x).toBeCloseTo((pose.renderTick - 100) * 0.2, 5);
    expect(pose.bufferDepth).toBeGreaterThanOrEqual(2);
  });

  it('B/L: irregular arrival does not snap to the newest snapshot', () => {
    const buffer = new RemoteInterpolationBuffer();
    const gaps = [50, 90, 35, 75, 45, 60, 40, 80];
    let now = 0;
    let tick = 100;
    const rendered: number[] = [];
    for (const gap of gaps) {
      now += gap;
      buffer.push(snap(tick, { receivedAt: now }, now));
      tick += 1;
      const pose = buffer.sample(now)!;
      rendered.push(pose.x);
      expect(pose.x).toBeLessThan((tick - 101) * 0.2 + 0.05);
    }
    for (let i = 1; i < rendered.length; i += 1) {
      expect(rendered[i]!).toBeGreaterThanOrEqual(rendered[i - 1]! - 1e-9);
    }
  });

  it('interpolation at a given renderTick ignores packet arrival times', () => {
    const even = new RemoteInterpolationBuffer();
    const jittered = new RemoteInterpolationBuffer();
    const arrivals = [0, 90, 125, 200, 245];
    for (let i = 0; i < 5; i += 1) {
      const tick = 100 + i;
      even.push(snap(tick, { receivedAt: i * REMOTE_TICK_MS }));
      jittered.push(snap(tick, { receivedAt: arrivals[i]! }));
    }
    const evenPose = even.sample(4 * REMOTE_TICK_MS)!;
    const jitterPose = jittered.sample(arrivals[4]!)!;
    expect(evenPose.renderTick).toBeCloseTo(102, 5);
    expect(jitterPose.renderTick).toBeCloseTo(102, 5);
    expect(jitterPose.x).toBeCloseTo(evenPose.x, 5);
  });

  it('C: batched snapshots still interpolate on serverTick, not a single arrival', () => {
    const buffer = new RemoteInterpolationBuffer();
    const now = 400;
    for (let tick = 100; tick <= 104; tick += 1) {
      buffer.push(snap(tick, { receivedAt: now }));
    }
    const pose = buffer.sample(now)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.x).toBeCloseTo((104 - REMOTE_INTERP_DELAY_TICKS - 100) * 0.2, 5);
    expect(pose.x).toBeLessThan(0.8);
  });

  it('D: a missing snapshot lerps across the gap without reversing', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { x: 0, vx: 0, receivedAt: 100 * REMOTE_TICK_MS }));
    buffer.push(snap(101, { x: 1, vx: 0, receivedAt: 101 * REMOTE_TICK_MS }));
    buffer.push(snap(103, { x: 3, vx: 0, receivedAt: 103 * REMOTE_TICK_MS }));
    const pose = buffer.sample(103 * REMOTE_TICK_MS + REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.renderTick).toBeCloseTo(102, 5);
    expect(pose.x).toBeCloseTo(2, 5);
  });

  it('E: a delayed snapshot that is still newer is accepted', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { receivedAt: 0 }));
    buffer.push(snap(101, { receivedAt: 120 }));
    expect(buffer.latestServerTick).toBe(101);
    expect(buffer.sampleCount).toBe(2);
  });

  it('F: duplicate ticks are rejected', () => {
    const buffer = new RemoteInterpolationBuffer();
    expect(buffer.push(snap(100))).toBe('accepted');
    expect(buffer.push(snap(100, { x: 99 }))).toBe('duplicate');
    expect(buffer.sample(0)!.x).toBeCloseTo(0, 5);
  });

  it('G: stale ticks never rewind the timeline', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(102, { x: 2, receivedAt: 100 }));
    buffer.push(snap(103, { x: 3, receivedAt: 150 }));
    expect(buffer.push(snap(101, { x: 99, receivedAt: 180 }))).toBe('stale');
    const before = buffer.sample(200)!.x;
    expect(buffer.push(snap(102, { x: 50, receivedAt: 210 }))).toBe('stale');
    expect(buffer.sample(220)!.x).toBeGreaterThanOrEqual(before - 1e-9);
  });

  it('H: 2–3 tick underflow uses velocity then stays bounded', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 105);
    const lastAt = 105 * REMOTE_TICK_MS;
    const twoTicks = buffer.sample(lastAt + 4 * REMOTE_TICK_MS)!;
    expect(twoTicks.mode).toBe('extrapolate');
    expect(twoTicks.extrapolationMs).toBeCloseTo(100, 5);
    const threeTicks = buffer.sample(lastAt + 5 * REMOTE_TICK_MS)!;
    expect(threeTicks.mode).toBe('capped');
    expect(threeTicks.extrapolationMs).toBe(REMOTE_EXTRAPOLATION_MS);
  });

  it('I: 50ms extrapolation coasts on latest velocity', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const lastAt = 104 * REMOTE_TICK_MS;
    const atLast = buffer.sample(lastAt + 2 * REMOTE_TICK_MS)!;
    const pose = buffer.sample(lastAt + 3 * REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('extrapolate');
    expect(pose.extrapolationMs).toBeCloseTo(50, 5);
    expect(pose.x).toBeCloseTo(atLast.x + 4 * 0.05, 4);
  });

  it('J: 100ms extrapolation matches the configured budget', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const lastAt = 104 * REMOTE_TICK_MS;
    const atLast = buffer.sample(lastAt + 2 * REMOTE_TICK_MS)!;
    const pose = buffer.sample(lastAt + 4 * REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('extrapolate');
    expect(pose.x).toBeCloseTo(atLast.x + 4 * (REMOTE_EXTRAPOLATION_MS / 1000), 4);
  });

  it('K: past 100ms holds the capped pose (no infinite coast, no snap back)', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const lastAt = 104 * REMOTE_TICK_MS;
    const atCap = buffer.sample(lastAt + 4 * REMOTE_TICK_MS)!;
    const later = buffer.sample(lastAt + 8 * REMOTE_TICK_MS)!;
    expect(later.mode).toBe('capped');
    expect(later.x).toBeCloseTo(atCap.x, 5);
    expect(later.x).not.toBeCloseTo((104 - 100) * 0.2, 2);
  });

  it('holds the first snapshot until a timeline exists', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { x: 5, vx: 8 }));
    const pose = buffer.sample(100 * REMOTE_TICK_MS + 500)!;
    expect(pose.mode).toBe('hold');
    expect(pose.x).toBe(5);
    expect(pose.extrapolationMs).toBe(0);
  });

  it('uses shortest-path yaw and does not interpolate booleans', () => {
    const buffer = new RemoteInterpolationBuffer();
    const from = Math.PI * 2 - 0.2;
    buffer.push(snap(100, { x: 0, vx: 0, yaw: from, onGround: true, sprinting: false, receivedAt: 0 }));
    buffer.push(snap(101, {
      x: 0, vx: 0, yaw: 0.2, onGround: false, sprinting: true, receivedAt: REMOTE_TICK_MS,
    }));
    buffer.push(snap(102, {
      x: 0, vx: 0, yaw: 0.2, onGround: false, sprinting: true, receivedAt: 2 * REMOTE_TICK_MS,
    }));
    buffer.push(snap(103, {
      x: 0, vx: 0, yaw: 0.2, onGround: false, sprinting: true, receivedAt: 3 * REMOTE_TICK_MS,
    }));
    const now = 3 * REMOTE_TICK_MS;
    const pose = buffer.sample(now)!;
    const delta = Math.abs(((pose.yaw - from + Math.PI) % (Math.PI * 2)) - Math.PI);
    expect(delta).toBeLessThan(Math.PI / 2);
    expect(pose.onGround === true || pose.onGround === false).toBe(true);
    expect(pose.sprinting === true || pose.sprinting === false).toBe(true);
  });

  it('rejoin reset drops stale history', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 108);
    buffer.reset();
    expect(buffer.sampleCount).toBe(0);
    expect(buffer.sample(200)).toBeUndefined();
    buffer.push(snap(400, { x: 10 }));
    expect(buffer.sample(400 * REMOTE_TICK_MS)!.x).toBe(10);
  });

  it('delay is 100ms and target depth is 2 ticks', () => {
    expect(REMOTE_INTERP_DELAY_MS).toBe(100);
    expect(REMOTE_INTERP_DELAY_TICKS).toBe(2);
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 110);
    const diag = buffer.diagnostics(110 * REMOTE_TICK_MS);
    expect(diag.renderDelayMs).toBe(100);
    expect(diag.bufferTargetDepth).toBe(2);
  });

  it('records underflow, extrapolation, and stale telemetry without needing a console flood', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const lastAt = 104 * REMOTE_TICK_MS;
    buffer.sample(lastAt + 3 * REMOTE_TICK_MS);
    const underflow = buffer.diagnostics(lastAt + 3 * REMOTE_TICK_MS);
    expect(underflow.underflowsPerSecond).toBeGreaterThanOrEqual(1);
    expect(underflow.extrapolationEventsPerSecond).toBeGreaterThanOrEqual(1);
    expect(underflow.extrapolationMs).toBeCloseTo(50, 5);
    expect(buffer.push(snap(90, { receivedAt: lastAt + 10 }))).toBe('stale');
    const stale = buffer.diagnostics(lastAt + 10);
    expect(stale.staleSnapshotsPerSecond).toBeGreaterThanOrEqual(1);
  });
});
