import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/core/constants';
import { gameplayTicksDue, scheduleNextTickSlot, simulateServerOuterLoop } from '../server/tickScheduler';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { advanceFixedStep } from '../src/core/fixedStep';
import type { MoveInput } from '../src/input/MoveInput';
import {
  createPredictionBuffer,
  predictedMoveFromInput,
  predictLocalMove,
  reconcilePredictedPlayer,
  type PredictionBuffer,
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

const walk: MoveInput = { forward: 1, right: 0, jump: false, sprint: false, sneak: false };

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -32; z <= 32; z += 1) {
    for (let x = -32; x <= 32; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

describe('server tick clock', () => {
  it('matches client advanceFixedStep including dropped time', () => {
    const due = gameplayTicksDue(0, 0.4, FIXED_DT);
    const client = advanceFixedStep(0, 0.4);
    expect(due.ticks).toBe(client.ticks);
    expect(due.nextAccumulator).toBeCloseTo(client.nextAccumulator, 10);
    expect(due.droppedSeconds).toBeCloseTo(client.droppedSeconds, 10);
    expect(due.droppedTicks).toBeGreaterThan(0);
  });

  it('absolute slots do not accumulate 4ms timeout slack', () => {
    const onTime = scheduleNextTickSlot(0, 50, 50);
    expect(onTime.nextSlotAt).toBe(100);
    expect(onTime.waitMs).toBe(50);
    const late = scheduleNextTickSlot(0, 54, 50);
    expect(late.nextSlotAt).toBe(100);
    expect(late.waitMs).toBe(46);
  });

  it('drift schedule is ~17 outer loops/s while physics catch-up still aims at 20', () => {
    const drift = simulateServerOuterLoop({
      seconds: 1,
      mode: 'drift',
      workMs: 5,
      timeoutSlackMs: 10,
    });
    expect(drift.snapshots).toBeLessThan(19);
    expect(drift.snapshots).toBeGreaterThan(15);
    expect(drift.physicsTicks).toBeGreaterThanOrEqual(19);
    expect(drift.catchUpLoops).toBeGreaterThanOrEqual(2);
  });

  it('absolute schedule keeps outer loops and snapshots near 20/s', () => {
    const absolute = simulateServerOuterLoop({
      seconds: 1,
      mode: 'absolute',
      workMs: 5,
      timeoutSlackMs: 4,
    });
    expect(absolute.snapshots).toBeGreaterThanOrEqual(19);
    expect(absolute.snapshots).toBeLessThanOrEqual(21);
    expect(absolute.physicsTicks).toBeGreaterThanOrEqual(19);
    expect(absolute.physicsTicks).toBeLessThanOrEqual(21);
    expect(absolute.catchUpLoops).toBeLessThanOrEqual(2);
  });
});

describe('17 Hz snapshots vs 20 Hz prediction', () => {
  it('catch-up of two physics ticks of one command mismatches history[N]', () => {
    const ignore = runCatchUpWalk({ physicsTicksMode: 'ignore' });
    const honest = runCatchUpWalk({ physicsTicksMode: 'honest' });
    expect(ignore.corrections).toBe(ignore.events);
    expect(honest.corrections).toBe(honest.events);
    expect(ignore.corrections).toBeGreaterThanOrEqual(3);
  });

  it('FIFO history[N] does not invent extraTicks to hide catch-up', () => {
    const stats = runCatchUpWalk({ physicsTicksMode: 'honest' });
    expect(stats.accepts).toBe(0);
    expect(stats.corrections).toBe(stats.events);
  });
});

function snapshotOf(player: PlayerController, seq: number): PlayerSnapshot {
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
  };
}

function runCatchUpWalk(options: { physicsTicksMode: 'ignore' | 'honest' }): {
  corrections: number;
  accepts: number;
  events: number;
} {
  const events = 3;
  let corrections = 0;
  let accepts = 0;
  for (let trial = 0; trial < events; trial += 1) {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => ({ ...walk, forward: 0 }) }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => ({ ...walk, forward: 0 }) }, FIXED_DT);
    const buffer: PredictionBuffer = createPredictionBuffer();
    buffer.lastAckedSeq = 0;
    let seq = 0;
    const source = {
      yaw: 0,
      pitch: 0,
      locomotion: true,
      movement: () => walk,
    };
    for (let i = 0; i < 8; i += 1) {
      seq += 1;
      predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true));
      server.tick(world, source, FIXED_DT);
      const warm = reconcilePredictedPlayer(client, world, buffer, snapshotOf(server, seq), FIXED_DT, { physicsTicks: 1 });
      expect(warm.kind).toBe('accepted');
    }
    seq += 1;
    predictLocalMove(client, world, buffer, predictedMoveFromInput(seq, walk, { yaw: 0, pitch: 0 }, true));
    server.tick(world, source, FIXED_DT);
    server.tick(world, source, FIXED_DT);
    const result = reconcilePredictedPlayer(
      client,
      world,
      buffer,
      snapshotOf(server, seq),
      FIXED_DT,
      { physicsTicks: options.physicsTicksMode === 'honest' ? 2 : 1 },
    );
    if (result.kind === 'corrected' || result.kind === 'snapped') corrections += 1;
    if (result.kind === 'accepted') accepts += 1;
  }
  return { corrections, accepts, events };
}
