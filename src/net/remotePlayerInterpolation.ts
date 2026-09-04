import { TICK_RATE } from '../core/constants';
import { lerpAngle } from '../core/entityInterpolation';

/** 20 TPS server tick length. Remote samples are keyed by this, not arrival time. */
export const REMOTE_TICK_MS = 1000 / TICK_RATE;

/** Render this far behind the estimated server tick. 100 ms = 2 ticks at 20 TPS. */
export const REMOTE_INTERP_DELAY_MS = 100;
export const REMOTE_INTERP_DELAY_MIN_MS = 80;
export const REMOTE_INTERP_DELAY_MAX_MS = 180;

/** After the last snapshot, coast on velocity for at most this long, then hold. */
export const REMOTE_EXTRAPOLATION_MS = 100;
export const REMOTE_RECOVERY_MS = 100;
export const REMOTE_TELEPORT_DISTANCE = 6;

/** Bounded per-player ring. Delay (2) + extrapolation (2) + jitter slack. */
export const REMOTE_BUFFER_MAX_SAMPLES = 12;

export const REMOTE_INTERP_DELAY_TICKS = REMOTE_INTERP_DELAY_MS / REMOTE_TICK_MS;
export const REMOTE_EXTRAPOLATION_TICKS = REMOTE_EXTRAPOLATION_MS / REMOTE_TICK_MS;

const DIAG_WINDOW_MS = 1000;

/**
 * Clock:
 *   clockTick = latestServerTick + (now - latestReceivedAt) / REMOTE_TICK_MS
 *   renderTick = max(previousRenderTick, clockTick - delayTicks)
 *
 * Sample simulation time is `serverTick`, never packet arrival. `receivedAt` is
 * telemetry and the elapsed term of the *latest* sample only.
 */
export type RemoteInterpMode = 'hold' | 'interpolate' | 'extrapolate' | 'capped';
export type RemotePushResult = 'accepted' | 'stale' | 'duplicate';

export interface RemoteInterpSample {
  readonly serverTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround: boolean;
  readonly sprinting: boolean;
  readonly sneaking: boolean;
  readonly invisible: boolean;
  readonly dead: boolean;
  /** Client receive time. Telemetry / latest-clock elapsed only. */
  readonly receivedAt: number;
}

export interface RemoteSampledPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround: boolean;
  readonly sprinting: boolean;
  readonly sneaking: boolean;
  readonly invisible: boolean;
  readonly dead: boolean;
  readonly renderTick: number;
  readonly mode: RemoteInterpMode;
  readonly t: number;
  readonly extrapolationMs: number;
  readonly bufferDepth: number;
  readonly bufferDepthMs: number;
  readonly fromTick: number;
  readonly toTick: number;
}

export interface RemoteInterpDiagnostics {
  readonly snapshotsPerSecond: number;
  readonly serverTick: number;
  readonly bufferDepth: number;
  readonly bufferDepthMs: number;
  readonly bufferTargetDepth: number;
  readonly sampleCount: number;
  readonly interArrivalMs: number;
  readonly jitterMs: number;
  readonly arrivalJitterP50Ms: number;
  readonly arrivalJitterP95Ms: number;
  readonly renderDelayMs: number;
  readonly underflowsPerSecond: number;
  readonly extrapolationMs: number;
  readonly extrapolationEventsPerSecond: number;
  readonly staleSnapshotsPerSecond: number;
  readonly renderTick: number;
  readonly mode: RemoteInterpMode | 'empty';
  readonly latestReceivedAt: number;
}

interface DiagEvent {
  readonly at: number;
  readonly kind: 'accept' | 'stale' | 'duplicate' | 'underflow' | 'extrap';
}

function cloneSample(sample: RemoteInterpSample): RemoteInterpSample {
  return { ...sample };
}

