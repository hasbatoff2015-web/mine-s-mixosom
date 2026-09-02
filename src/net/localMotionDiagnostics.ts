import { FIXED_DT } from '../core/constants';

export type ReconcileKind = 'ignored' | 'accepted' | 'corrected' | 'snapped';

const RATE_WINDOW_MS = 1000;
const TRACE_SECONDS = 2;
const TRACE_CAP = 240;

export type MotionWriteKind = 'position' | 'previousPosition' | 'velocity';

export type AckRejectReason =
  | 'none'
  | 'no-seq'
  | 'stale-seq'
  | 'duplicate-seq'
  | 'no-history'
  | 'xz'
  | 'y'
  | 'speed'
  | 'onGround'
  | 'flying';

export interface MotionPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MotionFrameSample {
  readonly at: number;
  readonly online: boolean;
  readonly ticks: number;
  readonly alpha: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}

export interface MotionRateEvent {
  readonly at: number;
  readonly kind: string;
}

function queryFlag(name: string, search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get(name);
  return value === '1' || value === 'true';
}

export function isMotionDiagQueryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return queryFlag('motionDiag', search) || queryFlag('motiondiag', search);
}

function countSince(events: readonly MotionRateEvent[], now: number, kind?: string): number {
  const cutoff = now - RATE_WINDOW_MS;
  let count = 0;
  for (const event of events) {
    if (event.at < cutoff) continue;
    if (kind && event.kind !== kind) continue;
    count += 1;
  }
  return count;
}

function dist(a: MotionPose, b: MotionPose): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function prune(events: MotionRateEvent[], now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  while (events.length > 0 && events[0]!.at < cutoff) events.shift();
}

/**
 * Local-player-only render/simulation probe. Cheap enough for every frame;
 * the 2 s numeric trace dumps only when `?motionDiag=1`.
 */
export class LocalMotionProbe {
  online = false;
  fps = 0;
  ticksThisFrame = 0;
  alpha = 0;
  lastReconcileAt = Number.NaN;
  lastPlayerStateAt = Number.NaN;
  lastKind: ReconcileKind = 'ignored';
  lastReject: AckRejectReason = 'none';
  lastAcceptMutated = false;
  position = { x: 0, y: 0, z: 0 };
  previous = { x: 0, y: 0, z: 0 };
  render = { x: 0, y: 0, z: 0 };
  readonly traceEnabled: boolean;
  private readonly events: MotionRateEvent[] = [];
  private readonly frames: MotionFrameSample[] = [];
  private lastTraceDumpAt = 0;

  constructor(traceEnabled = isMotionDiagQueryEnabled()) {
    this.traceEnabled = traceEnabled;
  }

  reset(): void {
    this.events.length = 0;
    this.frames.length = 0;
    this.lastReconcileAt = Number.NaN;
    this.lastPlayerStateAt = Number.NaN;
    this.lastKind = 'ignored';
    this.lastReject = 'none';
    this.lastAcceptMutated = false;
    this.lastTraceDumpAt = 0;
  }

  note(kind: string, now = performance.now()): void {
    this.events.push({ at: now, kind });
    prune(this.events, now);
  }

  noteWrite(kind: MotionWriteKind, now = performance.now()): void {
    this.note(`write:${kind}`, now);
  }

  notePredictionTick(now = performance.now()): void {
    this.note('predict', now);
    this.noteWrite('position', now);
    this.noteWrite('previousPosition', now);
    this.noteWrite('velocity', now);
  }

  notePlayerState(now = performance.now()): void {
    this.lastPlayerStateAt = now;
    this.note('player_state', now);
  }

  noteReconcile(result: {
    readonly kind: ReconcileKind;
    readonly rejectReason: AckRejectReason;
    readonly acceptMutated: boolean;
  }, now = performance.now()): void {
    this.lastReconcileAt = now;
    this.lastKind = result.kind;
    this.lastReject = result.rejectReason;
    if (result.kind === 'accepted') this.lastAcceptMutated = result.acceptMutated;
    this.note(`reconcile:${result.kind}`, now);
    if (result.kind === 'accepted' && result.acceptMutated) this.note('accept-mutated', now);
    if (result.rejectReason !== 'none' && result.kind !== 'accepted') {
      this.note(`reject:${result.rejectReason}`, now);
    }
  }

  noteCorrectionWrite(kind: MotionWriteKind, now = performance.now()): void {
    this.noteWrite(kind, now);
  }

  recordRender(input: {
    readonly now?: number;
    readonly online: boolean;
    readonly fps: number;
    readonly ticks: number;
    readonly alpha: number;
    readonly position: MotionPose;
    readonly previous: MotionPose;
    readonly render: MotionPose;
  }): void {
    const now = input.now ?? performance.now();
    this.online = input.online;
    this.fps = input.fps;
    this.ticksThisFrame = input.ticks;
    this.alpha = input.alpha;
    this.position = { x: input.position.x, y: input.position.y, z: input.position.z };
    this.previous = { x: input.previous.x, y: input.previous.y, z: input.previous.z };
    this.render = { x: input.render.x, y: input.render.y, z: input.render.z };
    prune(this.events, now);
    if (!this.traceEnabled) return;
    this.frames.push({
      at: now,
      online: input.online,
      ticks: input.ticks,
      alpha: input.alpha,
      x: input.position.x,
      y: input.position.y,
      z: input.position.z,
      px: input.previous.x,
      py: input.previous.y,
      pz: input.previous.z,
      rx: input.render.x,
      ry: input.render.y,
      rz: input.render.z,
    });
    const cutoff = now - TRACE_SECONDS * 1000;
    while (this.frames.length > TRACE_CAP || (this.frames.length > 0 && this.frames[0]!.at < cutoff)) {
      this.frames.shift();
    }
    if (now - this.lastTraceDumpAt >= TRACE_SECONDS * 1000) {
      this.lastTraceDumpAt = now;
      this.dumpTrace();
    }
  }

