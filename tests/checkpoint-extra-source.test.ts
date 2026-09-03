import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  CHECKPOINT_EXTRA_ASSIGN_SITE,
  extraAssignSite,
  inspectPredictedPlayer,
  overwriteLatestSlot,
  predictedMoveFromInput,
  predictLocalMove,
  seedPredictionCheckpoint,
  simulationTicksFromServerTick,
  createPredictionBuffer,
  comparableExtraTicks,
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
    ...extras,
  };
}

function move(seq: number, extra: Partial<MoveInput> = {}) {
  return predictedMoveFromInput(seq, { ...idle, ...extra }, { yaw: 0, pitch: 0 }, true);
}

describe('checkpoint extraTicks source (owner dump extra=3 tickGap=1)', () => {
  it('extraTicks on the checkpoint path is simTicks, not seqGap and not physicsTicks-seqGap', () => {
    expect(simulationTicksFromServerTick(13771, 13774, 1)).toBe(3);
    expect(comparableExtraTicks(1, 3)).toBe(0);
    expect(extraAssignSite('checkpoint')).toBe(CHECKPOINT_EXTRA_ASSIGN_SITE);
    expect(CHECKPOINT_EXTRA_ASSIGN_SITE).toContain('simTicks = simulationTicksFromServerTick');
    expect(CHECKPOINT_EXTRA_ASSIGN_SITE).not.toContain('seqGap');
  });

  it('tickGap=1 extra=3 is lastAckedServerTick lag from latest-only pending slot, not a seqGap assignment', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 100);
    buffer.lastAckedSeq = 10;

    predictLocalMove(client, world, buffer, move(11, walk));
    predictLocalMove(client, world, buffer, move(12, walk));
    predictLocalMove(client, world, buffer, move(13, walk));

    let lastStateTick = 100;
    let pending: { tick: number; seq: number; snapshot: PlayerSnapshot } | undefined;
    let overwrites = 0;
    const ingest = (tick: number, seq: number, snapshot: PlayerSnapshot): void => {
      lastStateTick = tick;
      const queued = overwriteLatestSlot(pending, { tick, seq, snapshot });
      if (queued.overwritten) overwrites += 1;
      pending = queued.value;
    };

    const source = { yaw: 0, pitch: 0, locomotion: true, movement: () => walk };
    server.tick(world, source, FIXED_DT);
    ingest(101, 11, snapshotOf(server, 11));
    server.tick(world, source, FIXED_DT);
    ingest(102, 12, snapshotOf(server, 12));
    server.tick(world, source, FIXED_DT);
    ingest(103, 13, snapshotOf(server, 13));

    expect(overwrites).toBe(2);
    expect(pending?.tick).toBe(103);
    const tickGap = pending!.tick - 102;
    expect(tickGap).toBe(1);

    const inspect = inspectPredictedPlayer(buffer, pending!.snapshot, client, {
      world,
      physicsTicks: 1,
      serverTick: pending!.tick,
    });
    expect(inspect.physicsTicks).toBe(1);
    expect(inspect.seqGap).toBe(3);
    expect(inspect.simTicks).toBe(3);
    expect(inspect.extraTicks).toBe(3);
    expect(inspect.extraTicks).toBe(inspect.simTicks);
    expect(inspect.extraTicks).not.toBe(comparableExtraTicks(inspect.physicsTicks, inspect.seqGap));
    expect(inspect.comparePath).toBe('checkpoint');
    expect(extraAssignSite(inspect.comparePath)).toContain('simulationTicksFromServerTick');
    expect(inspect.comparable).toBeDefined();
  });

  it('same latest input × simTicks=3 does not match a server that applied three different seqs', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 100);
    buffer.lastAckedSeq = 10;

    predictLocalMove(client, world, buffer, move(11, { forward: 1 }));
    predictLocalMove(client, world, buffer, move(12, { right: 1 }));
    predictLocalMove(client, world, buffer, move(13, { forward: 1 }));

    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => ({ ...idle, forward: 1 }) }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => ({ ...idle, right: 1 }) }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => ({ ...idle, forward: 1 }) }, FIXED_DT);

    const inspect = inspectPredictedPlayer(buffer, snapshotOf(server, 13), client, {
      world,
      physicsTicks: 1,
      serverTick: 103,
    });
    expect(inspect.simTicks).toBe(3);
    expect(inspect.extraTicks).toBe(3);
    expect(inspect.comparePath).toBe('checkpoint');
    expect(inspect.kind).toBe('corrected');
    expect(inspect.rejectReason).toBe('xz');
  });

  it('stationary flight: extra=3 idle ticks of leftover vy diverges in y from one server tick', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const origin = new PlayerController({ position: [0.5, 8, 0.5] });
    origin.creativeFlightAllowed = true;
    origin.isFlying = true;
    origin.velocity.set(0, 6, 0);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, origin.captureMovementState(), 100);
    buffer.lastAckedSeq = 10;
    buffer.lastAckedInput = move(10);

    const client = new PlayerController({ position: [0.5, 8, 0.5] });
    client.creativeFlightAllowed = true;
    client.applyMovementState(origin.captureMovementState());
    predictLocalMove(client, world, buffer, move(11));
    predictLocalMove(client, world, buffer, move(12));
    predictLocalMove(client, world, buffer, move(13));

    const server = new PlayerController({ position: [0.5, 8, 0.5] });
    server.creativeFlightAllowed = true;
    server.applyMovementState(origin.captureMovementState());
    server.tick(world, { yaw: 0, pitch: 0, locomotion: true, movement: () => idle }, FIXED_DT);

    const inspect = inspectPredictedPlayer(buffer, snapshotOf(server, 13), client, {
      world,
      physicsTicks: 1,
      serverTick: 103,
    });
    expect(inspect.simTicks).toBe(3);
    expect(inspect.extraTicks).toBe(3);
    expect(inspect.comparePath).toBe('checkpoint');
    expect(inspect.kind).toBe('corrected');
    expect(inspect.rejectReason).toBe('y');
    expect(inspect.error.y).toBeGreaterThan(0.05);
    expect(inspect.comparable!.vy).not.toBeCloseTo(server.velocity.y, 2);
  });
});
