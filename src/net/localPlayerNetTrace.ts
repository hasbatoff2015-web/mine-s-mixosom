import { CHUNK_SIZE, PLAYER_HEIGHT, PLAYER_WIDTH } from '../core/constants';
import { isDevRuntime } from './predIsolation';

type ReconcileKind = 'ignored' | 'accepted' | 'corrected' | 'snapped';
type AckRejectReason =
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

const RATE_WINDOW_MS = 1000;
const MUTATION_CAP = 64;
const WORLD_EVENT_CAP = 32;

export interface MotionFullState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly onGround: boolean;
  readonly isFlying: boolean;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
  readonly jumpHeld: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly creativeFlightAllowed: boolean;
  readonly flyWindowTicks: number;
  readonly flyIgnoreGroundTicks: number;
  readonly onLadder: boolean;
  readonly fallDistance: number;
  readonly meleeKnockback: boolean;
}

export type MotionField = keyof MotionFullState;

export interface PlayerMotionLike {
  readonly position: { x: number; y: number; z: number };
  readonly previousPosition: { x: number; y: number; z: number };
  readonly velocity: { x: number; y: number; z: number };
  readonly yaw: number;
  readonly pitch: number;
  readonly creativeFlightAllowed: boolean;
  captureMovementState(): {
    readonly onGround: boolean;
    readonly isFlying: boolean;
    readonly sneaking: boolean;
    readonly sprinting: boolean;
    readonly jumpHeld: boolean;
    readonly flyWindowTicks: number;
    readonly flyIgnoreGroundTicks: number;
    readonly onLadder: boolean;
    readonly fallDistance: number;
    readonly meleeKnockback: boolean;
  };
}

export interface LocalNetMutation {
  readonly at: number;
  readonly source: string;
  readonly frameIndex: number;
  readonly changed: readonly MotionField[];
  readonly before: MotionFullState;
  readonly after: MotionFullState;
}

export interface WorldCollisionEvent {
  readonly at: number;
  readonly source: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly inVolume: boolean;
}

export interface SnapshotAcceptTrace {
  readonly at: number;
  readonly ackSeq: number;
  readonly historySeq: number | undefined;
  readonly kind: ReconcileKind;
  readonly reject: AckRejectReason;
  readonly predicted?: MotionFullState;
  readonly authoritative: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vx: number;
    readonly vy: number;
    readonly vz: number;
    readonly onGround: boolean;
    readonly flying?: boolean;
  };
  readonly liveChanged: readonly MotionField[];
  readonly previousPositionChanged: boolean;
  readonly velocityChanged: boolean;
  readonly flyingChanged: boolean;
}

export interface InputNetTiming {
  readonly seq: number;
  readonly clientSentAt?: number;
  readonly serverRecvAt?: number;
  readonly serverSimAt?: number;
  readonly serverSentAt?: number;
  readonly clientRecvAt?: number;
}

export interface FirstBadEvent {
  readonly at: number;
  readonly frameIndex: number;
  readonly renderDelta: number;
  readonly cameraDelta: number;
  readonly positionBefore: { x: number; y: number; z: number };
  readonly positionAfter: { x: number; y: number; z: number };
  readonly renderBefore: { x: number; y: number; z: number };
  readonly renderAfter: { x: number; y: number; z: number };
  readonly cameraBefore: { x: number; y: number; z: number };
  readonly cameraAfter: { x: number; y: number; z: number };
  readonly mutations: readonly LocalNetMutation[];
  readonly worldEvents: readonly WorldCollisionEvent[];
  readonly lastPlayerStateSeq: number;
  readonly lastSentSeq: number;
  readonly lastReconcileKind: ReconcileKind;
  readonly lastReject: AckRejectReason;
  readonly lastSoftReject: AckRejectReason;
  readonly reconcileSincePrevFrame: boolean;
  readonly worldUpdateSincePrevFrame: boolean;
  readonly lastTiming?: InputNetTiming;
}

const MOTION_FIELDS: readonly MotionField[] = [
  'x', 'y', 'z', 'px', 'py', 'pz', 'vx', 'vy', 'vz',
  'onGround', 'isFlying', 'sneaking', 'sprinting', 'jumpHeld',
  'yaw', 'pitch', 'creativeFlightAllowed', 'flyWindowTicks',
  'flyIgnoreGroundTicks', 'onLadder', 'fallDistance', 'meleeKnockback',
];

