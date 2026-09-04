import {
  formatPredIsolationMode,
  type PredIsolationMode,
} from './predIsolation';
import { localNetTrace } from './localPlayerNetTrace';
import type { PlayerSessionDiag, ServerTickClock } from '../../shared/protocol';

export type ReconcileKind = 'ignored' | 'accepted' | 'corrected' | 'snapped';
export {
  isPredNoNetQueryEnabled,
  isPredNoSendQueryEnabled,
  isPredNoStateQueryEnabled,
  resolvePredIsolation,
} from './predIsolation';
export {
  captureMotionFull,
  diffMotionFull,
  localNetTrace,
  traceLocalPlayerMutation,
  blockOverlapsPlayerVolume,
  chunkOverlapsPlayerColumn,
} from './localPlayerNetTrace';

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

export function isBowDiagQueryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return queryFlag('bowDiag', search) || queryFlag('bowdiag', search);
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
  lastSoftReject: AckRejectReason = 'none';
  lastAcceptMutated = false;
  lastBlockMutationAt = Number.NaN;
  lastChunkUpdateAt = Number.NaN;
  lastStateTick = -1;
  inboundTick: number | undefined;
  pendingSnapshotOverwrites = 0;
  sampleWorldHint: (() => {
    feetBlock: string;
    belowBlock: string;
    aheadBlock: string;
    aabbBlocks?: string;
    chunkKey?: string;
    chunkLoaded?: boolean;
    mutationMarks?: number;
    visibility?: string;
  }) | undefined;
  position = { x: 0, y: 0, z: 0 };
  previous = { x: 0, y: 0, z: 0 };
  render = { x: 0, y: 0, z: 0 };
  camera = { x: 0, y: 0, z: 0 };
  leftover = 0;
  simTick = 0;
  fromTick = 0;
  toTick = 0;
  cameraSource = 'interpolated-local';
  isolationMode: PredIsolationMode = 'normal';
  ignoreNetworkMotion = false;
  ignoreNetworkSend = false;
  ignoreNetworkState = false;
  lastRenderDelta = 0;
  lastCameraDelta = 0;
  lastPhysicsTicks = 1;
  serverPhysicsTps = 0;
  serverSnapGen = 0;
  serverSnapSent = 0;
  serverDroppedTicks = 0;
  serverLatenessMs = 0;
  serverCallbackMs = 0;
  serverEldMean = 0;
  serverEldP95 = 0;
  serverEldP99 = 0;
  serverEldMax = 0;
  serverTickWallMs = 0;
  serverEntities = 0;
  serverBlockChanges = 0;
  serverChunkSends = 0;
  serverChunkGens = 0;
  serverInputGapMs = 0;
  serverInputPackets = 0;
  session?: PlayerSessionDiag;
  readonly traceEnabled: boolean;
  private readonly events: MotionRateEvent[] = [];
  private readonly frames: MotionFrameSample[] = [];
  private readonly renderDeltas: Array<{ at: number; delta: number }> = [];
  private readonly cameraDeltas: Array<{ at: number; delta: number }> = [];
  private lastRender = { x: 0, y: 0, z: 0 };
  private hasLastRender = false;
  private lastCamera = { x: 0, y: 0, z: 0 };
  private previousCamera = { x: 0, y: 0, z: 0 };
  private hasLastCamera = false;
  private lastSimPosition = { x: 0, y: 0, z: 0 };
  private hasLastSimPosition = false;
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
    this.lastSoftReject = 'none';
    this.lastAcceptMutated = false;
    this.lastTraceDumpAt = 0;
    this.lastBlockMutationAt = Number.NaN;
    this.lastChunkUpdateAt = Number.NaN;
    this.lastStateTick = -1;
    this.inboundTick = undefined;
    this.pendingSnapshotOverwrites = 0;
    this.renderDeltas.length = 0;
    this.cameraDeltas.length = 0;
    this.hasLastRender = false;
    this.hasLastCamera = false;
    this.hasLastSimPosition = false;
    this.isolationMode = 'normal';
    this.ignoreNetworkMotion = false;
    this.ignoreNetworkSend = false;
    this.ignoreNetworkState = false;
    this.lastPhysicsTicks = 1;
    this.serverPhysicsTps = 0;
    this.serverSnapGen = 0;
    this.serverSnapSent = 0;
    this.serverDroppedTicks = 0;
    this.serverLatenessMs = 0;
    this.serverCallbackMs = 0;
    this.serverEldMean = 0;
    this.serverEldP95 = 0;
    this.serverEldP99 = 0;
    this.serverEldMax = 0;
    this.serverTickWallMs = 0;
    this.serverEntities = 0;
    this.serverBlockChanges = 0;
    this.serverChunkSends = 0;
    this.serverChunkGens = 0;
    this.serverInputGapMs = 0;
    this.serverInputPackets = 0;
    this.session = undefined;
    localNetTrace.reset();
  }

  note(kind: string, now = performance.now()): void {
    this.events.push({ at: now, kind });
    prune(this.events, now);
  }

  noteSend(seq: number, now = performance.now()): void {
    this.note('send:input', now);
    localNetTrace.noteSend(seq, now);
  }

  noteRecv(type: string, now = performance.now()): void {
    this.note(`recv:${type}`, now);
    localNetTrace.noteRecv(type, now);
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

  notePlayerState(seq?: number, now = performance.now()): void {
    this.lastPlayerStateAt = now;
    this.note('player_state', now);
    if (seq !== undefined) localNetTrace.lastPlayerStateSeq = seq;
  }

  noteSnapshotInbound(now = performance.now()): void {
    this.note('snap:recv', now);
  }

  notePendingOverwrite(now = performance.now()): void {
    this.pendingSnapshotOverwrites += 1;
    this.note('snap:overwrite', now);
  }

  noteTickClock(message: {
    readonly physicsTicks?: number;
    readonly tickClock?: ServerTickClock;
    readonly players?: ReadonlyArray<{ readonly session?: PlayerSessionDiag }>;
  }, now = performance.now()): void {
    const ticks = Math.max(1, Math.floor(message.physicsTicks ?? message.tickClock?.physicsTicksThisLoop ?? 1));
    this.lastPhysicsTicks = ticks;
    if (ticks > 1) this.note('phys:catch-up', now);
    const clock = message.tickClock;
    if (clock) {
      this.serverPhysicsTps = clock.physicsTps;
      this.serverSnapGen = clock.snapGen;
      this.serverSnapSent = clock.snapSent;
      this.serverDroppedTicks = clock.droppedTicks;
      this.serverLatenessMs = clock.latenessMs ?? 0;
      this.serverCallbackMs = clock.callbackMs ?? 0;
      this.serverEldMean = clock.eldMean ?? 0;
      this.serverEldP95 = clock.eldP95 ?? 0;
      this.serverEldP99 = clock.eldP99 ?? 0;
      this.serverEldMax = clock.eldMax ?? 0;
      this.serverTickWallMs = clock.tickWallMs ?? 0;
      this.serverEntities = clock.entities ?? 0;
      this.serverBlockChanges = clock.blockChanges ?? 0;
      this.serverChunkSends = clock.chunkSends ?? 0;
      this.serverChunkGens = clock.chunkGens ?? 0;
      this.serverInputGapMs = clock.inputGapMs ?? 0;
      this.serverInputPackets = clock.inputPackets ?? 0;
    }
    const session = message.players?.find((player) => player.session)?.session;
    if (session) this.session = session;
  }

  noteSnapshotDrop(reason: 'stale' | 'no-local', now = performance.now()): void {
    this.note(`snap:drop-${reason}`, now);
  }

  noteSeqGap(gap: number, now = performance.now()): void {
    if (gap > 1) this.note('seq-gap', now);
  }

  noteBlockMutation(now = performance.now()): void {
    this.lastBlockMutationAt = now;
    this.note('world:block', now);
  }

  noteChunkUpdate(now = performance.now()): void {
    this.lastChunkUpdateAt = now;
    this.note('world:chunk', now);
  }

  noteReconcile(result: {
    readonly kind: ReconcileKind;
    readonly rejectReason: AckRejectReason;
    readonly acceptMutated: boolean;
    readonly softReject?: AckRejectReason;
  }, now = performance.now()): void {
    this.lastReconcileAt = now;
    this.lastKind = result.kind;
    this.lastReject = result.rejectReason;
    this.lastSoftReject = result.softReject ?? 'none';
    if (result.kind === 'accepted') this.lastAcceptMutated = result.acceptMutated;
    this.note(`reconcile:${result.kind}`, now);
    localNetTrace.noteReconcile(result.kind, result.rejectReason, now, result.softReject ?? 'none');
    if (result.kind === 'accepted' && result.acceptMutated) this.note('accept-mutated', now);
    if (result.rejectReason !== 'none' && result.kind !== 'accepted') {
      this.note(`reject:${result.rejectReason}`, now);
    }
    if (result.softReject && result.softReject !== 'none' && result.kind === 'accepted') {
      this.note(`soft:${result.softReject}`, now);
    }
  }

  noteCorrectionWrite(kind: MotionWriteKind, now = performance.now()): void {
    this.noteWrite(kind, now);
  }

  noteCamera(
    camera: MotionPose,
    pivot: MotionPose,
    source: string,
    now = performance.now(),
  ): void {
    this.cameraSource = source;
    const next = { x: camera.x, y: camera.y, z: camera.z };
    if (this.hasLastCamera) {
      this.previousCamera = this.lastCamera;
      const delta = dist(next, this.lastCamera);
      this.lastCameraDelta = delta;
      this.cameraDeltas.push({ at: now, delta });
      const cutoff = now - RATE_WINDOW_MS;
      while (this.cameraDeltas.length > 0 && this.cameraDeltas[0]!.at < cutoff) this.cameraDeltas.shift();
    }
    this.lastCamera = next;
    this.hasLastCamera = true;
    this.camera = next;
    void pivot;
  }

  recordRender(input: {
    readonly now?: number;
    readonly online: boolean;
    readonly fps: number;
    readonly ticks: number;
    readonly alpha: number;
    readonly leftover?: number;
    readonly simTick?: number;
    readonly fromTick?: number;
    readonly toTick?: number;
    readonly position: MotionPose;
    readonly previous: MotionPose;
    readonly render: MotionPose;
    readonly renderPrev?: MotionPose;
    readonly renderCurr?: MotionPose;
    readonly camera?: MotionPose;
    readonly ignoreNetworkMotion?: boolean;
    readonly isolationMode?: PredIsolationMode;
    readonly ignoreNetworkSend?: boolean;
    readonly ignoreNetworkState?: boolean;
  }): void {
    const now = input.now ?? performance.now();
    this.online = input.online;
    this.fps = input.fps;
    this.ticksThisFrame = input.ticks;
    this.alpha = input.alpha;
    this.leftover = input.leftover ?? 0;
    this.simTick = input.simTick ?? 0;
    this.fromTick = input.fromTick ?? 0;
    this.toTick = input.toTick ?? 0;
    this.ignoreNetworkMotion = Boolean(input.ignoreNetworkMotion);
    this.ignoreNetworkSend = Boolean(input.ignoreNetworkSend ?? input.ignoreNetworkMotion);
    this.ignoreNetworkState = Boolean(input.ignoreNetworkState ?? input.ignoreNetworkMotion);
    this.isolationMode = input.isolationMode
      ?? (this.ignoreNetworkSend && this.ignoreNetworkState
        ? 'noNet'
        : this.ignoreNetworkState
          ? 'noState'
          : this.ignoreNetworkSend
            ? 'noSend'
            : 'normal');
    localNetTrace.beginFrame();
    const positionBefore = this.hasLastSimPosition
      ? { ...this.lastSimPosition }
      : { x: input.position.x, y: input.position.y, z: input.position.z };
    this.position = { x: input.position.x, y: input.position.y, z: input.position.z };
    this.previous = { x: input.previous.x, y: input.previous.y, z: input.previous.z };
    this.render = { x: input.render.x, y: input.render.y, z: input.render.z };
    if (input.camera) this.camera = { x: input.camera.x, y: input.camera.y, z: input.camera.z };
    prune(this.events, now);
    if (this.hasLastRender) {
      const along = input.renderCurr && input.renderPrev
        ? {
          x: input.renderCurr.x - input.renderPrev.x,
          y: 0,
          z: input.renderCurr.z - input.renderPrev.z,
        }
        : { x: this.render.x - this.lastRender.x, y: 0, z: this.render.z - this.lastRender.z };
      const len = Math.hypot(along.x, along.z);
      const dx = this.render.x - this.lastRender.x;
      const dz = this.render.z - this.lastRender.z;
      const signed = len > 1e-6 ? (dx * along.x + dz * along.z) / len : Math.hypot(dx, dz);
      this.lastRenderDelta = signed;
      this.renderDeltas.push({ at: now, delta: signed });
      const cutoff = now - RATE_WINDOW_MS;
      while (this.renderDeltas.length > 0 && this.renderDeltas[0]!.at < cutoff) this.renderDeltas.shift();
      if (signed < -1e-4) this.note('render:neg', now);
      if (Math.abs(signed) > 0.12) this.note('render:large', now);
      const moving = dist(this.position, this.previous) > 1e-3
        || Math.hypot(this.render.x - this.lastRender.x, this.render.z - this.lastRender.z) > 1e-3;
      localNetTrace.maybeCaptureFirstBad({
        now,
        renderDelta: signed,
        cameraDelta: this.lastCameraDelta,
        positionBefore,
        positionAfter: { x: input.position.x, y: input.position.y, z: input.position.z },
        renderBefore: { ...this.lastRender },
        renderAfter: { ...this.render },
        cameraBefore: this.hasLastCamera ? { ...this.previousCamera } : { ...this.camera },
        cameraAfter: { ...this.camera },
        moving: this.online && moving,
      });
    }
    this.lastRender = this.render;
    this.hasLastRender = true;
    this.lastSimPosition = { x: input.position.x, y: input.position.y, z: input.position.z };
    this.hasLastSimPosition = true;
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
    const mode = this.online
      ? formatPredIsolationMode(this.isolationMode)
      : 'singleplayer';
    const acceptMut = this.rate('accept-mutated', now);
    const deltas = this.renderDeltas.map((entry) => entry.delta);
    const minD = deltas.length ? Math.min(...deltas) : 0;
    const maxD = deltas.length ? Math.max(...deltas) : 0;
    const camDeltas = this.cameraDeltas.map((entry) => entry.delta);
    const camMax = camDeltas.length ? Math.max(...camDeltas) : 0;
    const flags = this.online
      ? ` send=${this.ignoreNetworkSend ? 'OFF' : 'on'} state=${this.ignoreNetworkState ? 'OFF' : 'on'}`
      : '';
    return [
      `Motion ${mode}${flags} fps=${this.fps} ticks=${this.ticksThisFrame} alpha=${this.alpha.toFixed(3)} acc=${this.leftover.toFixed(4)} sim#${this.simTick} ${this.fromTick}→${this.toTick}`,
      `pred/s=${this.rate('predict', now)} state/s=${this.rate('player_state', now)} rec/s=${this.rate('reconcile:accepted', now) + this.rate('reconcile:corrected', now) + this.rate('reconcile:snapped', now) + this.rate('reconcile:ignored', now)}`,
      `ok/s=${this.rate('reconcile:accepted', now)} corr/s=${this.rate('reconcile:corrected', now)} snap/s=${this.rate('reconcile:snapped', now)} dup/s=${this.rate('reject:duplicate-seq', now)}`,
      `soft speed/s=${this.rate('soft:speed', now)} onGround/s=${this.rate('soft:onGround', now)} flying/s=${this.rate('soft:flying', now)} lastSoft=${this.lastSoftReject}`,
      `net send/s=${this.rate('send:input', now)} recv/s=${this.rate('recv:player_state', now) + this.rate('recv:entity_snapshot', now) + this.rate('recv:block_update', now) + this.rate('recv:block_batch', now) + this.rate('recv:chunk_data', now) + this.rate('recv:health', now) + this.rate('recv:inventory', now)} statePkt/s=${this.rate('recv:player_state', now)}`,
      `snap recv/s=${this.rate('snap:recv', now)} dropStale/s=${this.rate('snap:drop-stale', now)} dropNoLocal/s=${this.rate('snap:drop-no-local', now)} gap/s=${this.rate('seq-gap', now)} catchUp/s=${this.rate('phys:catch-up', now)}`,
      `srv phys/s=${this.serverPhysicsTps.toFixed(1)} snapGen/s=${this.serverSnapGen.toFixed(1)} snapSent/s=${this.serverSnapSent.toFixed(1)} dropped=${this.serverDroppedTicks} lastPhysΔ=${this.lastPhysicsTicks}`,
      `loop late=${this.serverLatenessMs.toFixed(1)}ms cb=${this.serverCallbackMs.toFixed(1)}ms tickWall=${this.serverTickWallMs.toFixed(1)}ms eld mean/p95/p99/max=${this.serverEldMean.toFixed(1)}/${this.serverEldP95.toFixed(1)}/${this.serverEldP99.toFixed(1)}/${this.serverEldMax.toFixed(1)}`,
      `load ent=${this.serverEntities} blocks=${this.serverBlockChanges} chunkSend=${this.serverChunkSends} chunkGen=${this.serverChunkGens}`,
      `inGap=${this.serverInputGapMs.toFixed(0)}ms inBurst=${this.serverInputPackets}`,
      `sess socks=${this.session?.activeSockets ?? '—'} src=${this.session?.lastInputConn?.slice(0, 8) ?? '—'} snap=${this.session?.connectionId.slice(0, 8) ?? '—'} join=${this.session?.joinCount ?? '—'} resume=${this.session?.resumeCount ?? '—'} fp=${this.session?.tokenFp ?? '—'}`,
      `writes pos/s=${this.rate('write:position', now)} prev/s=${this.rate('write:previousPosition', now)} vel/s=${this.rate('write:velocity', now)} acceptMut/s=${acceptMut} netPos/s=${localNetTrace.sourceRate('write:position', now)} netVel/s=${localNetTrace.sourceRate('write:velocity', now)} netPrev/s=${localNetTrace.sourceRate('write:previousPosition', now)}`,
      `${localNetTrace.mutationSourceHud(now)} vol/s=${localNetTrace.sourceRate('world:volume', now)}`,
      `pos ${this.position.x.toFixed(3)} ${this.position.y.toFixed(3)} ${this.position.z.toFixed(3)} prev ${this.previous.x.toFixed(3)} ${this.previous.y.toFixed(3)} ${this.previous.z.toFixed(3)}`,
      `render ${this.render.x.toFixed(3)} ${this.render.y.toFixed(3)} ${this.render.z.toFixed(3)} rΔ=${this.lastRenderDelta.toFixed(4)} min=${minD.toFixed(4)} max=${maxD.toFixed(4)} neg/s=${this.rate('render:neg', now)} big/s=${this.rate('render:large', now)} |pos-prev|=${step.toFixed(4)}`,
      `cam ${this.camera.x.toFixed(3)} ${this.camera.y.toFixed(3)} ${this.camera.z.toFixed(3)} Δ=${this.lastCameraDelta.toFixed(4)} max=${camMax.toFixed(4)} src=${this.cameraSource}`,
      `since rec=${sinceReconcile.toFixed(0)}ms state=${sinceState.toFixed(0)}ms last=${this.lastKind}/${this.lastReject} soft=${this.lastSoftReject} acceptMut=${this.lastAcceptMutated ? 'YES' : 'no'}`,
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
