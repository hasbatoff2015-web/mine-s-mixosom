import { describe, expect, it } from 'vitest';
import {
  REMOTE_BUFFER_MAX_SAMPLES,
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

  it('interpolation uses server ticks while adaptive delay absorbs arrival jitter', () => {
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
    const jitterDelay = jittered.diagnostics(arrivals[4]!).renderDelayMs;
    expect(jitterPose.renderTick).toBeCloseTo(104 - jitterDelay / REMOTE_TICK_MS, 5);
    expect(jitterPose.x).toBeCloseTo((jitterPose.renderTick - 100) * 0.2, 5);
    expect(jitterDelay).toBeGreaterThan(REMOTE_INTERP_DELAY_MS);
  });

  it('C: batched snapshots still interpolate on serverTick, not a single arrival', () => {
    const buffer = new RemoteInterpolationBuffer();
    const now = 400;
    for (let tick = 100; tick <= 104; tick += 1) {
      buffer.push(snap(tick, { receivedAt: now }));
    }
    const pose = buffer.sample(now)!;
    const delayTicks = buffer.diagnostics(now).renderDelayMs / REMOTE_TICK_MS;
    expect(pose.mode).toBe('interpolate');
    expect(pose.x).toBeCloseTo((104 - delayTicks - 100) * 0.2, 5);
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

  it('keeps the per-player snapshot history bounded', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 100 + REMOTE_BUFFER_MAX_SAMPLES * 3);
    expect(buffer.sampleCount).toBe(REMOTE_BUFFER_MAX_SAMPLES);
    expect(buffer.latestServerTick).toBe(100 + REMOTE_BUFFER_MAX_SAMPLES * 3);
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

  it.each([
    ['±5ms', [0, 5, -5, 4, -4]],
    ['±20ms', [0, 20, -20, 15, -15]],
    ['±30ms', [0, 30, -30, 25, -25]],
  ] as const)('adapts delay within 80–180ms for %s arrival jitter', (_name, jitter) => {
    const buffer = new RemoteInterpolationBuffer();
    for (let index = 0; index < jitter.length; index += 1) {
      const tick = 100 + index;
      const receivedAt = index * REMOTE_TICK_MS + jitter[index]!;
      buffer.push(snap(tick, { receivedAt }, receivedAt));
    }
    const diag = buffer.diagnostics((jitter.length - 1) * REMOTE_TICK_MS + jitter.at(-1)!);
    expect(diag.renderDelayMs).toBeGreaterThanOrEqual(80);
    expect(diag.renderDelayMs).toBeLessThanOrEqual(180);
    expect(diag.arrivalJitterP95Ms).toBeGreaterThanOrEqual(diag.arrivalJitterP50Ms);
  });

  it('smoothly recovers from extrapolation when a sudden-stop snapshot arrives', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const arrival = 104 * REMOTE_TICK_MS + 3 * REMOTE_TICK_MS;
    const coast = buffer.sample(arrival)!;
    expect(coast.mode).toBe('extrapolate');
    buffer.push(snap(105, { x: 0.8, vx: 0, receivedAt: arrival }, arrival));
    const first = buffer.sample(arrival)!;
    const middle = buffer.sample(arrival + 50)!;
    const settled = buffer.sample(arrival + 100)!;
    expect(first.x).toBeCloseTo(coast.x, 6);
    expect(Math.abs(middle.x - first.x)).toBeLessThan(Math.abs(0.8 - coast.x));
    expect(settled.x).toBeCloseTo(0.8, 6);
  });

  it('teleport and respawn reset history and snap to the new authoritative pose', () => {
    const teleported = new RemoteInterpolationBuffer();
    fillPerfect(teleported, 100, 104);
    teleported.push(snap(105, { x: 20, receivedAt: 105 * REMOTE_TICK_MS }));
    expect(teleported.sampleCount).toBe(1);
    expect(teleported.sample(105 * REMOTE_TICK_MS)!.x).toBe(20);

    const respawned = new RemoteInterpolationBuffer();
    respawned.push(remoteSampleFromSnapshot({ x: 1, y: 70, z: 1, yaw: 0, pitch: 0, dead: true }, 1, 0));
    respawned.push(remoteSampleFromSnapshot({ x: 2, y: 70, z: 1, yaw: 0, pitch: 0, dead: false }, 2, 50));
    expect(respawned.sampleCount).toBe(1);
    expect(respawned.sample(50)!.x).toBe(2);
  });

  it('interpolates a jump/fall arc without flattening Y', () => {
    const buffer = new RemoteInterpolationBuffer();
    for (let tick = 100; tick <= 106; tick += 1) {
      const t = (tick - 100) * 0.05;
      buffer.push(remoteSampleFromSnapshot({
        x: t * 4,
        y: 70 + 7 * t - 10 * t * t,
        z: 0,
        yaw: 0,
        pitch: 0,
        vx: 4,
        vy: 7 - 20 * t,
        onGround: false,
      }, tick, tick * REMOTE_TICK_MS));
    }
    const pose = buffer.sample(106 * REMOTE_TICK_MS + 25)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.y).toBeGreaterThan(70);
    expect(pose.vy).not.toBe(0);
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
