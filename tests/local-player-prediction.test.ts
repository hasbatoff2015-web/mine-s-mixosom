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
  createPredictionBuffer,
  isSmallPredictionError,
  predictedMoveFromInput,
  pushPredictedMove,
  reconcilePredictedPlayer,
  resetPredictionBuffer,
  shouldSnapPrediction,
} from '../src/net/localPlayerPrediction';
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
  for (let z = -6; z <= 6; z += 1) {
    for (let x = -6; x <= 6; x += 1) world.set(x, 0, z, BlockId.Stone);
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
    ...extras,
  };
}

describe('local player prediction', () => {
  it('predicts movement immediately without a snapshot', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const startX = player.position.x;
    applyPredictedTick(player, world, move(1, { forward: 1 }));
    const moved = Math.hypot(player.position.x - startX, player.position.z - 0.5);
    expect(moved).toBeGreaterThan(0.05);
    expect(player.position.y).toBeCloseTo(1, 5);
  });

  it('replays unacknowledged inputs after an authoritative correction', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const predicted = new PlayerController({ position: [0.5, 1, 0.5] });
    const authority = new PlayerController({ position: [0.5, 1, 0.5] });
    const buffer = createPredictionBuffer();
    predicted.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    authority.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const first = move(1, { forward: 1 });
    pushPredictedMove(buffer, first);
    applyPredictedTick(predicted, world, first);
    applyPredictedTick(authority, world, first);
    const ack = snapshotFrom(authority, { inputSeq: 1 });
    for (const seq of [2, 3]) {
      const step = move(seq, { forward: 1 });
      pushPredictedMove(buffer, step);
      applyPredictedTick(predicted, world, step);
    }
    const result = reconcilePredictedPlayer(predicted, world, buffer, ack);
    expect(result.replayed).toBe(2);
    for (const seq of [2, 3]) applyPredictedTick(authority, world, move(seq, { forward: 1 }));
    expect(predicted.position.x).toBeCloseTo(authority.position.x, 5);
    expect(predicted.position.y).toBeCloseTo(authority.position.y, 5);
    expect(predicted.position.z).toBeCloseTo(authority.position.z, 5);
  });

  it('keeps a jump arc instead of chasing a stale Y target', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
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
    expect(player.onGround || ys[ys.length - 1]! < peak).toBe(true);
  });

  it('replays an unacked jump instead of dropping Y to a stale snapshot', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    const grounded = snapshotFrom(player, { inputSeq: 0 });
    const jump = move(1, { jump: true });
    pushPredictedMove(buffer, jump);
    applyPredictedTick(player, world, jump);
    for (const seq of [2, 3]) {
      const step = move(seq);
      pushPredictedMove(buffer, step);
      applyPredictedTick(player, world, step);
    }
    const predictedY = player.position.y;
    expect(predictedY).toBeGreaterThan(1.3);
    const result = reconcilePredictedPlayer(player, world, buffer, grounded);
    expect(result.replayed).toBe(3);
    expect(player.position.y).toBeCloseTo(predictedY, 5);
    expect(player.position.y).toBeGreaterThan(grounded.y + 0.3);
  });

  it('does not re-trigger a jump after the server acks the jump input', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const predicted = new PlayerController({ position: [0.5, 1, 0.5] });
    const authority = new PlayerController({ position: [0.5, 1, 0.5] });
    const buffer = createPredictionBuffer();
    predicted.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    authority.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const jump = move(1, { jump: true });
    pushPredictedMove(buffer, jump);
    applyPredictedTick(predicted, world, jump);
    applyPredictedTick(authority, world, jump);
    const ack = snapshotFrom(authority, { inputSeq: 1 });
    for (const seq of [2, 3, 4]) {
      const step = move(seq);
      pushPredictedMove(buffer, step);
      applyPredictedTick(predicted, world, step);
    }
    reconcilePredictedPlayer(predicted, world, buffer, ack);
    for (const seq of [2, 3, 4]) applyPredictedTick(authority, world, move(seq));
    expect(predicted.position.y).toBeCloseTo(authority.position.y, 5);
    expect(predicted.velocity.y).toBeCloseTo(authority.velocity.y, 5);
  });

  it('lands after a jump when the floor is still there', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    player.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    applyPredictedTick(player, world, move(1, { jump: true }));
    for (let seq = 2; seq <= 24; seq += 1) {
      applyPredictedTick(player, world, move(seq));
    }
    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeCloseTo(1, 2);
  });

  it('snaps a large correction instead of approaching it', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    const buffer = createPredictionBuffer();
    const far = snapshotFrom(player, { x: 20.5, y: 1, z: 0.5, inputSeq: 0 });
    const result = reconcilePredictedPlayer(player, world, buffer, far);
    expect(result.snapped).toBe(true);
    expect(shouldSnapPrediction(result.error.distSq)).toBe(true);
    expect(player.position.x).toBeCloseTo(20.5, 5);
    expect(player.previousPosition.x).toBeCloseTo(20.5, 5);
  });

  it('does not treat a small residual as a snap', () => {
    expect(isSmallPredictionError({ xz: 0.04, y: 0.05 })).toBe(true);
    expect(shouldSnapPrediction(0.04 * 0.04)).toBe(false);
  });

  it('resets the input history on reconnect so seq 1 is accepted', () => {
    const buffer = createPredictionBuffer();
    pushPredictedMove(buffer, move(40, { forward: 1 }));
    buffer.lastAckedSeq = 40;
    resetPredictionBuffer(buffer);
    expect(buffer.pending).toHaveLength(0);
    expect(buffer.lastAckedSeq).toBe(-1);
    const clientSeq = inputSeqAfterNewClientSession() + 1;
    expect(shouldAcceptInputSequence(inputSeqAfterReconnect(), clientSeq)).toBe(true);
    pushPredictedMove(buffer, move(clientSeq, { forward: 1 }));
    expect(buffer.pending[0]?.seq).toBe(1);
  });
});