export function captureMotionFull(player: PlayerMotionLike): MotionFullState {
  const state = player.captureMovementState();
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
    onGround: state.onGround,
    isFlying: state.isFlying,
    sneaking: state.sneaking,
    sprinting: state.sprinting,
    jumpHeld: state.jumpHeld,
    yaw: player.yaw,
    pitch: player.pitch,
    creativeFlightAllowed: player.creativeFlightAllowed,
    flyWindowTicks: state.flyWindowTicks,
    flyIgnoreGroundTicks: state.flyIgnoreGroundTicks,
    onLadder: state.onLadder,
    fallDistance: state.fallDistance,
    meleeKnockback: state.meleeKnockback,
  };
}

export function diffMotionFull(before: MotionFullState, after: MotionFullState): MotionField[] {
  const changed: MotionField[] = [];
  for (const field of MOTION_FIELDS) {
    if (before[field] !== after[field]) changed.push(field);
  }
  return changed;
}

export function chunkOverlapsPlayerColumn(
  player: { readonly position: { x: number; y: number; z: number } },
  cx: number,
  cz: number,
): boolean {
  const half = PLAYER_WIDTH * 0.5;
  const minX = player.position.x - half;
  const maxX = player.position.x + half;
  const minZ = player.position.z - half;
  const maxZ = player.position.z + half;
  const chunkMinX = cx * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE;
  const chunkMinZ = cz * CHUNK_SIZE;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
  return minX < chunkMaxX && maxX > chunkMinX && minZ < chunkMaxZ && maxZ > chunkMinZ;
}

export function blockOverlapsPlayerVolume(
  player: { readonly position: { x: number; y: number; z: number }; readonly sneaking?: boolean },
  x: number,
  y: number,
  z: number,
): boolean {
  const half = PLAYER_WIDTH * 0.5;
  const height = PLAYER_HEIGHT;
  const minX = player.position.x - half;
  const maxX = player.position.x + half;
  const minY = player.position.y;
  const maxY = player.position.y + height;
  const minZ = player.position.z - half;
  const maxZ = player.position.z + half;
  return minX < x + 1 && maxX > x && minY < y + 1 && maxY > y && minZ < z + 1 && maxZ > z;
}

function pruneByTime<T extends { readonly at: number }>(items: T[], now: number, cap: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  while (items.length > cap || (items.length > 0 && items[0]!.at < cutoff)) items.shift();
}

/**
 * DEV-only log of every network callback that mutates the local player, plus
 * the first visible render jump.
 */
export class LocalPlayerNetTrace {
  frameIndex = 0;
  lastSentSeq = -1;
  lastPlayerStateSeq = -1;
  lastReconcileKind: ReconcileKind = 'ignored';
  lastReject: AckRejectReason = 'none';
  lastSoftReject: AckRejectReason = 'none';
  lastTiming: InputNetTiming | undefined;
  firstBadEvent: FirstBadEvent | undefined;
  private lastReconcileAt = Number.NaN;
  private lastWorldAt = Number.NaN;
  private readonly mutations: LocalNetMutation[] = [];
  private readonly worldEvents: WorldCollisionEvent[] = [];
  private readonly sourceCounts: Array<{ at: number; source: string }> = [];
  private mutationsSinceRender: LocalNetMutation[] = [];
  private worldSinceRender: WorldCollisionEvent[] = [];
  private reconcileSinceRender = false;
  private dumpedFirstBad = false;

  reset(): void {
    this.frameIndex = 0;
    this.lastSentSeq = -1;
    this.lastPlayerStateSeq = -1;
    this.lastReconcileKind = 'ignored';
    this.lastReject = 'none';
    this.lastSoftReject = 'none';
    this.lastTiming = undefined;
    this.firstBadEvent = undefined;
    this.lastReconcileAt = Number.NaN;
    this.lastWorldAt = Number.NaN;
    this.mutations.length = 0;
    this.worldEvents.length = 0;
    this.sourceCounts.length = 0;
    this.mutationsSinceRender = [];
    this.worldSinceRender = [];
    this.reconcileSinceRender = false;
    this.dumpedFirstBad = false;
  }

  beginFrame(): void {
    this.frameIndex += 1;
  }

  noteSend(seq: number, now = performance.now()): void {
    this.lastSentSeq = seq;
    this.sourceCounts.push({ at: now, source: 'send:input' });
    pruneByTime(this.sourceCounts, now, 400);
  }

  noteRecv(kind: string, now = performance.now()): void {
    this.sourceCounts.push({ at: now, source: `recv:${kind}` });
    pruneByTime(this.sourceCounts, now, 400);
  }

  noteTiming(timing: InputNetTiming): void {
    this.lastTiming = timing;
  }

  noteReconcile(
    kind: ReconcileKind,
    reject: AckRejectReason,
    now = performance.now(),
    softReject: AckRejectReason = 'none',
  ): void {
    this.lastReconcileKind = kind;
    this.lastReject = reject;
    this.lastSoftReject = softReject;
    this.lastReconcileAt = now;
    this.reconcileSinceRender = true;
  }

