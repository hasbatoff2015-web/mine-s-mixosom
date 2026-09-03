import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import {
  inputSeqAfterNewClientSession,
  inputSeqAfterReconnect,
  shouldAcceptInputSequence,
} from '../src/core/onlineSession';
import type { MoveInput } from '../src/input/MoveInput';
import {
  applyPredictedTick,
  ackPredictedMoves,
  createPredictionBuffer,
  inspectPredictedPlayer,
  isSmallPredictionError,
  predictedMoveFromInput,
  predictedStateAfterExtraTicks,
  predictLocalMove,
  reconcilePredictedPlayer,
  resetPredictionBuffer,
  shouldSnapPrediction,
  type PredictionBuffer,
} from '../src/net/localPlayerPrediction';
import { captureMotionFull, diffMotionFull } from '../src/net/localPlayerNetTrace';
import { PlayerController } from '../src/player';
import type { PlayerSnapshot } from '../shared/protocol';
import type { VoxelWorld } from '../src/world/World';

class TestWorld {
  readonly blocks = new Map<string, BlockId>();

  set(x: number, y: number, z: number, block: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, block);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return BlockId.Bedrock;
    return this.blocks.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  getBlockState(): undefined {
    return undefined;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function move(seq: number, extra: Partial<MoveInput> = {}, yaw = 0): ReturnType<typeof predictedMoveFromInput> {
  return predictedMoveFromInput(seq, { ...idle, ...extra }, { yaw, pitch: 0 }, true);
}

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -8; z <= 8; z += 1) {
    for (let x = -8; x <= 8; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function snapshotFrom(player: PlayerController, extras: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'self',
    name: 'self',
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    yaw: player.yaw,
    pitch: player.pitch,
    vx: player.velocity.x,
    vy: player.velocity.y,
    vz: player.velocity.z,
    health: 20,
    gamemode: 'survival',
    sneaking: player.sneaking,
    sprinting: player.sprinting,
    onGround: player.onGround,
    selectedSlot: 0,
    flying: player.isFlying,
    ...extras,
  };
}

function snapshotFromState(
  player: PlayerController,
  seq: number,
  buffer: PredictionBuffer,
  extras: Partial<PlayerSnapshot> = {},
): PlayerSnapshot {
  const entry = buffer.entries.find((item) => item.seq === seq);
  if (!entry) throw new Error(`missing history ${seq}`);
  return snapshotFrom(player, {
    x: entry.state.x,
    y: entry.state.y,
    z: entry.state.z,
    vx: entry.state.vx,
    vy: entry.state.vy,
    vz: entry.state.vz,
    onGround: entry.state.onGround,
    sneaking: entry.state.sneaking,
    sprinting: entry.state.sprinting,
    flying: entry.state.isFlying,
    inputSeq: seq,
    ...extras,
  });
}

function groundedPlayer(): { world: VoxelWorld; player: PlayerController; buffer: PredictionBuffer } {
  const world = flatWorld() as unknown as VoxelWorld;
  const player = new PlayerController({ position: [0.5, 1, 0.5] });
  player.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
  return { world, player, buffer: createPredictionBuffer() };
}

function poseOf(player: PlayerController) {
  return {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    vx: player.velocity.x,
    vy: player.velocity.y,
    vz: player.velocity.z,
    px: player.previousPosition.x,
    py: player.previousPosition.y,
    pz: player.previousPosition.z,
    onGround: player.onGround,
    flying: player.isFlying,
  };
}

function expectPoseUnchanged(player: PlayerController, before: ReturnType<typeof poseOf>): void {
  expect(player.position.x).toBe(before.x);
  expect(player.position.y).toBe(before.y);
  expect(player.position.z).toBe(before.z);
  expect(player.velocity.x).toBe(before.vx);
  expect(player.velocity.y).toBe(before.vy);
  expect(player.velocity.z).toBe(before.vz);
  expect(player.previousPosition.x).toBe(before.px);
  expect(player.previousPosition.y).toBe(before.py);
  expect(player.previousPosition.z).toBe(before.pz);
  expect(player.onGround).toBe(before.onGround);
  expect(player.isFlying).toBe(before.flying);
}

function predictSeries(
  player: PlayerController,
  world: VoxelWorld,
  buffer: PredictionBuffer,
  from: number,
  to: number,
  extra: Partial<MoveInput> = {},
  yaw = 0,
): void {
  for (let seq = from; seq <= to; seq += 1) {
    predictLocalMove(player, world, buffer, move(seq, extra, yaw));
  }
}

describe('local player prediction', () => {
  it('predicts movement immediately without a snapshot', () => {
    const { world, player } = groundedPlayer();
    const startX = player.position.x;
    applyPredictedTick(player, world, move(1, { forward: 1 }));
    const moved = Math.hypot(player.position.x - startX, player.position.z - 0.5);
    expect(moved).toBeGreaterThan(0.05);
    expect(player.position.y).toBeCloseTo(1, 5);
  });

  it('does not rewind when the snapshot matches the predicted state at that seq', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 4, { forward: 1 });
    const before = poseOf(player);
    const result = reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer, { inputSeq: 4 }));
    expect(result.kind).toBe('accepted');
    expect(result.replayed).toBe(0);
    expectPoseUnchanged(player, before);
    expect(buffer.lastAckedSeq).toBe(4);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual([2, 3, 4]);
  });

  it('ignores tiny floating-point error at the acked seq without touching the live pose', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 3, { forward: 1 });
    const before = poseOf(player);
    const snapshot = snapshotFromState(player, 1, buffer, { x: buffer.entries[0]!.state.x + 0.001 });
    const result = reconcilePredictedPlayer(player, world, buffer, snapshot);
    expect(result.kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('does not jitter when a matching snapshot is delayed by several predicted ticks', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(1, { forward: 1 }));
    const ack = snapshotFromState(player, 1, buffer);
    predictSeries(player, world, buffer, 2, 6, { forward: 1 });
    const before = poseOf(player);
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('accepted');
    expect(result.replayed).toBe(0);
    expect(result.acceptMutated).toBe(false);
    expectPoseUnchanged(player, before);
  });

  it('ignores a duplicate ack of the same inputSeq (server reused lastInput)', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 3, { forward: 1 });
    const ack = snapshotFromState(player, 1, buffer);
    reconcilePredictedPlayer(player, world, buffer, ack);
    const before = poseOf(player);
    const again = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(again.kind).toBe('ignored');
    expectPoseUnchanged(player, before);
  });

  it('rewinds to seq N and replays only later inputs when the acked pose is wrong', () => {
    const { world, player, buffer } = groundedPlayer();
    const authority = new PlayerController({ position: [0.5, 1, 0.5] });
    authority.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    predictLocalMove(player, world, buffer, move(1, { forward: 1 }));
    applyPredictedTick(authority, world, move(1, { forward: 1 }));
    authority.position.x += 0.4;
    const ack = snapshotFrom(authority, { inputSeq: 1 });
    predictSeries(player, world, buffer, 2, 3, { forward: 1 });
    const live = poseOf(player);
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('corrected');
    expect(result.replayed).toBe(2);
    expect(player.position.x).not.toBeCloseTo(live.x, 3);
    for (const seq of [2, 3]) applyPredictedTick(authority, world, move(seq, { forward: 1 }));
    expect(player.position.x).toBeCloseTo(authority.position.x, 5);
    expect(player.position.z).toBeCloseTo(authority.position.z, 5);
  });

  it('does not replay skipped seqs when the server coalesced to the latest input', () => {
    const { world, player, buffer } = groundedPlayer();
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    predictSeries(player, world, buffer, 1, 3, { forward: 1 });
    applyPredictedTick(server, world, move(3, { forward: 1 }));
    const live = poseOf(player);
    const result = reconcilePredictedPlayer(player, world, buffer, snapshotFrom(server, { inputSeq: 3 }));
    expect(result.kind).toBe('accepted');
    expect(result.replayed).toBe(0);
    expectPoseUnchanged(player, live);
    expect(buffer.lastAckedSeq).toBe(3);
  });

  it('keeps walking prediction stable across an ack', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 8, { forward: 1 });
    const before = poseOf(player);
    expect(Math.hypot(before.x - 0.5, before.z - 0.5)).toBeGreaterThan(0.5);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer, { inputSeq: 8 })).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps sprinting prediction stable across an ack', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 8, { forward: 1, sprint: true });
    const before = poseOf(player);
    expect(player.sprinting).toBe(true);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer, { inputSeq: 8 })).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps a jump arc instead of chasing a stale Y target', () => {
    const { world, player } = groundedPlayer();
    const ys: number[] = [player.position.y];
    applyPredictedTick(player, world, move(1, { jump: true }));
    ys.push(player.position.y);
    for (let seq = 2; seq <= 8; seq += 1) {
      applyPredictedTick(player, world, move(seq));
      ys.push(player.position.y);
    }
    const peak = Math.max(...ys);
    expect(peak).toBeGreaterThan(1.4);
    expect(ys[ys.length - 1]!).toBeLessThan(peak);
  });

  it('does not rewind Y when a delayed snapshot matches the jump seq', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    const ack = snapshotFromState(player, 1, buffer);
    predictSeries(player, world, buffer, 2, 6);
    const before = poseOf(player);
    expect(before.y).toBeGreaterThan(ack.y);
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('replays later jump ticks only when the acked jump pose is wrong', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    predictSeries(player, world, buffer, 2, 4);
    const before = poseOf(player);
    const ack = snapshotFromState(player, 1, buffer, { y: buffer.entries[0]!.state.y + 0.2, vy: 4 });
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('corrected');
    expect(result.replayed).toBe(3);
    expect(player.position.y).not.toBeCloseTo(before.y, 3);
  });

  it('does not re-trigger a jump after the server acks the jump input', () => {
    const { world, player, buffer } = groundedPlayer();
    const authority = new PlayerController({ position: [0.5, 1, 0.5] });
    authority.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    applyPredictedTick(authority, world, move(1, { jump: true }));
    const ack = snapshotFrom(authority, { inputSeq: 1 });
    predictSeries(player, world, buffer, 2, 4);
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('accepted');
    for (const seq of [2, 3, 4]) applyPredictedTick(authority, world, move(seq));
    expect(player.position.y).toBeCloseTo(authority.position.y, 5);
    expect(player.velocity.y).toBeCloseTo(authority.velocity.y, 5);
  });

  it('lands after a jump when the floor is still there', () => {
    const { world, player } = groundedPlayer();
    applyPredictedTick(player, world, move(1, { jump: true }));
    for (let seq = 2; seq <= 24; seq += 1) applyPredictedTick(player, world, move(seq));
    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeCloseTo(1, 2);
  });

  it('keeps repeated jumps stable when snapshots match history', () => {
    const { world, player, buffer } = groundedPlayer();
    let seq = 1;
    for (let hop = 0; hop < 2; hop += 1) {
      predictLocalMove(player, world, buffer, move(seq, { jump: true }));
      seq += 1;
      for (let i = 0; i < 18; i += 1) {
        predictLocalMove(player, world, buffer, move(seq));
        seq += 1;
      }
    }
    const before = poseOf(player);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer)).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps falling prediction stable across an ack', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 8, 0.5] });
    const buffer = createPredictionBuffer();
    predictSeries(player, world, buffer, 1, 6);
    const before = poseOf(player);
    expect(before.y).toBeLessThan(8);
    expect(player.onGround).toBe(false);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer)).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps creative flight ascent stable across an ack', () => {
    const { world, player, buffer } = groundedPlayer();
    player.creativeFlightAllowed = true;
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    predictLocalMove(player, world, buffer, move(2));
    predictLocalMove(player, world, buffer, move(3, { jump: true }));
    expect(player.isFlying).toBe(true);
    predictSeries(player, world, buffer, 4, 8, { jump: true });
    const before = poseOf(player);
    expect(before.y).toBeGreaterThan(1.2);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer)).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps flying forward + SHIFT descent stable across an ack', () => {
    const { world, player, buffer } = groundedPlayer();
    player.creativeFlightAllowed = true;
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    predictLocalMove(player, world, buffer, move(2));
    predictLocalMove(player, world, buffer, move(3, { jump: true }));
    predictSeries(player, world, buffer, 4, 6, { jump: true });
    predictSeries(player, world, buffer, 7, 12, { forward: 1, sneak: true, descend: true });
    const before = poseOf(player);
    expect(player.isFlying).toBe(true);
    expect(before.y).toBeGreaterThan(1);
    const result = reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer));
    expect(result.kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('keeps fast direction changes stable across an ack', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 3, { forward: 1 }, 0);
    predictSeries(player, world, buffer, 4, 6, { forward: 1 }, Math.PI / 2);
    const before = poseOf(player);
    expect(reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer)).kind).toBe('accepted');
    expectPoseUnchanged(player, before);
  });

  it('accepted reconciliation does not write live pose or previousPosition', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(1, { forward: 1 }));
    const before = poseOf(player);
    const result = reconcilePredictedPlayer(player, world, buffer, snapshotFromState(player, 1, buffer));
    expect(result.kind).toBe('accepted');
    expect(result.acceptMutated).toBe(false);
    expect(result.rejectReason).toBe('none');
    expectPoseUnchanged(player, before);
  });

  it('small lockstep correction keeps previousPosition for render lerp', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(1, { forward: 1 }));
    const prev = {
      x: player.previousPosition.x,
      y: player.previousPosition.y,
      z: player.previousPosition.z,
    };
    const ack = snapshotFromState(player, 1, buffer, { x: player.position.x + 0.2 });
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('corrected');
    expect(result.replayed).toBe(0);
    expect(player.position.x).toBeCloseTo(ack.x, 5);
    expect(player.previousPosition.x).toBeCloseTo(prev.x, 5);
    expect(player.previousPosition.y).toBeCloseTo(prev.y, 5);
    expect(player.previousPosition.z).toBeCloseTo(prev.z, 5);
    expect(Math.hypot(
      player.position.x - player.previousPosition.x,
      player.position.z - player.previousPosition.z,
    )).toBeGreaterThan(0.05);
  });

  it('snaps a large correction instead of approaching it', () => {
    const { world, player, buffer } = groundedPlayer();
    const far = snapshotFrom(player, { x: 20.5, y: 1, z: 0.5, inputSeq: 0 });
    const result = reconcilePredictedPlayer(player, world, buffer, far);
    expect(result.kind).toBe('snapped');
    expect(result.snapped).toBe(true);
    expect(shouldSnapPrediction(result.error.distSq)).toBe(true);
    expect(player.position.x).toBeCloseTo(20.5, 5);
    expect(player.previousPosition.x).toBeCloseTo(20.5, 5);
  });

  it('does not treat a small residual as a snap', () => {
    expect(isSmallPredictionError({ xz: 0.02, y: 0.03 })).toBe(true);
    expect(shouldSnapPrediction(0.04 * 0.04)).toBe(false);
  });

  it('resets the input history on reconnect so seq 1 is accepted', () => {
    const { world, player, buffer } = groundedPlayer();
    predictLocalMove(player, world, buffer, move(40, { forward: 1 }));
    buffer.lastAckedSeq = 40;
    resetPredictionBuffer(buffer);
    expect(buffer.entries).toHaveLength(0);
    expect(buffer.lastAckedSeq).toBe(-1);
    const clientSeq = inputSeqAfterNewClientSession() + 1;
    expect(shouldAcceptInputSequence(inputSeqAfterReconnect(), clientSeq)).toBe(true);
    predictLocalMove(player, world, buffer, move(clientSeq, { forward: 1 }));
    expect(buffer.entries[0]?.seq).toBe(1);
  });

  it('accepts a matching pose even when snapshot velocity disagrees (fly+SHIFT vy)', () => {
    const { world, player, buffer } = groundedPlayer();
    player.creativeFlightAllowed = true;
    predictLocalMove(player, world, buffer, move(1, { jump: true }));
    predictLocalMove(player, world, buffer, move(2));
    predictLocalMove(player, world, buffer, move(3, { jump: true }));
    predictSeries(player, world, buffer, 4, 6, { jump: true });
    predictSeries(player, world, buffer, 7, 12, { forward: 1, sneak: true, descend: true });
    expect(player.isFlying).toBe(true);
    const before = poseOf(player);
    const full = captureMotionFull(player);
    const prior = buffer.entries.find((entry) => entry.seq === 7)!.state;
    buffer.lastAckedState = prior;
    const ack = snapshotFromState(player, 8, buffer, { vy: buffer.entries.find((e) => e.seq === 8)!.state.vy + 7.5 });
    const inspect = inspectPredictedPlayer(buffer, ack, player);
    expect(inspect.kind).toBe('accepted');
    expect(inspect.softReject).toBe('speed');
    expect(inspect.rejectReason).toBe('none');
    expect(diffMotionFull(full, captureMotionFull(player))).toEqual([]);
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('accepted');
    expect(result.softReject).toBe('speed');
    expect(result.acceptMutated).toBe(false);
    expectPoseUnchanged(player, before);
    expect(player.velocity.y).toBe(before.vy);
    expect(player.isFlying).toBe(true);
  });

  it('accepts a matching pose even when snapshot flying/onGround flags disagree', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 4, { forward: 1 });
    const before = poseOf(player);
    const ack = snapshotFromState(player, 1, buffer, { flying: true, onGround: false, inputSeq: 4 });
    const inspect = inspectPredictedPlayer(buffer, ack, player, { world });
    expect(inspect.kind).toBe('accepted');
    expect(inspect.softReject).toBe('onGround');
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('accepted');
    expect(result.acceptMutated).toBe(false);
    expectPoseUnchanged(player, before);
    expect(player.onGround).toBe(before.onGround);
    expect(player.isFlying).toBe(before.flying);
  });

  it('still rewinds when xz disagrees beyond PREDICTION_ACCEPT_XZ', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 3, { forward: 1 });
    const live = poseOf(player);
    const ack = snapshotFromState(player, 1, buffer, { x: buffer.entries[0]!.state.x + 0.2 });
    const result = reconcilePredictedPlayer(player, world, buffer, ack);
    expect(result.kind).toBe('corrected');
    expect(result.rejectReason).toBe('xz');
    expect(player.position.x).not.toBeCloseTo(live.x, 3);
  });

  it('inspectPredictedPlayer does not mutate the player or history', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 4, { forward: 1 });
    const before = captureMotionFull(player);
    const seqs = buffer.entries.map((entry) => entry.seq);
    const lastAcked = buffer.lastAckedSeq;
    inspectPredictedPlayer(buffer, snapshotFromState(player, 2, buffer, { vy: 99 }), player);
    expect(diffMotionFull(before, captureMotionFull(player))).toEqual([]);
    expect(buffer.lastAckedSeq).toBe(lastAcked);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual(seqs);
  });

  it('treats a 2-tick catch-up snapshot as comparable to history[N] plus one extra tick of N', () => {
    const { world, player, buffer } = groundedPlayer();
    predictSeries(player, world, buffer, 1, 6, { forward: 1 });
    const pose2 = buffer.entries.find((item) => item.seq === 2)!.state;
    ackPredictedMoves(buffer, 2);
    buffer.lastAckedState = pose2;
    const entry = buffer.entries.find((item) => item.seq === 3)!;
    const coalesced = predictedStateAfterExtraTicks(world, entry, 1);
    const before = poseOf(player);
    const twoTickSnap = snapshotFromState(player, 3, buffer, {
      x: coalesced.x,
      y: coalesced.y,
      z: coalesced.z,
      vx: coalesced.vx,
      vy: coalesced.vy,
      vz: coalesced.vz,
      onGround: coalesced.onGround,
      flying: coalesced.isFlying,
      inputSeq: 3,
    });
    const asOneTick = inspectPredictedPlayer(buffer, twoTickSnap, player, { world, physicsTicks: 1 });
    expect(asOneTick.kind).toBe('corrected');
    expect(asOneTick.rejectReason).toBe('xz');
    expect(['x', 'z']).toContain(asOneTick.firstDiff);
    const asCatchUp = inspectPredictedPlayer(buffer, twoTickSnap, player, { world, physicsTicks: 2 });
    expect(asCatchUp.kind).toBe('accepted');
    expect(asCatchUp.comparePath).toBe('checkpoint');
    expect(asCatchUp.simTicks).toBe(2);
    const result = reconcilePredictedPlayer(player, world, buffer, twoTickSnap, FIXED_DT, { physicsTicks: 2 });
    expect(result.kind).toBe('accepted');
    expect(result.acceptMutated).toBe(false);
    expectPoseUnchanged(player, before);
  });

  it('accepts seqGap=2 physicsTicks=1 when the checkpoint is one latest-input tick (owner dump 545)', () => {
    const { world, player, buffer } = groundedPlayer();
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    for (let seq = 1; seq <= 3; seq += 1) {
      predictLocalMove(player, world, buffer, move(seq, { forward: 1 }));
      applyPredictedTick(server, world, move(seq, { forward: 1 }));
      expect(reconcilePredictedPlayer(player, world, buffer, snapshotFrom(server, { inputSeq: seq })).kind).toBe('accepted');
    }

    predictLocalMove(player, world, buffer, move(4, { forward: 1 }));
    predictLocalMove(player, world, buffer, move(5, { forward: 1 }));
    applyPredictedTick(server, world, move(5, { forward: 1 }));
    const live = poseOf(player);
    const snapshot = snapshotFrom(server, { inputSeq: 5 });
    const inspect = inspectPredictedPlayer(buffer, snapshot, player, { world, physicsTicks: 1 });
    expect(inspect.seqGap).toBe(2);
    expect(inspect.physicsTicks).toBe(1);
    expect(inspect.simTicks).toBe(1);
    expect(inspect.comparePath).toBe('checkpoint');
    expect(inspect.kind).toBe('accepted');
    expect(inspect.predicted).toBeDefined();
    expect(Math.hypot(inspect.predicted!.x - snapshot.x, inspect.predicted!.z - snapshot.z))
      .toBeGreaterThan(0.12);
    const result = reconcilePredictedPlayer(player, world, buffer, snapshot, FIXED_DT, { physicsTicks: 1 });
    expect(result.kind).toBe('accepted');
    expectPoseUnchanged(player, live);
  });
});