function discreteFrom(
  previous: RemoteInterpSample,
  next: RemoteInterpSample,
  t: number,
): Pick<RemoteInterpSample, 'onGround' | 'sprinting' | 'sneaking' | 'invisible' | 'dead'> {
  const pick = t < 0.5 ? previous : next;
  return {
    onGround: pick.onGround,
    sprinting: pick.sprinting,
    sneaking: pick.sneaking,
    invisible: pick.invisible,
    dead: pick.dead,
  };
}

function poseFromSample(sample: RemoteInterpSample, extras: {
  readonly renderTick: number;
  readonly mode: RemoteInterpMode;
  readonly t: number;
  readonly extrapolationMs: number;
  readonly bufferDepth: number;
  readonly bufferDepthMs: number;
  readonly fromTick: number;
  readonly toTick: number;
}): RemoteSampledPose {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    yaw: sample.yaw,
    pitch: sample.pitch,
    vx: sample.vx,
    vy: sample.vy,
    vz: sample.vz,
    onGround: sample.onGround,
    sprinting: sample.sprinting,
    sneaking: sample.sneaking,
    invisible: sample.invisible,
    dead: sample.dead,
    ...extras,
  };
}

function extrapolateSample(
  sample: RemoteInterpSample,
  extraSeconds: number,
): Pick<RemoteInterpSample, 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'vx' | 'vy' | 'vz' | 'onGround' | 'sprinting' | 'sneaking' | 'invisible' | 'dead'> {
  return {
    x: sample.x + sample.vx * extraSeconds,
    y: sample.y + sample.vy * extraSeconds,
    z: sample.z + sample.vz * extraSeconds,
    yaw: sample.yaw,
    pitch: sample.pitch,
    vx: sample.vx,
    vy: sample.vy,
    vz: sample.vz,
    onGround: sample.onGround,
    sprinting: sample.sprinting,
    sneaking: sample.sneaking,
    invisible: sample.invisible,
    dead: sample.dead,
  };
}

function lerpPose(
  previous: RemoteInterpSample,
  next: RemoteInterpSample,
  t: number,
): Omit<RemoteSampledPose, 'renderTick' | 'mode' | 't' | 'extrapolationMs' | 'bufferDepth' | 'bufferDepthMs' | 'fromTick' | 'toTick'> {
  const clamped = Math.max(0, Math.min(1, t));
  const discrete = discreteFrom(previous, next, clamped);
  return {
    x: previous.x + (next.x - previous.x) * clamped,
    y: previous.y + (next.y - previous.y) * clamped,
    z: previous.z + (next.z - previous.z) * clamped,
    yaw: lerpAngle(previous.yaw, next.yaw, clamped),
    pitch: previous.pitch + (next.pitch - previous.pitch) * clamped,
    vx: previous.vx + (next.vx - previous.vx) * clamped,
    vy: previous.vy + (next.vy - previous.vy) * clamped,
    vz: previous.vz + (next.vz - previous.vz) * clamped,
    ...discrete,
  };
}

