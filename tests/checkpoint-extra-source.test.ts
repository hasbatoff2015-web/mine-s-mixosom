import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  inspectPredictedPlayer,
  predictedMoveFromInput,
  predictLocalMove,
  seedPredictionCheckpoint,
  simulationTicksFromServerTick,
  createPredictionBuffer,
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
const walk: MoveInput = { forward: 1, right: 0, jump: false, sprint: false, sneak: false };

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -8; z <= 8; z += 1) {
    for (let x = -8; x <= 8; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function snapshotOf(player: PlayerController, seq: number, extras: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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

function move(seq: number, extra: Partial<MoveInput> = {}) {
  return predictedMoveFromInput(seq, { ...idle, ...extra }, { yaw: 0, pitch: 0 }, true);
}

describe('FIFO ACK maps to history[ackCommandSeq], not checkpoint extraTicks', () => {
  it('serverTick delta still measures catch-up extras, but inspect no longer replays them', () => {
    expect(simulationTicksFromServerTick(13771, 13774, 1)).toBe(3);
  });

  it('lockstep walk snapshots compare history[N] with extraTicks=0', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 100);
    buffer.lastAckedSeq = 10;

    const source = { yaw: 0, pitch: 0, locomotion: true, movement: () => walk };
    for (let seq = 11; seq <= 13; seq += 1) {
      predictLocalMove(client, world, buffer, move(seq, walk));
      server.tick(world, source, FIXED_DT);
      const inspect = inspectPredictedPlayer(buffer, snapshotOf(server, seq), client, {
        world,
        physicsTicks: 1,
        serverTick: 90 + seq,
      });
      expect(inspect.comparePath).toBe('history[N]');
      expect(inspect.extraTicks).toBe(0);
      expect(inspect.kind).toBe('accepted');
    }
  });

  it('ACK of seq 11 while client already predicted 13 does not mutate live pose on accept', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 100);

    predictLocalMove(client, world, buffer, move(11, walk));
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => walk }, FIXED_DT);
    const ackSnap = snapshotOf(server, 11);
    predictLocalMove(client, world, buffer, move(12, walk));
    predictLocalMove(client, world, buffer, move(13, walk));

    const live = {
      x: client.position.x,
      y: client.position.y,
      z: client.position.z,
      vx: client.velocity.x,
      vy: client.velocity.y,
      vz: client.velocity.z,
    };
    const inspect = inspectPredictedPlayer(buffer, ackSnap, client, {
      world,
      physicsTicks: 1,
      serverTick: 101,
    });
    expect(inspect.comparePath).toBe('history[N]');
    expect(inspect.kind).toBe('accepted');
    expect(client.position.x).toBe(live.x);
    expect(client.position.y).toBe(live.y);
    expect(client.position.z).toBe(live.z);
    expect(client.velocity.x).toBe(live.vx);
    expect(client.velocity.y).toBe(live.vy);
    expect(client.velocity.z).toBe(live.vz);
  });

  it('real mismatch on history[N] is a classified correction, not a checkpoint extraTick guess', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 100);

    predictLocalMove(client, world, buffer, move(11, { forward: 1 }));
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => ({ ...idle, right: 1 }) }, FIXED_DT);

    const inspect = inspectPredictedPlayer(buffer, snapshotOf(server, 11), client, {
      world,
      physicsTicks: 1,
      serverTick: 101,
    });
    expect(inspect.comparePath).toBe('history[N]');
    expect(inspect.extraTicks).toBe(0);
    expect(inspect.kind).toBe('corrected');
    expect(inspect.rejectReason).toBe('xz');
  });
});
