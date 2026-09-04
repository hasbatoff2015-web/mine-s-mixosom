import { getBlockDefinition } from '../blocks';
import { CHUNK_SIZE, FIXED_DT, PLAYER_WIDTH, chunkKey, floorDiv } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import { PlayerController, type PlayerInputSource, type PlayerMovementState } from '../player/PlayerController';
import { creativeFlightAllowedForPrediction } from '../player/creativeFlight';
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
  logCorrectionDiag,
  sampleCollisionHint,
} from './correctionDiagnostics';

/** Unacked predicted ticks. 3.2 s at 20 TPS. */
export const PREDICTION_HISTORY = 64;
/**
 * Simulation-equivalent ACK. Not a visual "looks small enough" fudge.
 * Larger pose slop hid timeline bugs as fake accepts.
 */
export const PREDICTION_EQUIV_XZ = 1e-4;
export const PREDICTION_EQUIV_Y = 1e-4;
export const PREDICTION_EQUIV_SPEED = 1e-3;
/** @deprecated Use PREDICTION_EQUIV_XZ. Same numeric value; not a visual slop. */
export const PREDICTION_ACCEPT_XZ = PREDICTION_EQUIV_XZ;
/** @deprecated Use PREDICTION_EQUIV_Y. */
export const PREDICTION_ACCEPT_Y = PREDICTION_EQUIV_Y;
export const PREDICTION_ACCEPT_SPEED = PREDICTION_EQUIV_SPEED;
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
  /** Client physics tick that produced this pose. Not inputSeq. */
  readonly predTick: number;
  readonly input: PredictedMove;
  preState?: PlayerMovementState;
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
  /** Latest movement-state packet the server has used. Not a physics tick id. */
  lastAckedSeq: number;
  /** Authoritative server `tickNumber` of the last accepted snapshot. */
  lastAckedServerTick: number;
  lastAckedPredTick: number;
  nextPredTick: number;
  lastAckedState: PlayerMovementState | null;
  lastAckedInput: PredictedMove | null;
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
  readonly comparable?: PlayerMovementState;
  readonly physicsTicks: number;
  readonly extraTicks: number;
  readonly comparePath: SnapshotComparePath;
  readonly seqGap: number;
  readonly simTicks: number;
  readonly serverTick?: number;
  readonly firstDiff?: string;
  readonly rawFirstDiff?: string;
  readonly flight?: PredictionFlightTrace;
}

/** Values at the inspect/correction tick. Proves fly permission vs isFlying. */
export interface PredictionFlightTrace {
  readonly localAllowed: boolean;
  readonly scratchAllowed: boolean;
  readonly checkpointFlying: boolean | undefined;
  readonly predictedFlying: boolean | undefined;
  readonly snapshotFlying: boolean | undefined;
  readonly snapshotGamemode: string | undefined;
}

export type SnapshotComparePath = 'checkpoint' | 'history[N]' | 'history[N]+extra' | 'live' | 'none';

/**
 * Extra latest-input ticks onto history[N] for the **fallback** compare path
 * when no checkpoint origin exists. Live reconcile uses checkpoint + simTicks
 * and does not consult this formula.
 *
 * physicsTicks=1, seqGap=1 → 0 (compare history[N] exactly)
 * physicsTicks=2, seqGap=1 → 1 (history[N] plus one more tick of the same input)
 * physicsTicks=1, seqGap=2 → 0 (do NOT invent ticks; two client seqs vs one server tick)
 */
export function comparableExtraTicks(physicsTicks: number, seqGap: number): number {
  const ticks = Math.max(1, Math.floor(physicsTicks));
  return Math.max(0, ticks - seqGap);
}

export function snapshotComparePath(extraTicks: number, hasHistory: boolean): SnapshotComparePath {
  if (!hasHistory) return 'live';
  return extraTicks > 0 ? 'history[N]+extra' : 'history[N]';
}

export interface ReconcileOptions {
  readonly physicsTicks?: number;
  readonly serverTick?: number;
}

export const CHECKPOINT_EXTRA_ASSIGN_SITE =
  'inspectPredictedPlayer: extraTicks = simTicks = simulationTicksFromServerTick(lastAckedServerTick, serverTick, physicsTicks)';