  noteMutation(entry: LocalNetMutation): void {
    this.mutations.push(entry);
    this.mutationsSinceRender.push(entry);
    this.sourceCounts.push({ at: entry.at, source: `mut:${entry.source}` });
    pruneByTime(this.mutations, entry.at, MUTATION_CAP);
    pruneByTime(this.sourceCounts, entry.at, 400);
    if (entry.changed.includes('x') || entry.changed.includes('y') || entry.changed.includes('z')) {
      this.sourceCounts.push({ at: entry.at, source: 'write:position' });
    }
    if (entry.changed.includes('px') || entry.changed.includes('py') || entry.changed.includes('pz')) {
      this.sourceCounts.push({ at: entry.at, source: 'write:previousPosition' });
    }
    if (entry.changed.includes('vx') || entry.changed.includes('vy') || entry.changed.includes('vz')) {
      this.sourceCounts.push({ at: entry.at, source: 'write:velocity' });
    }
  }

  noteWorld(event: WorldCollisionEvent): void {
    this.worldEvents.push(event);
    this.worldSinceRender.push(event);
    this.lastWorldAt = event.at;
    this.sourceCounts.push({ at: event.at, source: event.inVolume ? 'world:volume' : 'world:near' });
    pruneByTime(this.worldEvents, event.at, WORLD_EVENT_CAP);
    pruneByTime(this.sourceCounts, event.at, 400);
  }

  sourceRate(source: string, now = performance.now()): number {
    const cutoff = now - RATE_WINDOW_MS;
    let count = 0;
    for (const entry of this.sourceCounts) {
      if (entry.at < cutoff) continue;
      if (entry.source === source) count += 1;
    }
    return count;
  }