  rate(kind: string, now = performance.now()): number {
    return countSince(this.events, now, kind);
  }

  formatHud(now = performance.now()): string {
    const sinceReconcile = Number.isFinite(this.lastReconcileAt) ? now - this.lastReconcileAt : -1;
    const sinceState = Number.isFinite(this.lastPlayerStateAt) ? now - this.lastPlayerStateAt : -1;
    const step = dist(this.position, this.previous);
    const mode = this.online ? 'online' : 'singleplayer';
    const acceptMut = this.rate('accept-mutated', now);
    return [
      `Motion ${mode} fps=${this.fps} ticks=${this.ticksThisFrame} alpha=${this.alpha.toFixed(3)} dt=${FIXED_DT}`,
      `pred/s=${this.rate('predict', now)} state/s=${this.rate('player_state', now)} rec/s=${this.rate('reconcile:accepted', now) + this.rate('reconcile:corrected', now) + this.rate('reconcile:snapped', now) + this.rate('reconcile:ignored', now)}`,
      `ok/s=${this.rate('reconcile:accepted', now)} corr/s=${this.rate('reconcile:corrected', now)} snap/s=${this.rate('reconcile:snapped', now)} dup/s=${this.rate('reject:duplicate-seq', now)}`,
      `writes pos/s=${this.rate('write:position', now)} prev/s=${this.rate('write:previousPosition', now)} vel/s=${this.rate('write:velocity', now)} acceptMut/s=${acceptMut}`,
      `pos ${this.position.x.toFixed(3)} ${this.position.y.toFixed(3)} ${this.position.z.toFixed(3)} prev ${this.previous.x.toFixed(3)} ${this.previous.y.toFixed(3)} ${this.previous.z.toFixed(3)}`,
      `render ${this.render.x.toFixed(3)} ${this.render.y.toFixed(3)} ${this.render.z.toFixed(3)} |pos-prev|=${step.toFixed(4)} cam=interpolated-local`,
      `since rec=${sinceReconcile.toFixed(0)}ms state=${sinceState.toFixed(0)}ms last=${this.lastKind}/${this.lastReject} acceptMut=${this.lastAcceptMutated ? 'YES' : 'no'}`,
    ].join('\n');
  }

  recentFrames(): readonly MotionFrameSample[] {
    return this.frames;
  }

  private dumpTrace(): void {
    if (typeof console === 'undefined' || this.frames.length === 0) return;
    const heading = this.online ? 'ONLINE' : 'SINGLEPLAYER';
    const lines = this.frames.map((frame) => {
      const step = Math.hypot(frame.x - frame.px, frame.y - frame.py, frame.z - frame.pz);
      return (
        `${(frame.at / 1000).toFixed(3)} t=${frame.ticks} a=${frame.alpha.toFixed(3)} `
        + `p=${frame.x.toFixed(3)},${frame.y.toFixed(3)},${frame.z.toFixed(3)} `
        + `prev=${frame.px.toFixed(3)},${frame.py.toFixed(3)},${frame.pz.toFixed(3)} `
        + `r=${frame.rx.toFixed(3)},${frame.ry.toFixed(3)},${frame.rz.toFixed(3)} d=${step.toFixed(4)}`
      );
    });
    console.info(`[motionDiag] ${heading} ${this.frames.length} frames / ${TRACE_SECONDS}s\n${lines.join('\n')}`);
  }
}

export const motionProbe = new LocalMotionProbe();

export function captureMotionPose(player: {
  readonly position: MotionPose;
  readonly previousPosition: MotionPose;
  readonly velocity: MotionPose;
  readonly onGround: boolean;
  readonly isFlying: boolean;
}): {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  isFlying: boolean;
} {
  return {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    px: player.previousPosition.x,
    py: player.previousPosition.y,
    pz: player.previousPosition.z,
    vx: player.velocity.x,
    vy: player.velocity.y,
    vz: player.velocity.z,
    onGround: player.onGround,
    isFlying: player.isFlying,
  };
}

export function motionPoseChanged(
  player: {
    readonly position: MotionPose;
    readonly previousPosition: MotionPose;
    readonly velocity: MotionPose;
    readonly onGround: boolean;
    readonly isFlying: boolean;
  },
  before: ReturnType<typeof captureMotionPose>,
): boolean {
  return player.position.x !== before.x
    || player.position.y !== before.y
    || player.position.z !== before.z
    || player.previousPosition.x !== before.px
    || player.previousPosition.y !== before.py
    || player.previousPosition.z !== before.pz
    || player.velocity.x !== before.vx
    || player.velocity.y !== before.vy
    || player.velocity.z !== before.vz
    || player.onGround !== before.onGround
    || player.isFlying !== before.isFlying;
}
