import { FIXED_DT } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import type { PlayerController, PlayerInputSource, PlayerMovementState } from '../player/PlayerController';
import type { VoxelWorld } from '../world/World';
import type { PlayerSnapshot } from '../../shared/protocol';
import { LOCAL_SNAP_DISTANCE, distanceSquared } from './authoritativeMotion';
import {
  motionProbe,
  type AckRejectReason,
} from './localMotionDiagnostics';
import {
  captureMotionFull,
  diffMotionFull,
} from './localPlayerNetTrace';
import {
  buildCorrectionDiag,
  isCorrDiagQueryEnabled,
  logCorrectionDiag,
} from './correctionDiagnostics';

/** Unacked predicted ticks. 3.2 s at 20 TPS. */
export const PREDICTION_HISTORY = 64;
/**
 * Accept the local predicted pose at ack seq when the server agrees this
 * closely. Must stay below a visible step; rewind is for real mismatches only.
 */
export const PREDICTION_ACCEPT_XZ = 0.03;
export const PREDICTION_ACCEPT_Y = 0.05;
export const PREDICTION_ACCEPT_SPEED = 0.2;
/** @deprecated Use PREDICTION_ACCEPT_XZ. Kept for existing tests. */
export const PREDICTION_SMALL_ERROR = PREDICTION_ACCEPT_XZ;
/** @deprecated Use PREDICTION_ACCEPT_Y. */
export const PREDICTION_SMALL_ERROR_Y = PREDICTION_ACCEPT_Y;

const DEBUG_WINDOW_MS = 1000;

export type ReconcileKind = 'ignored' | 'accepted' | 'corrected' | 'snapped';

export interface PredictedMove {
  readonly seq: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly sprint: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly locomotion: boolean;
}

export interface PredictionHistoryEntry {
  readonly seq: number;
  readonly input: PredictedMove;
  state: PlayerMovementState;
}

export interface PredictionDebug {
  lastKind: ReconcileKind;
  lastErrorDist: number;
  lastErrorY: number;
  lastAckSeq: number;
  pending: number;
  accepts: number;
  corrections: number;
  snaps: number;
  ignored: number;
  correctionSum: number;
  maxCorrection: number;
  readonly samples: Array<{ at: number; kind: ReconcileKind; dist: number }>;
}

export interface PredictionBuffer {
  entries: PredictionHistoryEntry[];
  lastAckedSeq: number;
  debug: PredictionDebug;
}

export interface PredictionError {
  xz: number;
  y: number;
  speed: number;
  distSq: number;
}

export interface ReconcileResult {
  kind: ReconcileKind;
  snapped: boolean;
  replayed: number;
  error: PredictionError;
  rejectReason: AckRejectReason;
  acceptMutated: boolean;
  softReject: AckRejectReason;
}

export interface SnapshotInspect {
  readonly kind: ReconcileKind;
  readonly rejectReason: AckRejectReason;
  readonly softReject: AckRejectReason;
  readonly error: PredictionError;
  readonly ackSeq: number | undefined;
  readonly historySeq: number | undefined;
  readonly predicted?: PlayerMovementState;
}

export type { AckRejectReason } from './localMotionDiagnostics';

export function createPredictionDebug(): PredictionDebug {
  return {
    lastKind: 'ignored',
    lastErrorDist: 0,
    lastErrorY: 0,
    lastAckSeq: -1,
    pending: 0,
    accepts: 0,
    corrections: 0,
    snaps: 0,
    ignored: 0,
    correctionSum: 0,
    maxCorrection: 0,
    samples: [],
  };
}

export function createPredictionBuffer(): PredictionBuffer {
  return { entries: [], lastAckedSeq: -1, debug: createPredictionDebug() };
}

export function resetPredictionBuffer(buffer: PredictionBuffer): void {
  buffer.entries.length = 0;
  buffer.lastAckedSeq = -1;
  buffer.debug = createPredictionDebug();
}