  mutationSourceHud(now = performance.now()): string {
    const cutoff = now - RATE_WINDOW_MS;
    const counts = new Map<string, number>();
    for (const entry of this.sourceCounts) {
      if (entry.at < cutoff || !entry.source.startsWith('mut:')) continue;
      const key = entry.source.slice(4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size === 0) return 'mut none';
    return `mut ${[...counts.entries()].map(([name, count]) => `${name}=${count}`).join(' ')}`;
  }

  maybeCaptureFirstBad(input: {
    readonly now: number;
    readonly renderDelta: number;
    readonly cameraDelta: number;
    readonly positionBefore: { x: number; y: number; z: number };
    readonly positionAfter: { x: number; y: number; z: number };
    readonly renderBefore: { x: number; y: number; z: number };
    readonly renderAfter: { x: number; y: number; z: number };
    readonly cameraBefore: { x: number; y: number; z: number };
    readonly cameraAfter: { x: number; y: number; z: number };
    readonly moving: boolean;
  }): FirstBadEvent | undefined {
    const bad = input.renderDelta < -1e-4 || Math.abs(input.renderDelta) > 0.12;
    if (!bad || !input.moving || this.dumpedFirstBad) {
      this.mutationsSinceRender = [];
      this.worldSinceRender = [];
      this.reconcileSinceRender = false;
      return undefined;
    }
    const event: FirstBadEvent = {
      at: input.now,
      frameIndex: this.frameIndex,
      renderDelta: input.renderDelta,
      cameraDelta: input.cameraDelta,
      positionBefore: input.positionBefore,
      positionAfter: input.positionAfter,
      renderBefore: input.renderBefore,
      renderAfter: input.renderAfter,
      cameraBefore: input.cameraBefore,
      cameraAfter: input.cameraAfter,
      mutations: this.mutationsSinceRender.slice(),
      worldEvents: this.worldSinceRender.slice(),
      lastPlayerStateSeq: this.lastPlayerStateSeq,
      lastSentSeq: this.lastSentSeq,
      lastReconcileKind: this.lastReconcileKind,
      lastReject: this.lastReject,
      lastSoftReject: this.lastSoftReject,
      reconcileSincePrevFrame: this.reconcileSinceRender,
      worldUpdateSincePrevFrame: this.worldSinceRender.length > 0,
      lastTiming: this.lastTiming,
    };
    this.firstBadEvent = event;
    this.dumpedFirstBad = true;
    this.mutationsSinceRender = [];
    this.worldSinceRender = [];
    this.reconcileSinceRender = false;
    if (isDevRuntime() && typeof console !== 'undefined') {
      console.info('[firstBadEvent]', formatFirstBadEvent(event));
    }
    return event;
  }

  endRender(): void {
    this.mutationsSinceRender = [];
    this.worldSinceRender = [];
    this.reconcileSinceRender = false;
  }
}

export function formatFirstBadEvent(event: FirstBadEvent): string {
  const mut = event.mutations.length === 0
    ? 'none'
    : event.mutations.map((entry) => (
      `${entry.source}@${entry.at.toFixed(1)} [${entry.changed.join(',') || 'no-fields'}]`
    )).join('; ');
  const world = event.worldEvents.length === 0
    ? 'none'
    : event.worldEvents.map((entry) => (
      `${entry.source} ${entry.x},${entry.y},${entry.z}${entry.inVolume ? ' VOLUME' : ''}`
    )).join('; ');
  const timing = event.lastTiming
    ? ` send=${event.lastTiming.clientSentAt?.toFixed(1) ?? '—'} srvRecv=${event.lastTiming.serverRecvAt?.toFixed(1) ?? '—'} `
      + `sim=${event.lastTiming.serverSimAt?.toFixed(1) ?? '—'} srvSend=${event.lastTiming.serverSentAt?.toFixed(1) ?? '—'} `
      + `cliRecv=${event.lastTiming.clientRecvAt?.toFixed(1) ?? '—'}`
    : ' timing=—';
  return [
    `frame=${event.frameIndex} rΔ=${event.renderDelta.toFixed(4)} camΔ=${event.cameraDelta.toFixed(4)}`,
    `pos ${event.positionBefore.x.toFixed(3)},${event.positionBefore.y.toFixed(3)},${event.positionBefore.z.toFixed(3)}`
      + ` → ${event.positionAfter.x.toFixed(3)},${event.positionAfter.y.toFixed(3)},${event.positionAfter.z.toFixed(3)}`,
    `render ${event.renderBefore.x.toFixed(3)},${event.renderBefore.y.toFixed(3)},${event.renderBefore.z.toFixed(3)}`
      + ` → ${event.renderAfter.x.toFixed(3)},${event.renderAfter.y.toFixed(3)},${event.renderAfter.z.toFixed(3)}`,
    `cam ${event.cameraBefore.x.toFixed(3)},${event.cameraBefore.y.toFixed(3)},${event.cameraBefore.z.toFixed(3)}`
      + ` → ${event.cameraAfter.x.toFixed(3)},${event.cameraAfter.y.toFixed(3)},${event.cameraAfter.z.toFixed(3)}`,
    `stateSeq=${event.lastPlayerStateSeq} sentSeq=${event.lastSentSeq} reconcile=${event.lastReconcileKind}/${event.lastReject} soft=${event.lastSoftReject} ran=${event.reconcileSincePrevFrame ? 'yes' : 'no'}`,
    `world=${event.worldUpdateSincePrevFrame ? 'yes' : 'no'} ${world}`,
    `mutations ${mut}`,
    timing,
  ].join('\n');
}

export function formatMotionFieldMutation(input: {
  readonly source: string;
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly inputSeq?: number;
  readonly predictedSeq?: number;
  readonly at?: number;
}): string {
  return [
    `[${input.source}]`,
    String(input.field),
    String(input.oldValue),
    String(input.newValue),
    `snapshot inputSeq=${input.inputSeq ?? -1}`,
    `local predicted seq=${input.predictedSeq ?? -1}`,
    `timestamp=${(input.at ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())).toFixed(3)}`,
  ].join('\n');
}

/** DEV-only: print every field that changed during a local player_state apply. */
export function logMotionFieldMutations(input: {
  readonly source: string;
  readonly before: MotionFullState;
  readonly after: MotionFullState;
  readonly inputSeq?: number;
  readonly predictedSeq?: number;
  readonly at?: number;
}): MotionField[] {
  const changed = diffMotionFull(input.before, input.after);
  if (!isDevRuntime() || typeof console === 'undefined' || changed.length === 0) return changed;
  for (const field of changed) {
    console.info(formatMotionFieldMutation({
      source: input.source,
      field,
      oldValue: input.before[field],
      newValue: input.after[field],
      inputSeq: input.inputSeq,
      predictedSeq: input.predictedSeq,
      at: input.at,
    }));
  }
  return changed;
}

export function logNamedMutation(input: {
  readonly source: string;
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly inputSeq?: number;
  readonly predictedSeq?: number;
  readonly at?: number;
}): void {
  if (!isDevRuntime() || typeof console === 'undefined') return;
  if (Object.is(input.oldValue, input.newValue)) return;
  console.info(formatMotionFieldMutation(input));
}

export function traceLocalPlayerMutation(
  source: string,
  player: PlayerMotionLike,
  apply: () => void,
  frameIndex = 0,
  now = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): LocalNetMutation | undefined {
  const before = captureMotionFull(player);
  apply();
  const after = captureMotionFull(player);
  const changed = diffMotionFull(before, after);
  if (changed.length === 0) return undefined;
  return {
    at: now,
    source,
    frameIndex,
    changed,
    before,
    after,
  };
}

export const localNetTrace = new LocalPlayerNetTrace();