function countWindow(events: readonly DiagEvent[], kind: DiagEvent['kind'], now: number): number {
  const cutoff = now - DIAG_WINDOW_MS;
  let count = 0;
  for (const event of events) {
    if (event.at >= cutoff && event.kind === kind) count += 1;
  }
  return count;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Per-remote server-tick timeline. Node-safe: no Three / DOM / IndexedDB.
 */
export class RemoteInterpolationBuffer {
  private samples: RemoteInterpSample[] = [];
  private lastAcceptedTick = -1;
  private latestReceivedAt = 0;
  private lastRenderTick = Number.NEGATIVE_INFINITY;
  private lastMode: RemoteInterpMode = 'hold';
  private lastInterArrivalMs = REMOTE_TICK_MS;
  private arrivalJitterMs: number[] = [];
  private currentDelayMs = REMOTE_INTERP_DELAY_MS;
  private lastPose: RemoteSampledPose | undefined;
  private events: DiagEvent[] = [];
  private cappedPose: RemoteSampledPose | undefined;
  private recoveryPose: RemoteSampledPose | undefined;
  private recoveryStartedAt = 0;

  get latestServerTick(): number {
    return this.lastAcceptedTick;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  snapshots(): readonly RemoteInterpSample[] {
    return this.samples;
  }

  reset(): void {
    this.samples = [];
    this.lastAcceptedTick = -1;
    this.latestReceivedAt = 0;
    this.lastRenderTick = Number.NEGATIVE_INFINITY;
    this.lastMode = 'hold';
    this.lastInterArrivalMs = REMOTE_TICK_MS;
    this.arrivalJitterMs = [];
    this.currentDelayMs = REMOTE_INTERP_DELAY_MS;
    this.lastPose = undefined;
    this.events = [];
    this.cappedPose = undefined;
    this.recoveryPose = undefined;
    this.recoveryStartedAt = 0;
  }

  push(sample: RemoteInterpSample): RemotePushResult {
    if (!Number.isInteger(sample.serverTick)) return 'stale';
    if (sample.serverTick === this.lastAcceptedTick) {
      this.note(sample.receivedAt, 'duplicate');
      return 'duplicate';
    }
    if (sample.serverTick < this.lastAcceptedTick) {
      this.note(sample.receivedAt, 'stale');
      return 'stale';
    }
    const previous = this.samples[this.samples.length - 1];
    if (previous) {
      const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z);
      if (distance >= REMOTE_TELEPORT_DISTANCE || (previous.dead && !sample.dead)) {
        this.reset();
      }
    }
    if (this.lastAcceptedTick >= 0) {
      this.lastInterArrivalMs = sample.receivedAt - this.latestReceivedAt;
      const tickGap = sample.serverTick - this.lastAcceptedTick;
      const arrivalError = Math.abs(this.lastInterArrivalMs - tickGap * REMOTE_TICK_MS);
      this.arrivalJitterMs.push(arrivalError);
      if (this.arrivalJitterMs.length > 32) this.arrivalJitterMs.shift();
      this.currentDelayMs = clamp(
        REMOTE_INTERP_DELAY_MS + percentile(this.arrivalJitterMs, 0.95),
        REMOTE_INTERP_DELAY_MIN_MS,
        REMOTE_INTERP_DELAY_MAX_MS,
      );
    }
    if (this.lastPose && (this.lastMode === 'extrapolate' || this.lastMode === 'capped')) {
      this.recoveryPose = this.lastPose;
      this.recoveryStartedAt = sample.receivedAt;
    }
    this.lastAcceptedTick = sample.serverTick;
    this.latestReceivedAt = sample.receivedAt;
    this.samples.push(cloneSample(sample));
    this.samples.sort((a, b) => a.serverTick - b.serverTick);
    while (this.samples.length > REMOTE_BUFFER_MAX_SAMPLES) this.samples.shift();
    this.cappedPose = undefined;
    this.note(sample.receivedAt, 'accept');
    return 'accepted';
  }

  /**
   * `now` is local render time. Simulation lookup uses serverTick + elapsed
   * since the latest sample, minus the render delay. Arrival jitter of older
   * packets cannot move already-buffered sample times.
   */
  sample(now: number): RemoteSampledPose | undefined {
    if (this.samples.length === 0) return undefined;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    if (this.samples.length === 1) {
      const renderTick = this.advanceRenderTick(this.clockTick(now) - this.delayTicks());
      this.lastMode = 'hold';
      return this.storePose(poseFromSample(first, {
        renderTick,
        mode: 'hold',
        t: 0,
        extrapolationMs: 0,
        bufferDepth: 0,
        bufferDepthMs: 0,
        fromTick: first.serverTick,
        toTick: first.serverTick,
      }), now);
    }

    const renderTick = this.advanceRenderTick(this.clockTick(now) - this.delayTicks());
    const bufferDepth = this.futureSampleCount(renderTick);
    const bufferDepthMs = Math.max(0, (last.serverTick - renderTick) * REMOTE_TICK_MS);

    if (renderTick <= first.serverTick) {
      this.lastMode = 'hold';
      return this.storePose(poseFromSample(first, {
        renderTick,
        mode: 'hold',
        t: 0,
        extrapolationMs: 0,
        bufferDepth,
        bufferDepthMs,
        fromTick: first.serverTick,
        toTick: first.serverTick,
      }), now);
    }

    if (renderTick < last.serverTick) {
      const { previous, next } = this.surrounding(renderTick);
      const span = Math.max(1e-9, next.serverTick - previous.serverTick);
      const t = (renderTick - previous.serverTick) / span;
      const lerped = lerpPose(previous, next, t);
      this.lastMode = 'interpolate';
      return this.storePose({
        ...lerped,
        renderTick,
        mode: 'interpolate',
        t,
        extrapolationMs: 0,
        bufferDepth,
        bufferDepthMs,
        fromTick: previous.serverTick,
        toTick: next.serverTick,
      }, now);
    }

    const extraTicks = renderTick - last.serverTick;
    const extraMs = extraTicks * REMOTE_TICK_MS;
    if (extraMs <= 1e-9) {
      this.lastMode = 'interpolate';
      return this.storePose(poseFromSample(last, {
        renderTick,
        mode: 'interpolate',
        t: 1,
        extrapolationMs: 0,
        bufferDepth: 0,
        bufferDepthMs: 0,
        fromTick: last.serverTick,
        toTick: last.serverTick,
      }), now);
    }

    if (this.lastMode !== 'extrapolate' && this.lastMode !== 'capped') this.note(now, 'underflow');
    if (extraMs <= REMOTE_EXTRAPOLATION_MS) {
      if (this.lastMode !== 'extrapolate') this.note(now, 'extrap');
      this.lastMode = 'extrapolate';
      const coast = extrapolateSample(last, extraMs / 1000);
      return this.storePose({
        ...coast,
        renderTick,
        mode: 'extrapolate',
        t: 1,
        extrapolationMs: extraMs,
        bufferDepth: 0,
        bufferDepthMs: 0,
        fromTick: last.serverTick,
        toTick: last.serverTick,
      }, now);
    }

    if (this.lastMode !== 'capped') this.note(now, 'extrap');
    this.lastMode = 'capped';
    if (!this.cappedPose) {
      const coast = extrapolateSample(last, REMOTE_EXTRAPOLATION_MS / 1000);
      this.cappedPose = {
        ...coast,
        renderTick,
        mode: 'capped',
        t: 1,
        extrapolationMs: REMOTE_EXTRAPOLATION_MS,
        bufferDepth: 0,
        bufferDepthMs: 0,
        fromTick: last.serverTick,
        toTick: last.serverTick,
      };
    }
    return this.storePose({ ...this.cappedPose, renderTick, bufferDepth: 0, bufferDepthMs: 0 }, now);
  }

  diagnostics(now: number): RemoteInterpDiagnostics {
    this.trimEvents(now);
    const pose = this.lastPose;
    return {
      snapshotsPerSecond: countWindow(this.events, 'accept', now),
      serverTick: this.lastAcceptedTick,
      bufferDepth: pose?.bufferDepth ?? 0,
      bufferDepthMs: pose?.bufferDepthMs ?? 0,
      bufferTargetDepth: this.delayTicks(),
      sampleCount: this.samples.length,
      interArrivalMs: this.lastInterArrivalMs,
      jitterMs: percentile(this.arrivalJitterMs, 0.95),
      arrivalJitterP50Ms: percentile(this.arrivalJitterMs, 0.5),
      arrivalJitterP95Ms: percentile(this.arrivalJitterMs, 0.95),
      renderDelayMs: this.currentDelayMs,
      underflowsPerSecond: countWindow(this.events, 'underflow', now),
      extrapolationMs: pose?.extrapolationMs ?? 0,
      extrapolationEventsPerSecond: countWindow(this.events, 'extrap', now),
      staleSnapshotsPerSecond: countWindow(this.events, 'stale', now) + countWindow(this.events, 'duplicate', now),
      renderTick: pose?.renderTick ?? 0,
      mode: pose?.mode ?? 'empty',
      latestReceivedAt: this.latestReceivedAt,
    };
  }

  private storePose(pose: RemoteSampledPose, now: number): RemoteSampledPose {
    let rendered = pose;
    if (this.recoveryPose) {
      const linear = clamp((now - this.recoveryStartedAt) / REMOTE_RECOVERY_MS, 0, 1);
      const t = linear * linear * (3 - 2 * linear);
      const from = this.recoveryPose;
      rendered = {
        ...pose,
        x: from.x + (pose.x - from.x) * t,
        y: from.y + (pose.y - from.y) * t,
        z: from.z + (pose.z - from.z) * t,
        yaw: lerpAngle(from.yaw, pose.yaw, t),
        pitch: from.pitch + (pose.pitch - from.pitch) * t,
        vx: from.vx + (pose.vx - from.vx) * t,
        vy: from.vy + (pose.vy - from.vy) * t,
        vz: from.vz + (pose.vz - from.vz) * t,
      };
      if (linear >= 1) this.recoveryPose = undefined;
    }
    this.lastPose = rendered;
    return rendered;
  }

  private clockTick(now: number): number {
    if (this.lastAcceptedTick < 0) return 0;
    return this.lastAcceptedTick + (now - this.latestReceivedAt) / REMOTE_TICK_MS;
  }

  private delayTicks(): number {
    return this.currentDelayMs / REMOTE_TICK_MS;
  }

  private advanceRenderTick(raw: number): number {
    const tick = this.lastRenderTick > raw ? this.lastRenderTick : raw;
    this.lastRenderTick = tick;
    return tick;
  }

  private futureSampleCount(renderTick: number): number {
    let count = 0;
    for (const sample of this.samples) {
      if (sample.serverTick > renderTick) count += 1;
    }
    return count;
  }

  private surrounding(renderTick: number): { previous: RemoteInterpSample; next: RemoteInterpSample } {
    let index = 0;
    while (index < this.samples.length && this.samples[index]!.serverTick < renderTick) index += 1;
    if (index === 0) {
      return { previous: this.samples[0]!, next: this.samples[Math.min(1, this.samples.length - 1)]! };
    }
    if (index >= this.samples.length) {
      const last = this.samples[this.samples.length - 1]!;
      return { previous: last, next: last };
    }
    const exact = this.samples[index]!;
    if (exact.serverTick === renderTick) {
      const previous = this.samples[Math.max(0, index - 1)]!;
      return { previous, next: exact };
    }
    return { previous: this.samples[index - 1]!, next: exact };
  }

  private note(at: number, kind: DiagEvent['kind']): void {
    this.events.push({ at, kind });
    this.trimEvents(at);
  }

  private trimEvents(now: number): void {
    const cutoff = now - DIAG_WINDOW_MS;
    while (this.events.length > 0 && this.events[0]!.at < cutoff) this.events.shift();
  }
}

export function remoteSampleFromSnapshot(
  snapshot: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
    readonly pitch: number;
    readonly vx?: number;
    readonly vy?: number;
    readonly vz?: number;
    readonly onGround?: boolean;
    readonly sprinting?: boolean;
    readonly sneaking?: boolean;
    readonly invisible?: boolean;
    readonly dead?: boolean;
  },
  serverTick: number,
  receivedAt: number,
): RemoteInterpSample {
  return {
    serverTick,
    x: snapshot.x,
    y: snapshot.y,
    z: snapshot.z,
    yaw: snapshot.yaw,
    pitch: snapshot.pitch,
    vx: snapshot.vx ?? 0,
    vy: snapshot.vy ?? 0,
    vz: snapshot.vz ?? 0,
    onGround: snapshot.onGround ?? true,
    sprinting: snapshot.sprinting ?? false,
    sneaking: snapshot.sneaking ?? false,
    invisible: snapshot.invisible ?? false,
    dead: snapshot.dead ?? false,
    receivedAt,
  };
}