export function predictedMoveFromInput(
  seq: number,
  movement: MoveInput,
  look: { readonly yaw: number; readonly pitch: number },
  locomotion: boolean,
): PredictedMove {
  return {
    seq,
    forward: movement.forward,
    right: movement.right,
    jump: movement.jump,
    sneak: movement.sneak,
    sprint: movement.sprint,
    descend: movement.descend === true,
    flySprint: movement.flySprint === true,
    yaw: look.yaw,
    pitch: look.pitch,
    locomotion,
  };
}

export function predictedPlayerInput(move: PredictedMove): PlayerInputSource {
  return {
    yaw: move.yaw,
    pitch: move.pitch,
    locomotion: move.locomotion,
    movement: () => ({
      forward: move.forward,
      right: move.right,
      jump: move.jump,
      sneak: move.sneak,
      sprint: move.sprint,
      descend: move.descend,
      flySprint: move.flySprint,
    }),
  };
}

export function findPredictedEntry(
  buffer: PredictionBuffer,
  seq: number,
): PredictionHistoryEntry | undefined {
  return buffer.entries.find((entry) => entry.seq === seq);
}

function trimHistory(buffer: PredictionBuffer): void {
  if (buffer.entries.length > PREDICTION_HISTORY) {
    buffer.entries.splice(0, buffer.entries.length - PREDICTION_HISTORY);
  }
}

export function pushPredictedMove(buffer: PredictionBuffer, move: PredictedMove): void {
  buffer.entries.push({
    seq: move.seq,
    input: move,
    state: {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      onGround: false, sneaking: false, sprinting: false, jumpHeld: false,
      isFlying: false, flyWindowTicks: 0, flyIgnoreGroundTicks: 0,
      onLadder: false, fallDistance: 0, meleeKnockback: false,
    },
  });
  trimHistory(buffer);
}

export function recordPredictedState(
  buffer: PredictionBuffer,
  move: PredictedMove,
  state: PlayerMovementState,
): void {
  const existing = findPredictedEntry(buffer, move.seq);
  if (existing) {
    existing.state = state;
    return;
  }
  buffer.entries.push({ seq: move.seq, input: move, state });
  trimHistory(buffer);
}

export function ackPredictedMoves(buffer: PredictionBuffer, ackSeq: number): PredictedMove[] {
  if (!Number.isFinite(ackSeq)) return buffer.entries.map((entry) => entry.input);
  buffer.lastAckedSeq = ackSeq;
  const acked = buffer.entries.filter((entry) => entry.seq <= ackSeq).map((entry) => entry.input);
  buffer.entries = buffer.entries.filter((entry) => entry.seq > ackSeq);
  return acked;
}

export function applyPredictedTick(
  player: PlayerController,
  world: VoxelWorld,
  move: PredictedMove,
  dt = FIXED_DT,
): void {
  player.tick(world, predictedPlayerInput(move), dt);
}

/** Simulate one local tick and store the resulting movement state at `move.seq`. */
export function predictLocalMove(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  move: PredictedMove,
  dt = FIXED_DT,
): PlayerMovementState {
  applyPredictedTick(player, world, move, dt);
  motionProbe.notePredictionTick();
  const state = player.captureMovementState();
  recordPredictedState(buffer, move, state);
  return state;
}

export function restoreAuthoritativePlayer(
  player: PlayerController,
  snapshot: PlayerSnapshot,
  predictedAtAck: PlayerMovementState | undefined,
): void {
  player.applyMovementState(movementStateFromSnapshot(snapshot, predictedAtAck, player));
}

export function replayUnackedMoves(
  player: PlayerController,
  world: VoxelWorld,
  pending: readonly PredictedMove[],
  dt = FIXED_DT,
): void {
  for (const move of pending) applyPredictedTick(player, world, move, dt);
}

export function predictionError(
  player: { readonly x: number; readonly y: number; readonly z: number },
  snapshot: { readonly x: number; readonly y: number; readonly z: number },
): PredictionError {
  const dx = snapshot.x - player.x;
  const dy = snapshot.y - player.y;
  const dz = snapshot.z - player.z;
  return {
    xz: Math.hypot(dx, dz),
    y: Math.abs(dy),
    speed: 0,
    distSq: distanceSquared(player, snapshot),
  };
}