export function extraAssignSite(comparePath: SnapshotComparePath): string {
  if (comparePath === 'checkpoint') return CHECKPOINT_EXTRA_ASSIGN_SITE;
  if (comparePath === 'history[N]+extra' || comparePath === 'history[N]') {
    return 'inspectPredictedPlayer fallback: extraTicks = comparableExtraTicks(physicsTicks, seqGap)';
  }
  if (comparePath === 'live') return 'inspectPredictedPlayer no-history: extraTicks = simTicks';
  return 'inspectPredictedPlayer ignored: extraTicks = 0';
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
  return {
    entries: [],
    lastAckedSeq: -1,
    lastAckedServerTick: -1,
    lastAckedPredTick: 0,
    nextPredTick: 0,
    lastAckedState: null,
    lastAckedInput: null,
    debug: createPredictionDebug(),
  };
}

export function resetPredictionBuffer(buffer: PredictionBuffer): void {
  buffer.entries.length = 0;
  buffer.lastAckedSeq = -1;
  buffer.lastAckedServerTick = -1;
  buffer.lastAckedPredTick = 0;
  buffer.nextPredTick = 0;
  buffer.lastAckedState = null;
  buffer.lastAckedInput = null;
  buffer.debug = createPredictionDebug();
}

export function cloneMovementState(state: PlayerMovementState): PlayerMovementState {
  return { ...state };
}

export function seedPredictionCheckpoint(
  buffer: PredictionBuffer,
  state: PlayerMovementState,
  serverTick = -1,
  input?: PredictedMove,
): void {
  buffer.lastAckedState = cloneMovementState(state);
  buffer.lastAckedServerTick = serverTick;
  buffer.lastAckedPredTick = buffer.nextPredTick;
  if (input) buffer.lastAckedInput = input;
}

export function overwriteLatestSlot<T>(current: T | undefined, next: T): { value: T; overwritten: boolean } {
  return { value: next, overwritten: current !== undefined };
}

/**
 * How many latest-input physics ticks the snapshot advanced since the last
 * accepted server tick. `inputSeq` is not used.
 *
 * Unknown/unseeded server tick → trust `physicsTicks` on the packet.
 * Known tick → the delta is the checkpoint size (covers queued snapshots).
 */
export function simulationTicksFromServerTick(
  lastAckedServerTick: number,
  serverTick: number | undefined,
  physicsTicks: number,
): number {
  const packetTicks = Math.max(1, Math.floor(physicsTicks));
  if (serverTick === undefined || !Number.isFinite(serverTick) || lastAckedServerTick < 0) {
    return packetTicks;
  }
  return Math.max(0, Math.floor(serverTick) - lastAckedServerTick);
}

/**
 * Movement state does not include Creative Flight permission. Scratch
 * controllers default to `creativeFlightAllowed=false`, which clears
 * `isFlying` on the first tick and applies gravity.
 */
export function copyPredictionControllerConfig(
  from: PlayerController,
  to: PlayerController,
): void {
  to.creativeFlightAllowed = from.creativeFlightAllowed;
}

function createPredictionScratch(
  origin: PlayerMovementState,
  input: { readonly yaw: number; readonly pitch: number },
  creativeFlightAllowed: boolean,
): PlayerController {
  const scratch = new PlayerController({
    position: [origin.x, origin.y, origin.z],
    yaw: input.yaw,
    pitch: input.pitch,
  });
  scratch.applyMovementState(origin);
  scratch.yaw = input.yaw;
  scratch.pitch = input.pitch;
  scratch.creativeFlightAllowed = creativeFlightAllowed;
  return scratch;
}

export function predictedStateFromCheckpoint(
  world: VoxelWorld,
  origin: PlayerMovementState,
  input: PredictedMove,
  ticks: number,
  options?: { readonly creativeFlightAllowed?: boolean; readonly dt?: number },
): PlayerMovementState {
  if (ticks <= 0) return cloneMovementState(origin);
  const dt = options?.dt ?? FIXED_DT;
  const scratch = createPredictionScratch(origin, input, options?.creativeFlightAllowed === true);
  for (let i = 0; i < ticks; i += 1) applyPredictedTick(scratch, world, input, dt);
  return scratch.captureMovementState();
}

