import { describe, expect, it } from 'vitest';
import {
  REMOTE_BUFFER_MAX_SAMPLES,
  REMOTE_EXTRAPOLATION_MS,
  REMOTE_INTERP_DELAY_MAX_MS,
  REMOTE_INTERP_DELAY_MIN_MS,
  REMOTE_INTERP_DELAY_MS,
  REMOTE_INTERP_DELAY_TICKS,
  REMOTE_RECOVERY_MS,
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
    flying?: boolean;
    invisible?: boolean;
    dead?: boolean;
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
    flying: extra.flying ?? false,
    invisible: extra.invisible ?? false,
    dead: extra.dead ?? false,
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

  it('teleport / respawn reset snaps instead of interpolating the gap', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 105);
    buffer.reset();
    buffer.push(snap(400, { x: 80, vx: 0, receivedAt: 400 * REMOTE_TICK_MS }));
    const pose = buffer.sample(400 * REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('hold');
    expect(pose.x).toBe(80);
  });

  it('±5ms / ±20ms / ±30ms arrival jitter still samples the same serverTick pose', () => {
    for (const jitter of [5, 20, 30]) {
      const even = new RemoteInterpolationBuffer();
      const noisy = new RemoteInterpolationBuffer();
      for (let i = 0; i < 8; i += 1) {
        const tick = 100 + i;
        even.push(snap(tick, { receivedAt: i * REMOTE_TICK_MS }));
        const offset = i % 2 === 0 ? jitter : -jitter;
        noisy.push(snap(tick, { receivedAt: i * REMOTE_TICK_MS + offset }));
      }
      const evenNow = 7 * REMOTE_TICK_MS;
      const noisyNow = 7 * REMOTE_TICK_MS + (7 % 2 === 0 ? jitter : -jitter);
      expect(noisy.sample(noisyNow)!.renderTick, `jitter ${jitter}`).toBeCloseTo(even.sample(evenNow)!.renderTick, 5);
      expect(noisy.sample(noisyNow)!.x, `jitter ${jitter}`).toBeCloseTo(even.sample(evenNow)!.x, 5);
    }
  });

  it('jump / fall samples keep ballistic y from authoritative states', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { x: 0, vx: 0, vy: 8, onGround: false, receivedAt: 0 }));
    buffer.push(snap(101, { x: 0, vx: 0, vy: 6, onGround: false, receivedAt: REMOTE_TICK_MS }));
    buffer.push(snap(102, { x: 0, vx: 0, vy: 4, onGround: false, receivedAt: 2 * REMOTE_TICK_MS }));
    buffer.push(snap(103, { x: 0, vx: 0, vy: 2, onGround: false, receivedAt: 3 * REMOTE_TICK_MS }));
    const pose = buffer.sample(3 * REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.vy).toBeGreaterThan(2);
    expect(pose.vy).toBeLessThan(8);
    expect(pose.onGround).toBe(false);
  });

  it('keeps a 12-sample buffer and reports bufferDepthMs', () => {
    expect(REMOTE_BUFFER_MAX_SAMPLES).toBe(12);
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 120);
    expect(buffer.sampleCount).toBe(12);
    const pose = buffer.sample(120 * REMOTE_TICK_MS)!;
    expect(pose.bufferDepthMs).toBeGreaterThanOrEqual(REMOTE_INTERP_DELAY_MS - 1e-6);
    expect(buffer.diagnostics(120 * REMOTE_TICK_MS).bufferDepthMs).toBeGreaterThanOrEqual(100);
  });

  it('keeps delay at 100ms on perfect 20Hz so BASE LAN smoothness is unchanged', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 110);
    const now = 110 * REMOTE_TICK_MS;
    buffer.sample(now);
    const diag = buffer.diagnostics(now);
    expect(diag.renderDelayMs).toBe(REMOTE_INTERP_DELAY_MS);
    expect(diag.jitterP95Ms).toBeLessThan(1);
    expect(diag.recovering).toBe(false);
  });

  it('does not grow delay from arrival jitter while still interpolating', () => {
    const buffer = new RemoteInterpolationBuffer();
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      now += i % 2 === 0 ? 90 : 10;
      buffer.push(snap(100 + i, { receivedAt: now }, now));
      const pose = buffer.sample(now)!;
      expect(pose.mode === 'interpolate' || pose.mode === 'hold').toBe(true);
    }
    expect(buffer.diagnostics(now).renderDelayMs).toBe(REMOTE_INTERP_DELAY_MS);
  });

  it('grows delay toward 100+jitterP95 after underflow, clamped 80..180', () => {
    expect(REMOTE_INTERP_DELAY_MIN_MS).toBe(80);
    expect(REMOTE_INTERP_DELAY_MAX_MS).toBe(180);
    const buffer = new RemoteInterpolationBuffer();
    let now = 0;
    for (let i = 0; i < 8; i += 1) {
      now += i % 2 === 0 ? 90 : 10;
      buffer.push(snap(100 + i, { receivedAt: now }, now));
    }
    const gapStart = now;
    buffer.sample(gapStart + 3 * REMOTE_TICK_MS);
    const afterUnderflow = buffer.diagnostics(gapStart + 3 * REMOTE_TICK_MS);
    expect(afterUnderflow.underflowsPerSecond).toBeGreaterThanOrEqual(1);
    expect(afterUnderflow.renderDelayMs).toBeGreaterThan(REMOTE_INTERP_DELAY_MS);
    expect(afterUnderflow.renderDelayMs).toBeLessThanOrEqual(REMOTE_INTERP_DELAY_MAX_MS);
    expect(afterUnderflow.renderDelayMs).toBeGreaterThanOrEqual(REMOTE_INTERP_DELAY_MIN_MS);
  });

  it('recovers from capped extrapolation within 100ms without infinite glide', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    const lastAt = 104 * REMOTE_TICK_MS;
    const capped = buffer.sample(lastAt + 8 * REMOTE_TICK_MS)!;
    expect(capped.mode).toBe('capped');
    const resumeAt = lastAt + 8 * REMOTE_TICK_MS;
    expect(buffer.push(snap(105, { x: 1.0, vx: 4, receivedAt: resumeAt }, resumeAt))).toBe('accepted');
    const start = buffer.sample(resumeAt)!;
    expect(buffer.diagnostics(resumeAt).recovering).toBe(true);
    expect(Math.abs(start.x - capped.x)).toBeLessThan(0.05);
    const doneAt = resumeAt + REMOTE_RECOVERY_MS;
    const recovered = buffer.sample(doneAt)!;
    expect(buffer.diagnostics(doneAt).recovering).toBe(false);
    expect(recovered.mode === 'interpolate' || recovered.mode === 'hold').toBe(true);
    expect(recovered.x).not.toBeCloseTo(capped.x, 1);
  });

  it('teleports 6+ blocks with a hard snap instead of interpolating the gap', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 105);
    const now = 200 * REMOTE_TICK_MS;
    expect(buffer.push(snap(200, { x: 80, vx: 0, receivedAt: now }, now))).toBe('accepted');
    expect(buffer.sampleCount).toBe(1);
    const pose = buffer.sample(now)!;
    expect(pose.mode).toBe('hold');
    expect(pose.x).toBe(80);
    expect(buffer.diagnostics(now).recovering).toBe(false);
  });

  it('respawn (dead → alive) snaps instead of recovering across the gap', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { x: 0, vx: 0, dead: true, receivedAt: 0 }));
    buffer.push(snap(101, { x: 0, vx: 0, dead: true, receivedAt: REMOTE_TICK_MS }));
    const now = 200 * REMOTE_TICK_MS;
    expect(buffer.push(snap(200, { x: 12, vx: 0, dead: false, receivedAt: now }, now))).toBe('accepted');
    expect(buffer.sampleCount).toBe(1);
    expect(buffer.sample(now)!.x).toBe(12);
    expect(buffer.diagnostics(now).recovering).toBe(false);
  });

  it('keeps flying as a discrete timeline flag, not replaced by dead', () => {
    const buffer = new RemoteInterpolationBuffer();
    buffer.push(snap(100, { x: 0, vx: 0, flying: false, receivedAt: 0 }));
    buffer.push(snap(101, { x: 0, vx: 0, flying: true, receivedAt: REMOTE_TICK_MS }));
    buffer.push(snap(102, { x: 0, vx: 0, flying: true, receivedAt: 2 * REMOTE_TICK_MS }));
    buffer.push(snap(103, { x: 0, vx: 0, flying: true, receivedAt: 3 * REMOTE_TICK_MS }));
    const pose = buffer.sample(3 * REMOTE_TICK_MS)!;
    expect(pose.mode).toBe('interpolate');
    expect(pose.flying === true || pose.flying === false).toBe(true);
  });

  it('stops then reverses without infinite glide or a backwards step', () => {
    const buffer = new RemoteInterpolationBuffer();
    for (let tick = 100; tick <= 108; tick += 1) {
      buffer.push(snap(tick, { x: (tick - 100) * 0.2, vx: 4, receivedAt: tick * REMOTE_TICK_MS }));
    }
    buffer.push(snap(109, { x: 1.6, vx: 0, receivedAt: 109 * REMOTE_TICK_MS }));
    buffer.push(snap(110, { x: 1.6, vx: 0, receivedAt: 110 * REMOTE_TICK_MS }));
    buffer.push(snap(111, { x: 1.4, vx: -4, receivedAt: 111 * REMOTE_TICK_MS }));
    buffer.push(snap(112, { x: 1.2, vx: -4, receivedAt: 112 * REMOTE_TICK_MS }));
    const stop = buffer.sample(110 * REMOTE_TICK_MS)!;
    expect(stop.x).toBeLessThan(1.7);
    const reverse = buffer.sample(112 * REMOTE_TICK_MS)!;
    expect(reverse.x).toBeLessThan(stop.x + 1e-6);
    expect(reverse.mode).not.toBe('capped');
  });

  it('walk visual steps stay small (no freeze-step) on perfect 20Hz', () => {
    const buffer = new RemoteInterpolationBuffer();
    fillPerfect(buffer, 100, 104);
    let now = 104 * REMOTE_TICK_MS;
    let prev = buffer.sample(now)!.x;
    const steps: number[] = [];
    for (let tick = 105; tick <= 120; tick += 1) {
      const tickAt = tick * REMOTE_TICK_MS;
      for (let t = now + 10; t < tickAt; t += 10) {
        const pose = buffer.sample(t)!;
        steps.push(Math.abs(pose.x - prev));
        prev = pose.x;
      }
      buffer.push(snap(tick, { receivedAt: tickAt }, tickAt));
      now = tickAt;
      const pose = buffer.sample(now)!;
      steps.push(Math.abs(pose.x - prev));
      prev = pose.x;
    }
    const maxStep = Math.max(...steps);
    expect(maxStep).toBeLessThan(0.12);
    expect(buffer.diagnostics(now).maxVisualStep).toBeLessThan(0.12);
  });
});