export function predictedStateError(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
): PredictionError {
  const dx = snapshot.x - predicted.x;
  const dy = snapshot.y - predicted.y;
  const dz = snapshot.z - predicted.z;
  const dvx = snapshot.vx - predicted.vx;
  const dvy = snapshot.vy - predicted.vy;
  const dvz = snapshot.vz - predicted.vz;
  return {
    xz: Math.hypot(dx, dz),
    y: Math.abs(dy),
    speed: Math.hypot(dvx, dvy, dvz),
    distSq: dx * dx + dy * dy + dz * dz,
  };
}

export function shouldSnapPrediction(distSq: number, snapDistance = LOCAL_SNAP_DISTANCE): boolean {
  return distSq >= snapDistance * snapDistance;
}

export function isSmallPredictionError(error: { readonly xz: number; readonly y: number; readonly speed?: number }): boolean {
  return error.xz <= PREDICTION_ACCEPT_XZ
    && error.y <= PREDICTION_ACCEPT_Y
    && (error.speed ?? 0) <= PREDICTION_ACCEPT_SPEED;
}

export function ackRejectReason(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): AckRejectReason {
  if (error.xz > PREDICTION_ACCEPT_XZ) return 'xz';
  if (error.y > PREDICTION_ACCEPT_Y) return 'y';
  return 'none';
}

/**
 * Velocity/flag disagreement with a matching pose. These used to rewind+replay
 * every snapshot (fly+SHIFT `vy` ≈ 7.5, so 0.2 speed is ~3%). Pose-only accept
 * keeps the predicted player invisible; a later xz/y miss still corrects.
 */
export function softAckRejectReason(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): AckRejectReason {
  if (error.speed > PREDICTION_ACCEPT_SPEED) return 'speed';
  if (predicted.onGround !== snapshot.onGround) return 'onGround';
  if (snapshot.flying !== undefined && predicted.isFlying !== snapshot.flying) return 'flying';
  return 'none';
}

export function isAcceptableAckError(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): boolean {
  return ackRejectReason(predicted, snapshot, error) === 'none';
}

function movementStateFromSnapshot(
  snapshot: PlayerSnapshot,
  predictedAtAck: PlayerMovementState | undefined,
  player: PlayerController,
): PlayerMovementState {
  const current = player.captureMovementState();
  const base = predictedAtAck ?? current;
  return {
    x: snapshot.x,
    y: snapshot.y,
    z: snapshot.z,
    vx: snapshot.vx,
    vy: snapshot.vy,
    vz: snapshot.vz,
    onGround: snapshot.onGround,
    sneaking: snapshot.sneaking,
    sprinting: snapshot.sprinting,
    jumpHeld: predictedAtAck?.jumpHeld ?? current.jumpHeld,
    isFlying: snapshot.flying ?? base.isFlying,
    flyWindowTicks: base.flyWindowTicks,
    flyIgnoreGroundTicks: base.flyIgnoreGroundTicks,
    onLadder: base.onLadder,
    fallDistance: base.fallDistance,
    meleeKnockback: false,
  };
}

function emptyError(): PredictionError {
  return { xz: 0, y: 0, speed: 0, distSq: 0 };
}

function noteDebug(buffer: PredictionBuffer, kind: ReconcileKind, error: PredictionError, now: number): void {
  const debug = buffer.debug;
  debug.lastKind = kind;
  debug.lastErrorDist = Math.sqrt(error.distSq);
  debug.lastErrorY = error.y;
  debug.lastAckSeq = buffer.lastAckedSeq;
  debug.pending = buffer.entries.length;
  debug.samples.push({ at: now, kind, dist: debug.lastErrorDist });
  const cutoff = now - DEBUG_WINDOW_MS;
  while (debug.samples.length > 0 && debug.samples[0]!.at < cutoff) debug.samples.shift();
  if (kind === 'accepted') debug.accepts += 1;
  else if (kind === 'corrected') {
    debug.corrections += 1;
    debug.correctionSum += debug.lastErrorDist;
    debug.maxCorrection = Math.max(debug.maxCorrection, debug.lastErrorDist);
  } else if (kind === 'snapped') {
    debug.snaps += 1;
    debug.correctionSum += debug.lastErrorDist;
    debug.maxCorrection = Math.max(debug.maxCorrection, debug.lastErrorDist);
  } else debug.ignored += 1;
}