export function consumeAckedCommands(buffer: PredictionBuffer, ackSeq: number): void {
  if (!Number.isFinite(ackSeq)) return;
  const kept: PredictionHistoryEntry[] = [];
  let lastRemoved: PredictionHistoryEntry | undefined;
  for (const entry of buffer.entries) {
    if (entry.seq <= ackSeq) lastRemoved = entry;
    else kept.push(entry);
  }
  if (lastRemoved) buffer.lastAckedPredTick = lastRemoved.predTick;
  buffer.entries = kept;
}

export function consumeOldestPredTicks(buffer: PredictionBuffer, count: number): void {
  const n = Math.max(0, Math.min(Math.floor(count), buffer.entries.length));
  if (n === 0) return;
  buffer.lastAckedPredTick = buffer.entries[n - 1]!.predTick;
  buffer.entries.splice(0, n);
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

/**
 * Server compacted continuous-state commands. Those seqs will never be ACKed.
 * Rebuild live pose from the last checkpoint plus remaining pending commands.
 */
export function discardCompactedPrediction(
  buffer: PredictionBuffer,
  fromCommandSeq: number,
  toCommandSeq: number,
  player?: PlayerController,
  world?: VoxelWorld,
  dt = FIXED_DT,
): number {
  const before = buffer.entries.length;
  buffer.entries = buffer.entries.filter(
    (entry) => entry.seq < fromCommandSeq || entry.seq > toCommandSeq,
  );
  const dropped = before - buffer.entries.length;
  if (dropped > 0 && player && world && buffer.lastAckedState) {
    player.applyMovementState(buffer.lastAckedState);
    for (const entry of buffer.entries) {
      applyPredictedTick(player, world, entry.input, dt);
      entry.state = player.captureMovementState();
    }
  }
  buffer.debug.pending = buffer.entries.length;
  return dropped;
}

function trimHistory(buffer: PredictionBuffer): void {
  if (buffer.entries.length > PREDICTION_HISTORY) {
    buffer.entries.splice(0, buffer.entries.length - PREDICTION_HISTORY);
  }
}

export function pushPredictedMove(buffer: PredictionBuffer, move: PredictedMove): void {
  buffer.nextPredTick += 1;
  buffer.entries.push({
    seq: move.seq,
    predTick: buffer.nextPredTick,
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
  preState?: PlayerMovementState,
): void {
  const existing = findPredictedEntry(buffer, move.seq);
  if (existing) {
    existing.state = state;
    if (preState) existing.preState = preState;
    return;
  }
  buffer.nextPredTick += 1;
  buffer.entries.push({
    seq: move.seq,
    predTick: buffer.nextPredTick,
    input: move,
    preState,
    state,
  });
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
  if (!buffer.lastAckedState) {
    seedPredictionCheckpoint(buffer, player.captureMovementState(), buffer.lastAckedServerTick);
  }
  const preState = player.captureMovementState();
  applyPredictedTick(player, world, move, dt);
  motionProbe.notePredictionTick();
  const state = player.captureMovementState();
  recordPredictedState(buffer, move, state, preState);
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
  return error.xz <= PREDICTION_EQUIV_XZ
    && error.y <= PREDICTION_EQUIV_Y
    && (error.speed ?? 0) <= PREDICTION_EQUIV_SPEED;
}

export function ackRejectReason(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): AckRejectReason {
  if (error.xz > PREDICTION_EQUIV_XZ) return 'xz';
  if (error.y > PREDICTION_EQUIV_Y) return 'y';
  if (error.speed > PREDICTION_EQUIV_SPEED) return 'speed';
  if (predicted.onGround !== snapshot.onGround) return 'onGround';
  if (snapshot.flying !== undefined && predicted.isFlying !== snapshot.flying) return 'flying';
  return 'none';
}

/**
 * Kept for HUD. Live reconcile treats flag/speed disagreement as a real mismatch.
 */
export function softAckRejectReason(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
  error: PredictionError,
): AckRejectReason {
  return ackRejectReason(predicted, snapshot, error);
}

export function firstDivergedMovementField(
  predicted: PlayerMovementState,
  snapshot: PlayerSnapshot,
): string | undefined {
  if (Math.abs(predicted.x - snapshot.x) > 1e-9) return 'x';
  if (Math.abs(predicted.y - snapshot.y) > 1e-9) return 'y';
  if (Math.abs(predicted.z - snapshot.z) > 1e-9) return 'z';
  if (Math.abs(predicted.vx - snapshot.vx) > 1e-9) return 'vx';
  if (Math.abs(predicted.vy - snapshot.vy) > 1e-9) return 'vy';
  if (Math.abs(predicted.vz - snapshot.vz) > 1e-9) return 'vz';
  if (predicted.onGround !== snapshot.onGround) return 'onGround';
  if (predicted.sneaking !== snapshot.sneaking) return 'sneaking';
  if (predicted.sprinting !== snapshot.sprinting) return 'sprinting';
  if (snapshot.flying !== undefined && predicted.isFlying !== snapshot.flying) return 'flying';
  return undefined;
}

/**
 * Server catch-up applies the same latest input for K physics ticks. Client
 * history[N] is the pose after ONE tick of that seq. Replay the extra K-1
 * ticks on a scratch controller so the snapshot is comparable.
 */
export function predictedStateAfterExtraTicks(
  world: VoxelWorld,
  entry: PredictionHistoryEntry,
  extraTicks: number,
  options?: { readonly creativeFlightAllowed?: boolean; readonly dt?: number },
): PlayerMovementState {
  if (extraTicks <= 0) return entry.state;
  const dt = options?.dt ?? FIXED_DT;
  const scratch = createPredictionScratch(entry.state, entry.input, options?.creativeFlightAllowed === true);
  for (let i = 0; i < extraTicks; i += 1) applyPredictedTick(scratch, world, entry.input, dt);
  return scratch.captureMovementState();
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
    `Pred ${debug.lastKind} cmd=${debug.lastAckSeq} pend=${debug.pending} `
    + `errXZ=${debug.lastErrorDist.toFixed(3)} errY=${debug.lastErrorY.toFixed(3)} `
    + `corr/s=${corrected.length} avg=${avg.toFixed(3)} max=${debug.maxCorrection.toFixed(3)} `
    + `ok=${debug.accepts} fix=${debug.corrections} snap=${debug.snaps} replayed=${debug.lastKind === 'corrected' ? 'yes' : 'no'}`
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
 * Compare the snapshot to the predicted post-state of `ackCommandSeq`.
 * ACK names a command, not a reconstructed extra-tick checkpoint.
 */
export function inspectPredictedPlayer(
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  player?: PlayerController,
  options?: {
    readonly world?: VoxelWorld;
    readonly physicsTicks?: number;
    readonly serverTick?: number;
    readonly dt?: number;
  },
): SnapshotInspect {
  if (snapshot.queueCompacted) {
    discardCompactedPrediction(
      buffer,
      snapshot.queueCompacted.fromCommandSeq,
      snapshot.queueCompacted.toCommandSeq,
      player,
      options?.world,
      options?.dt,
    );
  }
  const physicsTicks = Math.max(1, Math.floor(options?.physicsTicks ?? 1));
  const serverTick = options?.serverTick;
  const ackSeq = snapshot.ackCommandSeq ?? snapshot.inputSeq;
  const seqGap = ackSeq !== undefined && Number.isFinite(ackSeq) ? ackSeq - buffer.lastAckedSeq : 0;
  const simTicks = simulationTicksFromServerTick(buffer.lastAckedServerTick, serverTick, physicsTicks);
  const base = {
    physicsTicks, extraTicks: 0, seqGap, simTicks, serverTick,
  };

  if (ackSeq === undefined || !Number.isFinite(ackSeq)) {
    return {
      kind: 'ignored', rejectReason: 'no-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: undefined, comparePath: 'none', ...base, extraTicks: 0, simTicks: 0,
    };
  }

  if (serverTick !== undefined && Number.isFinite(serverTick) && buffer.lastAckedServerTick >= 0) {
    if (serverTick < buffer.lastAckedServerTick) {
      return {
        kind: 'ignored', rejectReason: 'stale-seq', softReject: 'none',
        error: emptyError(), ackSeq, historySeq: undefined, comparePath: 'none', ...base, extraTicks: 0, simTicks: 0,
      };
    }
    if (serverTick === buffer.lastAckedServerTick) {
      return {
        kind: 'ignored', rejectReason: 'duplicate-seq', softReject: 'none',
        error: emptyError(), ackSeq, historySeq: ackSeq, comparePath: 'none', ...base, extraTicks: 0, simTicks: 0, seqGap: 0,
      };
    }
  } else if (ackSeq < buffer.lastAckedSeq) {
    return {
      kind: 'ignored', rejectReason: 'stale-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: undefined, comparePath: 'none', ...base, extraTicks: 0, simTicks: 0,
    };
  } else if (ackSeq === buffer.lastAckedSeq) {
    return {
      kind: 'ignored', rejectReason: 'duplicate-seq', softReject: 'none',
      error: emptyError(), ackSeq, historySeq: ackSeq, comparePath: 'none', ...base, extraTicks: 0, simTicks: 0, seqGap: 0,
    };
  }

  motionProbe.noteSeqGap(seqGap);
  const predictedAtAck = findPredictedEntry(buffer, ackSeq);
  const origin = buffer.lastAckedState;
  const scratchAllowed = creativeFlightAllowedForPrediction(player, snapshot.gamemode);
  const flight = (comparableFlying: boolean | undefined): PredictionFlightTrace => ({
    localAllowed: player?.creativeFlightAllowed === true,
    scratchAllowed,
    checkpointFlying: origin?.isFlying,
    predictedFlying: comparableFlying ?? predictedAtAck?.state.isFlying,
    snapshotFlying: snapshot.flying,
    snapshotGamemode: snapshot.gamemode,
  });

  if (predictedAtAck) {
    const comparable = predictedAtAck.state;
    const error = predictedStateError(comparable, snapshot);
    const reject = ackRejectReason(comparable, snapshot, error);
    const firstDiff = firstDivergedMovementField(comparable, snapshot);
    const result = {
      rejectReason: reject, softReject: reject, error,
      ackSeq, historySeq: predictedAtAck.seq, predicted: predictedAtAck.state,
      comparable, physicsTicks, extraTicks: 0, comparePath: 'history[N]' as const,
      seqGap, simTicks, serverTick, firstDiff, rawFirstDiff: firstDiff,
      flight: flight(comparable.isFlying),
    };
    if (reject === 'none') return { kind: 'accepted', ...result };
    return { kind: shouldSnapPrediction(error.distSq) ? 'snapped' : 'corrected', ...result };
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
    physicsTicks,
    extraTicks: 0,
    comparePath: 'live',
    seqGap,
    simTicks,
    serverTick,
    flight: flight(undefined),
  };
}

export function reconcilePredictedPlayer(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  dt = FIXED_DT,
  options?: ReconcileOptions,
): ReconcileResult {
  const before = captureMotionFull(player);
  const inspect = inspectPredictedPlayer(buffer, snapshot, player, {
    world,
    physicsTicks: options?.physicsTicks,
    serverTick: options?.serverTick,
    dt,
  });
  if (inspect.kind === 'accepted' || inspect.kind === 'ignored') {
    if (inspect.kind === 'accepted' && inspect.ackSeq !== undefined) {
      commitPredictionCheckpoint(buffer, snapshot, inspect, player, options);
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
    inspect,
    options,
  );
}

function commitPredictionCheckpoint(
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  inspect: SnapshotInspect,
  player: PlayerController,
  options?: ReconcileOptions,
): void {
  const input = inspect.ackSeq !== undefined
    ? findPredictedEntry(buffer, inspect.ackSeq)?.input ?? buffer.lastAckedInput
    : buffer.lastAckedInput;
  buffer.lastAckedSeq = inspect.ackSeq ?? buffer.lastAckedSeq;
  if (options?.serverTick !== undefined && Number.isFinite(options.serverTick)) {
    buffer.lastAckedServerTick = options.serverTick;
  } else if (inspect.serverTick !== undefined && Number.isFinite(inspect.serverTick)) {
    buffer.lastAckedServerTick = inspect.serverTick;
  } else if (buffer.lastAckedServerTick < 0) {
    buffer.lastAckedServerTick = 0;
  } else {
    buffer.lastAckedServerTick += Math.max(1, inspect.simTicks);
  }
  if (input) buffer.lastAckedInput = input;
  if (inspect.kind === 'accepted' && inspect.comparable) {
    buffer.lastAckedState = cloneMovementState(inspect.comparable);
  } else {
    buffer.lastAckedState = movementStateFromSnapshot(snapshot, inspect.comparable, player);
  }
  if (inspect.ackSeq !== undefined) consumeAckedCommands(buffer, inspect.ackSeq);
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
  inspect?: SnapshotInspect,
  options?: ReconcileOptions,
): ReconcileResult {
  const sample = motionProbe.sampleWorldHint?.();
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const histPose = inspect?.predicted ?? predictedAtAck?.state;
  const collisionPose = histPose ?? {
    x: player.position.x, y: player.position.y, z: player.position.z,
  };
  const cx = floorDiv(Math.floor(collisionPose.x), CHUNK_SIZE);
  const cz = floorDiv(Math.floor(collisionPose.z), CHUNK_SIZE);
  const collision = sampleCollisionHint(
    (x, y, z) => ({ name: getBlockDefinition(world.getBlock(x, y, z, false)).name }),
    collisionPose,
    {
      yaw: predictedAtAck?.input.yaw,
      width: PLAYER_WIDTH,
      height: player.height,
      chunkLoaded: world.chunks?.has(chunkKey(cx, cz)),
      mutationMarks: 'mutationMarks' in world ? world.mutationMarks : undefined,
    },
  );
  const diag = buildCorrectionDiag({
    snapshot,
    buffer,
    predicted: inspect?.predicted ?? predictedAtAck?.state,
    predictedInput: predictedAtAck?.input,
    player,
    error,
    reject: rejectReason,
    serverTick: inspect?.serverTick ?? motionProbe.inboundTick,
    lastStateTick: motionProbe.lastStateTick,
    physicsTicks: inspect?.physicsTicks,
    extraTicks: inspect?.extraTicks,
    simTicks: inspect?.simTicks,
    extraAssignSite: extraAssignSite(inspect?.comparePath ?? 'none'),
    pendingOverwrites: motionProbe.pendingSnapshotOverwrites,
    comparePath: inspect?.comparePath,
    seqGap: inspect?.seqGap,
    history: inspect?.predicted ?? predictedAtAck?.state,
    comparable: inspect?.comparable ?? predictedAtAck?.state,
    rawFirstDiff: inspect?.rawFirstDiff,
    physicsTicksThisLoop: motionProbe.lastPhysicsTicks,
    timing: {
      clientSentAt: snapshot.netTiming?.clientSentAt,
      serverRecvAt: snapshot.netTiming?.serverRecvAt,
      serverSimAt: snapshot.netTiming?.serverSimAt,
      serverSendAt: snapshot.netTiming?.serverSentAt,
      clientRecvAt: Number.isFinite(motionProbe.lastPlayerStateAt) ? motionProbe.lastPlayerStateAt : undefined,
      applyAt: now,
    },
    firstDiff: inspect?.firstDiff,
    flight: inspect?.flight,
    world: {
      feetBlock: collision.feetBlock ?? sample?.feetBlock ?? '—',
      belowBlock: collision.belowBlock ?? sample?.belowBlock ?? '—',
      aheadBlock: collision.aheadBlock ?? sample?.aheadBlock ?? '—',
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
      aabbBlocks: collision.aabbBlocks ?? sample?.aabbBlocks,
      chunkKey: collision.chunkKey ?? sample?.chunkKey,
      chunkLoaded: collision.chunkLoaded ?? sample?.chunkLoaded,
      mutationMarks: collision.mutationMarks ?? sample?.mutationMarks,
      visibility: sample?.visibility,
    },
  });
  logCorrectionDiag(diag);
  const snapped = shouldSnapPrediction(error.distSq);
  restoreAuthoritativePlayer(player, snapshot, predictedAtAck?.state);
  motionProbe.noteWrite('position');
  motionProbe.noteWrite('velocity');
  if (inspect) commitPredictionCheckpoint(buffer, snapshot, inspect, player, options);
  else ackPredictedMoves(buffer, snapshot.ackCommandSeq ?? snapshot.inputSeq ?? buffer.lastAckedSeq);
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
