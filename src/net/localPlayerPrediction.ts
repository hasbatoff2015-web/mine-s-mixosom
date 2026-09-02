import { FIXED_DT } from '../core/constants';
import type { MoveInput } from '../input/MoveInput';
import type { PlayerController, PlayerInputSource } from '../player/PlayerController';
import type { VoxelWorld } from '../world/World';
import type { PlayerSnapshot } from '../../shared/protocol';
import { LOCAL_SNAP_DISTANCE, distanceSquared } from './authoritativeMotion';

/** Unacked inputs kept for replay. ~1.6 s at 20 TPS. */
export const PREDICTION_HISTORY = 32;
/** Ignore residual error after replay; do not exponentially chase. */
export const PREDICTION_SMALL_ERROR = 0.08;
export const PREDICTION_SMALL_ERROR_Y = 0.16;

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

export interface PredictionBuffer {
  pending: PredictedMove[];
  lastAckedSeq: number;
}

export function createPredictionBuffer(): PredictionBuffer {
  return { pending: [], lastAckedSeq: -1 };
}

export function resetPredictionBuffer(buffer: PredictionBuffer): void {
  buffer.pending.length = 0;
  buffer.lastAckedSeq = -1;
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

export function pushPredictedMove(buffer: PredictionBuffer, move: PredictedMove): void {
  buffer.pending.push(move);
  if (buffer.pending.length > PREDICTION_HISTORY) {
    buffer.pending.splice(0, buffer.pending.length - PREDICTION_HISTORY);
  }
}

export function ackPredictedMoves(buffer: PredictionBuffer, ackSeq: number): PredictedMove[] {
  if (!Number.isFinite(ackSeq)) return buffer.pending;
  buffer.lastAckedSeq = ackSeq;
  const acked = buffer.pending.filter((move) => move.seq <= ackSeq);
  buffer.pending = buffer.pending.filter((move) => move.seq > ackSeq);
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

export function restoreAuthoritativePlayer(
  player: PlayerController,
  snapshot: Pick<PlayerSnapshot, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'onGround' | 'sneaking' | 'sprinting'>,
  ackedMove: PredictedMove | undefined,
): void {
  player.applyAuthoritativeSimulation({
    x: snapshot.x,
    y: snapshot.y,
    z: snapshot.z,
    vx: snapshot.vx,
    vy: snapshot.vy,
    vz: snapshot.vz,
    onGround: snapshot.onGround,
    sneaking: snapshot.sneaking,
    sprinting: snapshot.sprinting,
    jumpHeld: ackedMove?.jump === true,
  });
}

function copyPose(player: PlayerController): { x: number; y: number; z: number } {
  return { x: player.position.x, y: player.position.y, z: player.position.z };
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
): { xz: number; y: number; distSq: number } {
  const dx = snapshot.x - player.x;
  const dz = snapshot.z - player.z;
  return {
    xz: Math.hypot(dx, dz),
    y: Math.abs(snapshot.y - player.y),
    distSq: distanceSquared(player, snapshot),
  };
}

export function shouldSnapPrediction(distSq: number, snapDistance = LOCAL_SNAP_DISTANCE): boolean {
  return distSq >= snapDistance * snapDistance;
}

export function isSmallPredictionError(error: { readonly xz: number; readonly y: number }): boolean {
  return error.xz <= PREDICTION_SMALL_ERROR && error.y <= PREDICTION_SMALL_ERROR_Y;
}

/**
 * Rewind to the acked server pose and replay unacked inputs on the same
 * PlayerController. Does not exponentially chase X/Y/Z.
 */
export function reconcilePredictedPlayer(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  snapshot: PlayerSnapshot,
  dt = FIXED_DT,
): { snapped: boolean; replayed: number; error: { xz: number; y: number; distSq: number } } {
  const ackSeq = snapshot.inputSeq ?? buffer.lastAckedSeq;
  const before = copyPose(player);
  const visualPrev = {
    x: player.previousPosition.x,
    y: player.previousPosition.y,
    z: player.previousPosition.z,
  };
  const acked = ackPredictedMoves(buffer, ackSeq);
  const lastAcked = acked.length > 0 ? acked[acked.length - 1] : undefined;
  restoreAuthoritativePlayer(player, snapshot, lastAcked);
  replayUnackedMoves(player, world, buffer.pending, dt);
  const after = copyPose(player);
  const error = predictionError(before, after);
  const snapped = shouldSnapPrediction(error.distSq);
  const replayed = buffer.pending.length;
  if (snapped || (replayed === 0 && !isSmallPredictionError(error))) {
    player.previousPosition.copy(player.position);
  } else if (isSmallPredictionError(error)) {
    // Keep the in-flight render lerp. Do not rewind Y toward a stale ack pose.
    player.previousPosition.set(visualPrev.x, visualPrev.y, visualPrev.z);
  }
  return { snapped, replayed, error };
}