export function formatPredictionDebug(debug: PredictionDebug, now = performance.now()): string {
  const cutoff = now - DEBUG_WINDOW_MS;
  const window = debug.samples.filter((sample) => sample.at >= cutoff);
  const corrected = window.filter((sample) => sample.kind === 'corrected' || sample.kind === 'snapped');
  const avg = corrected.length === 0
    ? 0
    : corrected.reduce((sum, sample) => sum + sample.dist, 0) / corrected.length;
  return (
    `Pred ${debug.lastKind} ack=${debug.lastAckSeq} pend=${debug.pending} `
    + `err=${debug.lastErrorDist.toFixed(3)} y=${debug.lastErrorY.toFixed(3)} `
    + `corr/s=${corrected.length} avg=${avg.toFixed(3)} max=${debug.maxCorrection.toFixed(3)} `
    + `ok=${debug.accepts} fix=${debug.corrections} snap=${debug.snaps}`
  );
}

function finish(
  buffer: PredictionBuffer,
  kind: ReconcileKind,
  error: PredictionError,
  replayed: number,
  rejectReason: AckRejectReason = 'none',
  acceptMutated = false,
  softReject: AckRejectReason = 'none',
): ReconcileResult {
  noteDebug(buffer, kind, error, performance.now());
  const result: ReconcileResult = {
    kind,
    snapped: kind === 'snapped',
    replayed,
    error,
    rejectReason,
    acceptMutated,
    softReject,
  };
  motionProbe.noteReconcile(result);
  return result;
}

/**
 * Compare the snapshot to the predicted pose AT the acked seq. Does not mutate
 * the player, history, or lastAckedSeq.
 */
export function inspectPredictedPlayer(
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  player?: PlayerController,
): SnapshotInspect {
  const ackSeq = snapshot.inputSeq;
  if (ackSeq === undefined || !Number.isFinite(ackSeq)) {
    return {
      kind: 'ignored', rejectReason: 'no-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: undefined,
    };
  }
  if (ackSeq < buffer.lastAckedSeq) {
    return {
      kind: 'ignored', rejectReason: 'stale-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: undefined,
    };
  }
  if (ackSeq === buffer.lastAckedSeq) {
    return {
      kind: 'ignored', rejectReason: 'duplicate-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: ackSeq,
    };
  }
  motionProbe.noteSeqGap(ackSeq - buffer.lastAckedSeq);
  const predictedAtAck = findPredictedEntry(buffer, ackSeq);
  if (predictedAtAck) {
    const error = predictedStateError(predictedAtAck.state, snapshot);
    const reject = ackRejectReason(predictedAtAck.state, snapshot, error);
    const soft = softAckRejectReason(predictedAtAck.state, snapshot, error);
    if (reject === 'none') {
      return {
        kind: 'accepted', rejectReason: 'none', softReject: soft, error,
        ackSeq, historySeq: predictedAtAck.seq, predicted: predictedAtAck.state,
      };
    }
    return {
      kind: shouldSnapPrediction(error.distSq) ? 'snapped' : 'corrected',
      rejectReason: reject, softReject: soft, error,
      ackSeq, historySeq: predictedAtAck.seq, predicted: predictedAtAck.state,
    };
  }
  const error = player
    ? predictionError({ x: player.position.x, y: player.position.y, z: player.position.z }, snapshot)
    : emptyError();
  return {
    kind: shouldSnapPrediction(error.distSq) ? 'snapped' : 'corrected',
    rejectReason: 'no-history',
    softReject: 'none',
    error,
    ackSeq,
    historySeq: undefined,
  };
}

