import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  applyPredictedTick,
  copyPredictionControllerConfig,
  createPredictionBuffer,
  discardCompactedPrediction,
  predictLocalMove,
  predictedMoveFromInput,
  reconcilePredictedPlayer,
  resetPredictionBuffer,
  seedPredictionCheckpoint,
} from '../src/net/localPlayerPrediction';
import { captureMotionFull, diffMotionFull } from '../src/net/localPlayerNetTrace';
import { resyncLocalPlayerAfterHiddenTab } from '../src/net/hiddenTabMotion';
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
  getBlockState(): undefined { return undefined; }
  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -16; z <= 16; z += 1) {
    for (let x = -16; x <= 16; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

function move(seq: number, extra: Partial<MoveInput> = {}) {
  return predictedMoveFromInput(seq, { ...idle, ...extra }, { yaw: 0, pitch: 0 }, true);
}

function snapshotFrom(player: PlayerController, seq: number, extras: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
    inputSeq: seq,
    ackCommandSeq: seq,
    ...extras,
  };
}

function assertLiveEqualsCheckpointPlusPending(
  player: PlayerController,
  buffer: ReturnType<typeof createPredictionBuffer>,
  world: VoxelWorld,
): void {
  expect(buffer.lastAckedState).toBeTruthy();
  const scratch = new PlayerController({ position: [0.5, 1, 0.5] });
  copyPredictionControllerConfig(player, scratch);
  scratch.applyMovementState(buffer.lastAckedState!);
  for (const entry of buffer.entries) applyPredictedTick(scratch, world, entry.input, FIXED_DT);
  expect(player.position.distanceTo(scratch.position)).toBeLessThan(1e-4);
  expect(Math.abs(player.velocity.x - scratch.velocity.x)).toBeLessThan(1e-3);
  expect(Math.abs(player.velocity.y - scratch.velocity.y)).toBeLessThan(1e-3);
  expect(player.onGround).toBe(scratch.onGround);
  expect(player.isFlying).toBe(scratch.isFlying);
}

describe('prediction live-state invariant', () => {
  it('accepted ACK leaves live pose equal to checkpoint plus truly pending commands', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    for (let seq = 1; seq <= 6; seq += 1) {
      predictLocalMove(client, world, buffer, move(seq, { forward: 1 }));
    }
    applyPredictedTick(server, world, move(1, { forward: 1 }));
    const before = captureMotionFull(client);
    const result = reconcilePredictedPlayer(client, world, buffer, snapshotFrom(server, 1), FIXED_DT, {
      serverTick: 1,
    });
    expect(result.kind).toBe('accepted');
    expect(diffMotionFull(before, captureMotionFull(client))).toEqual([]);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5, 6]);
    assertLiveEqualsCheckpointPlusPending(client, buffer, world);
  });

  it('correction restores the checkpoint and replays only remaining pending commands', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    predictLocalMove(client, world, buffer, move(1, { forward: 1 }));
    predictLocalMove(client, world, buffer, move(2, { forward: 1 }));
    applyPredictedTick(server, world, move(1, { right: 1 }));
    const result = reconcilePredictedPlayer(client, world, buffer, snapshotFrom(server, 1), FIXED_DT, {
      serverTick: 1,
    });
    expect(result.kind === 'corrected' || result.kind === 'snapped').toBe(true);
    assertLiveEqualsCheckpointPlusPending(client, buffer, world);
  });

  it.each([0, 2, 4] as const)('FIFO burst of %s extra pending commands still satisfies the invariant after ACK', (extra) => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const total = 1 + extra;
    for (let seq = 1; seq <= total; seq += 1) {
      predictLocalMove(client, world, buffer, move(seq, { forward: 1 }));
    }
    applyPredictedTick(server, world, move(1, { forward: 1 }));
    const before = captureMotionFull(client);
    const result = reconcilePredictedPlayer(client, world, buffer, snapshotFrom(server, 1), FIXED_DT, {
      serverTick: 1,
    });
    expect(result.kind).toBe('accepted');
    expect(diffMotionFull(before, captureMotionFull(client))).toEqual([]);
    assertLiveEqualsCheckpointPlusPending(client, buffer, world);
  });

  it('queue compaction rebuilds live state from checkpoint plus remaining commands', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    for (let seq = 1; seq <= 6; seq += 1) {
      predictLocalMove(client, world, buffer, move(seq, { forward: 1 }));
    }
    discardCompactedPrediction(buffer, 1, 4, client, world, FIXED_DT);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual([5, 6]);
    assertLiveEqualsCheckpointPlusPending(client, buffer, world);
  });

  it('hidden-tab resync snaps to the snapshot so pending is empty', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [8.5, 1, 8.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    predictLocalMove(client, world, buffer, move(1, { forward: 1 }));
    const snap = snapshotFrom(server, 40);
    resetPredictionBuffer(buffer);
    resyncLocalPlayerAfterHiddenTab({
      player: client,
      buffer,
      snapshot: snap,
      inputSeq: 40,
      serverTick: 40,
    });
    expect(buffer.entries).toHaveLength(0);
    expect(Math.hypot(client.position.x - snap.x, client.position.z - snap.z)).toBeLessThan(1e-4);
  });
});
