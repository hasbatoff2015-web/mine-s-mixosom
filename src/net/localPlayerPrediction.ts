import { FIXED_DT } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import type { PlayerController, PlayerInputSource, PlayerMovementState } from '../player/PlayerController';
import type { VoxelWorld } from '../world/World';
import type { PlayerSnapshot } from '../../shared/protocol';
import { LOCAL_SNAP_DISTANCE, distanceSquared } from './authoritativeMotion';

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
}

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

export function isAcceptableAckError(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): boolean {
  if (!isSmallPredictionError(error)) return false;
  if (predicted.onGround !== snapshot.onGround) return false;
  if (snapshot.flying !== undefined && predicted.isFlying !== snapshot.flying) return false;
  return true;
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
): ReconcileResult {
  noteDebug(buffer, kind, error, performance.now());
  return { kind, snapped: kind === 'snapped', replayed, error };
}

/**
 * Compare the snapshot to the predicted pose AT the acked seq. If they agree,
 * leave the live player (including previousPosition) untouched.
 *
 * `inputSeq` is the last input the server used for that one physics tick.
 * Intermediate seqs overwritten before the tick were not simulated. Duplicate
 * acks (same seq as lastAckedSeq) mean the server ticked again with the same
 * lastInput — do not rewind the already-acked pose.
 */
export function reconcilePredictedPlayer(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  dt = FIXED_DT,
): ReconcileResult {
  const ackSeq = snapshot.inputSeq;
  if (ackSeq === undefined || !Number.isFinite(ackSeq)) {
    return finish(buffer, 'ignored', emptyError(), 0);
  }
  if (ackSeq < buffer.lastAckedSeq) {
    return finish(buffer, 'ignored', emptyError(), 0);
  }
  if (ackSeq === buffer.lastAckedSeq) {
    return finish(buffer, 'ignored', emptyError(), 0);
  }

  const predictedAtAck = findPredictedEntry(buffer, ackSeq);
  if (predictedAtAck) {
    const error = predictedStateError(predictedAtAck.state, snapshot);
    if (isAcceptableAckError(predictedAtAck.state, snapshot, error)) {
      ackPredictedMoves(buffer, ackSeq);
      return finish(buffer, 'accepted', error, 0);
    }
    return applyCorrection(player, world, buffer, snapshot, predictedAtAck.state, error, dt);
  }

  const error = predictionError(
    { x: player.position.x, y: player.position.y, z: player.position.z },
    snapshot,
  );
  return applyCorrection(player, world, buffer, snapshot, undefined, error, dt);
}

function applyCorrection(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  predictedAtAck: PlayerMovementState | undefined,
  error: PredictionError,
  dt: number,
): ReconcileResult {
  const ackSeq = snapshot.inputSeq ?? buffer.lastAckedSeq;
  const snapped = shouldSnapPrediction(error.distSq);
  restoreAuthoritativePlayer(player, snapshot, predictedAtAck);
  ackPredictedMoves(buffer, ackSeq);
  for (const entry of buffer.entries) {
    applyPredictedTick(player, world, entry.input, dt);
    entry.state = player.captureMovementState();
  }
  if (snapped || buffer.entries.length === 0) {
    player.previousPosition.copy(player.position);
  }
  return finish(buffer, snapped ? 'snapped' : 'corrected', error, buffer.entries.length);
}
