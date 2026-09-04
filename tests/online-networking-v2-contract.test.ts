import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  applyPredictedTick,
  createPredictionBuffer,
  inspectPredictedPlayer,
  predictedMoveFromInput,
  predictLocalMove,
  reconcilePredictedPlayer,
  seedPredictionCheckpoint,
} from '../src/net/localPlayerPrediction';
import { captureMotionFull, diffMotionFull } from '../src/net/localPlayerNetTrace';
import { PlayerController } from '../src/player';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import type { PlayerCommand } from '../shared/playerCommand';
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

function flatWorld(): TestWorld {
  const world = new TestWorld();
  for (let z = -16; z <= 16; z += 1) {
    for (let x = -16; x <= 16; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

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

function command(seq: number, extra: Partial<PlayerCommand> = {}): PlayerCommand {
  return {
    commandSeq: seq,
    clientTick: seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

describe('networking v2 movement contract', () => {
  const cases: Array<{ name: string; ticks: number; input: Partial<MoveInput>; flying?: boolean }> = [
    { name: 'idle 100', ticks: 100, input: {} },
    { name: 'walk 100', ticks: 100, input: { forward: 1 } },
    { name: 'strafe', ticks: 40, input: { right: 1 } },
    { name: 'sprint', ticks: 40, input: { forward: 1, sprint: true } },
    { name: 'jump', ticks: 20, input: { jump: true } },
    { name: 'W then WD', ticks: 20, input: { forward: 1, right: 1 } },
    { name: 'rapid yaw while W', ticks: 36, input: { forward: 1 } },
  ];

  for (const mode of cases) {
    it(`${mode.name}: lockstep history[N] accepts and does not mutate live pose`, () => {
      const world = flatWorld() as unknown as VoxelWorld;
      const client = new PlayerController({ position: [0.5, mode.flying ? 8 : 1, 0.5] });
      const server = new PlayerController({ position: [0.5, mode.flying ? 8 : 1, 0.5] });
      if (mode.flying) {
        client.creativeFlightAllowed = true;
        server.creativeFlightAllowed = true;
        client.isFlying = true;
        server.isFlying = true;
      }
      client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
      server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
      const buffer = createPredictionBuffer();
      seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
      for (let seq = 1; seq <= mode.ticks; seq += 1) {
        const yaw = mode.name.includes('yaw') ? seq * 0.2 : 0;
        const predicted = predictedMoveFromInput(seq, { ...idle, ...mode.input }, { yaw, pitch: 0 }, true);
        predictLocalMove(client, world, buffer, predicted);
        applyPredictedTick(server, world, predicted);
        const live = captureMotionFull(client);
        const result = reconcilePredictedPlayer(
          client,
          world,
          buffer,
          snapshotFrom(server, seq),
          FIXED_DT,
          { serverTick: seq },
        );
        expect(result.kind, mode.name).toBe('accepted');
        expect(diffMotionFull(live, captureMotionFull(client))).toEqual([]);
      }
    });
  }

  it('W → idle maps sticky last command to idle after the idle seq is applied', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(1, { forward: 1 }));
    queue.enqueue(command(2, { forward: 0 }));
    expect(queue.takeForTick()?.forward).toBe(1);
    expect(queue.takeForTick()?.forward).toBe(0);
    expect(queue.takeForTick()?.forward).toBe(0);
  });

  it('W → S applies each command on consecutive ticks, not latest-input overwrite', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(1, { forward: 1 }));
    queue.enqueue(command(2, { forward: -1 }));
    expect(queue.takeForTick()?.forward).toBe(1);
    expect(queue.takeForTick()?.forward).toBe(-1);
  });

  it('two client packets before a server tick apply the first, then the second', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(10, { forward: 1 }));
    queue.enqueue(command(11, { right: 1 }));
    expect(queue.takeForTick()?.commandSeq).toBe(10);
    expect(queue.takeForTick()?.commandSeq).toBe(11);
  });

  it('one command across several server ticks is sticky lastApplied', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(7, { forward: 1, sprint: true }));
    expect(queue.takeForTick()?.commandSeq).toBe(7);
    expect(queue.takeForTick()?.commandSeq).toBe(7);
    expect(queue.takeForTick()?.sprint).toBe(true);
  });

  it('jump between server ticks is its own queued command, not OR-coalesced into later input', () => {
    const queue = new PlayerCommandQueue();
    queue.enqueue(command(1, { jump: true }));
    queue.enqueue(command(2, { forward: 1, jump: false }));
    expect(queue.takeForTick()?.jump).toBe(true);
    expect(queue.takeForTick()?.jump).toBe(false);
  });

  it('server catch-up of the same command is a real mismatch versus a single predicted tick', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    client.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    server.tick(world, { yaw: 0, pitch: 0, movement: () => idle }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const walk = move(1, { forward: 1 });
    predictLocalMove(client, world, buffer, walk);
    applyPredictedTick(server, world, walk);
    applyPredictedTick(server, world, walk);
    const inspect = inspectPredictedPlayer(buffer, snapshotFrom(server, 1), client, {
      world,
      physicsTicks: 2,
      serverTick: 2,
    });
    expect(inspect.comparePath).toBe('history[N]');
    expect(inspect.kind).toBe('corrected');
  });
});