export function reconcilePredictedPlayer(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  dt = FIXED_DT,
): ReconcileResult {
  const before = captureMotionFull(player);
  const inspect = inspectPredictedPlayer(buffer, snapshot, player);
  if (inspect.kind === 'accepted' || inspect.kind === 'ignored') {
    if (inspect.kind === 'accepted' && inspect.ackSeq !== undefined) {
      ackPredictedMoves(buffer, inspect.ackSeq);
    }
    const changed = diffMotionFull(before, captureMotionFull(player));
    const mutated = changed.length > 0;
    if (inspect.kind === 'accepted') {
      if (mutated) {
        motionProbe.note('accept-mutated');
        motionProbe.noteWrite('position');
        motionProbe.noteWrite('previousPosition');
        motionProbe.noteWrite('velocity');
      } else {
        motionProbe.note('accept-invisible');
      }
    }
    return finish(buffer, inspect.kind, inspect.error, 0, inspect.rejectReason, mutated, inspect.softReject);
  }

  return applyCorrection(
    player,
    world,
    buffer,
    snapshot,
    inspect.historySeq !== undefined ? findPredictedEntry(buffer, inspect.historySeq) : undefined,
    inspect.error,
    dt,
    inspect.rejectReason,
  );
}

function applyCorrection(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  predictedAtAck: PredictionHistoryEntry | undefined,
  error: PredictionError,
  dt: number,
  rejectReason: AckRejectReason,
): ReconcileResult {
  if (isCorrDiagQueryEnabled()) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const sample = motionProbe.sampleWorldHint?.();
    const diag = buildCorrectionDiag({
      snapshot,
      buffer,
      predicted: predictedAtAck?.state,
      predictedInput: predictedAtAck?.input,
      player,
      error,
      reject: rejectReason,
      serverTick: motionProbe.inboundTick,
      lastStateTick: motionProbe.lastStateTick,
      world: {
        feetBlock: sample?.feetBlock ?? '—',
        belowBlock: sample?.belowBlock ?? '—',
        aheadBlock: sample?.aheadBlock ?? '—',
        msSinceBlockMutation: Number.isFinite(motionProbe.lastBlockMutationAt)
          ? now - motionProbe.lastBlockMutationAt : -1,
        msSinceChunkUpdate: Number.isFinite(motionProbe.lastChunkUpdateAt)
          ? now - motionProbe.lastChunkUpdateAt : -1,
        ticksThisFrame: motionProbe.ticksThisFrame,
        onGroundBefore: player.onGround,
        onGroundAfterPredicted: predictedAtAck?.state.onGround ?? player.onGround,
        jump: predictedAtAck?.input.jump === true,
        flyingToggle: predictedAtAck
          ? predictedAtAck.state.isFlying !== (snapshot.flying ?? predictedAtAck.state.isFlying)
          : false,
        descend: predictedAtAck?.input.descend === true,
      },
    });
    logCorrectionDiag(diag);
  }
  const ackSeq = snapshot.inputSeq ?? buffer.lastAckedSeq;
  const snapped = shouldSnapPrediction(error.distSq);
  restoreAuthoritativePlayer(player, snapshot, predictedAtAck?.state);
  motionProbe.noteWrite('position');
  motionProbe.noteWrite('velocity');
  ackPredictedMoves(buffer, ackSeq);
  for (const entry of buffer.entries) {
    applyPredictedTick(player, world, entry.input, dt);
    motionProbe.notePredictionTick();
    entry.state = player.captureMovementState();
  }
  // Only a true teleport may collapse the render lerp window. Empty pending
  // used to copy previousPosition = position every lockstep correction, which
  // made online movement step at player_state rate even for tiny errors.
  if (snapped) {
    player.previousPosition.copy(player.position);
    motionProbe.noteWrite('previousPosition');
  }
  return finish(buffer, snapped ? 'snapped' : 'corrected', error, buffer.entries.length, rejectReason);
}
