import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { MoveInput } from '../src/input/MoveInput';
import {
  createPredictionBuffer,
  inspectPredictedPlayer,
  predictLocalMove,
  predictedMoveFromInput,
  reconcilePredictedPlayer,
  seedPredictionCheckpoint,
  type PredictedMove,
} from '../src/net/localPlayerPrediction';
import { captureMotionFull, diffMotionFull } from '../src/net/localPlayerNetTrace';
import { PlayerController } from '../src/player';
import type { AppliedInputTick, PlayerSnapshot } from '../shared/protocol';
import type { VoxelWorld } from '../src/world/World';

class FlatWorld {
  getBlock(_x: number, y: number, _z: number): BlockId {
    return y <= 0 ? BlockId.Stone : BlockId.Air;
  }
  getBlockState(): undefined { return undefined; }
  isSolid(x: number, y: number, z: number): boolean {
    return getBlockDefinition(this.getBlock(x, y, z)).solid;
  }
}

const idle: MoveInput = {
  forward: 0, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false,
};

function command(seq: number, input: Partial<MoveInput> = {}, yaw = 0, pitch = 0): PredictedMove {
  return predictedMoveFromInput(seq, { ...idle, ...input }, { yaw, pitch }, true);
}

function applied(tick: number, move: PredictedMove, override: Partial<AppliedInputTick> = {}): AppliedInputTick {
  return {
    tick,
    seq: move.seq,
    forward: move.forward,
    right: move.right,
    jump: move.jump,
    sneak: move.sneak,
    sprint: move.sprint,
    descend: move.descend,
    flySprint: move.flySprint,
    yaw: move.yaw,
    pitch: move.pitch,
    locomotion: move.locomotion,
    y: 0,
    vy: 0,
    flying: false,
    onGround: false,
    ...override,
  };
}

function snapshot(player: PlayerController, inputSeq: number, rows: readonly AppliedInputTick[]): PlayerSnapshot {
  return {
    id: 'self', name: 'self',
    x: player.position.x, y: player.position.y, z: player.position.z,
    yaw: player.yaw, pitch: player.pitch,
    vx: player.velocity.x, vy: player.velocity.y, vz: player.velocity.z,
    health: 20, gamemode: player.creativeFlightAllowed ? 'creative' : 'survival',
    sneaking: player.sneaking, sprinting: player.sprinting, onGround: player.onGround,
    selectedSlot: 0, flying: player.isFlying, inputSeq, appliedTicks: rows,
  };
}

interface Scenario {
  readonly commands: readonly PredictedMove[];
  readonly applied: readonly AppliedInputTick[];
  readonly flying?: boolean;
  readonly checkpointEvery?: number;
}

function verifyScenario(scenario: Scenario): void {
  const world = new FlatWorld() as unknown as VoxelWorld;
  const startY = scenario.flying ? 8 : 1;
  const client = new PlayerController({ position: [0.5, startY, 0.5] });
  const server = new PlayerController({ position: [0.5, startY, 0.5] });
  if (scenario.flying) {
    for (const player of [client, server]) {
      player.creativeFlightAllowed = true;
      player.isFlying = true;
    }
  } else {
    for (const player of [client, server]) player.tick(world, {
      yaw: 0, pitch: 0, locomotion: true, movement: () => idle,
    }, FIXED_DT);
  }
  const buffer = createPredictionBuffer();
  seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
  for (const move of scenario.commands) predictLocalMove(client, world, buffer, move);

  const trace: AppliedInputTick[] = [];
  const checkpointEvery = scenario.checkpointEvery ?? scenario.applied.length;
  for (let index = 0; index < scenario.applied.length; index += 1) {
    const row = scenario.applied[index]!;
    const move = predictedMoveFromInput(row.seq, {
      forward: row.forward, right: row.right, jump: row.jump, sneak: row.sneak,
      sprint: row.sprint, descend: row.descend, flySprint: row.flySprint,
    }, { yaw: row.yaw, pitch: row.pitch }, row.locomotion);
    server.tick(world, {
      yaw: move.yaw,
      pitch: move.pitch,
      locomotion: move.locomotion,
      movement: () => ({
        forward: move.forward, right: move.right, jump: move.jump, sneak: move.sneak,
        sprint: move.sprint, descend: move.descend, flySprint: move.flySprint,
      }),
    }, FIXED_DT);
    trace.push({
      ...row,
      y: server.position.y,
      vy: server.velocity.y,
      flying: server.isFlying,
      onGround: server.onGround,
    });
    const atCheckpoint = (index + 1) % checkpointEvery === 0 || index === scenario.applied.length - 1;
    if (!atCheckpoint) continue;
    const state = snapshot(server, row.seq, trace.slice(-64));
    const inspect = inspectPredictedPlayer(buffer, state, client, {
      world,
      physicsTicks: Math.min(checkpointEvery, index + 1),
      serverTick: row.tick,
    });
    expect(inspect.comparePath).toBe('applied-timeline');
    expect(inspect.kind, `tick=${row.tick} diff=${inspect.firstDiff ?? 'none'}`).toBe('accepted');
    expect(inspect.firstDiff).toBeUndefined();
    const before = captureMotionFull(client);
    const result = reconcilePredictedPlayer(client, world, buffer, state, undefined, {
      physicsTicks: Math.min(checkpointEvery, index + 1),
      serverTick: row.tick,
    });
    expect(result.kind).toBe('accepted');
    expect(result.acceptMutated).toBe(false);
    expect(diffMotionFull(before, captureMotionFull(client))).toEqual([]);
  }
}

describe('authoritative applied movement timeline', () => {
  it.each([
    ['idle 100', {}],
    ['walk 100', { forward: 1 }],
    ['strafe 100', { right: 1 }],
    ['sprint 100', { forward: 1, sprint: true }],
  ] as const)('%s has zero false corrections and zero accepted live mutations', (_name, input) => {
    const commands = Array.from({ length: 100 }, (_, index) => command(index + 1, input));
    verifyScenario({
      commands,
      applied: commands.map((move, index) => applied(index + 1, move)),
      checkpointEvery: 20,
    });
  });

  it.each([
    ['jump arc', [command(1, { jump: true }), ...Array.from({ length: 24 }, (_, i) => command(i + 2))]],
    ['creative hover', Array.from({ length: 20 }, (_, i) => command(i + 1))],
    ['creative fly + SHIFT', Array.from({ length: 20 }, (_, i) => command(i + 1, { sneak: true, descend: true }))],
  ] as const)('%s matches the exact authoritative checkpoint', (_name, commands) => {
    verifyScenario({
      commands,
      applied: commands.map((move, index) => applied(index + 1, move)),
      flying: _name.startsWith('creative'),
      checkpointEvery: 10,
    });
  });

  it.each([
    ['same phase', [[1], [2], [3], [4]]],
    ['10 ms phase / two packets before tick', [[2], [4]]],
    ['25 ms phase', [[1], [3], [4]]],
    ['40 ms phase', [[2], [3], [4]]],
    ['snapshot batching', [[1], [2], [3], [4]]],
  ] as const)('%s reconstructs the commands actually sampled', (_name, batches) => {
    const commands = [command(1, { forward: 1 }), command(2, { forward: 1, right: 1 }), command(3), command(4, { right: -1 })];
    const rows = batches.map((batch, index) => applied(index + 1, commands[batch[batch.length - 1]! - 1]!));
    verifyScenario({ commands, applied: rows });
  });

  it('handles one command used for multiple ticks and 2/3-tick catch-up', () => {
    const commands = [command(1, { forward: 1 }), command(2, { forward: 1 }), command(3, { forward: 1 })];
    verifyScenario({ commands, applied: [applied(1, commands[0]!), applied(2, commands[0]!), applied(3, commands[0]!)] });
    verifyScenario({ commands: commands.slice(0, 2), applied: [applied(1, commands[1]!), applied(2, commands[1]!)] });
    verifyScenario({ commands, applied: [applied(1, commands[2]!), applied(2, commands[2]!), applied(3, commands[2]!)] });
  });

  it.each([
    ['W → WD', [command(1, { forward: 1 }), command(2, { forward: 1, right: 1 })]],
    ['W → idle', [command(1, { forward: 1 }), command(2)]],
    ['W → S', [command(1, { forward: 1 }), command(2, { forward: -1 })]],
    ['strafe reversal', [command(1, { right: 1 }), command(2, { right: -1 })]],
    ['sprint press', [command(1, { forward: 1 }), command(2, { forward: 1, sprint: true })]],
    ['sprint release', [command(1, { forward: 1, sprint: true }), command(2, { forward: 1 })]],
    ['jump release', [command(1, { jump: true }), command(2)]],
    ['rapid yaw + W', [command(1, { forward: 1 }, 0), command(2, { forward: 1 }, Math.PI * 0.8)]],
    ['descend transition', [command(1), command(2, { sneak: true, descend: true }), command(3)]],
  ] as const)('%s remains deterministic', (_name, commands) => {
    verifyScenario({ commands, applied: commands.map((move, index) => applied(index + 1, move)) });
  });

  it('records a jump press between server ticks on the sampled command row', () => {
    const commands = [command(1, { jump: true }), command(2)];
    verifyScenario({
      commands,
      applied: [applied(1, commands[1]!, { jump: true })],
    });
  });

  it('supports continuous 360° turning while holding W', () => {
    const commands = Array.from({ length: 32 }, (_, index) => command(
      index + 1,
      { forward: 1 },
      (index / 31) * Math.PI * 2,
    ));
    verifyScenario({ commands, applied: commands.map((move, index) => applied(index + 1, move)), checkpointEvery: 8 });
  });

  it('corrects deterministically instead of guessing when the bounded trace has a gap', () => {
    const world = new FlatWorld() as unknown as VoxelWorld;
    const client = new PlayerController({ position: [0.5, 1, 0.5] });
    const server = new PlayerController({ position: [0.5, 1, 0.5] });
    for (const player of [client, server]) player.tick(world, {
      yaw: 0, pitch: 0, locomotion: true, movement: () => idle,
    }, FIXED_DT);
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, client.captureMovementState(), 0);
    const moves = [command(1, { forward: 1 }), command(2, { right: 1 })];
    for (const move of moves) predictLocalMove(client, world, buffer, move);
    for (const move of moves) server.tick(world, {
      yaw: move.yaw,
      pitch: move.pitch,
      locomotion: move.locomotion,
      movement: () => move,
    }, FIXED_DT);
    const incomplete = snapshot(server, 2, [applied(2, moves[1]!)]);
    const inspect = inspectPredictedPlayer(buffer, incomplete, client, {
      world, physicsTicks: 2, serverTick: 2,
    });
    expect(inspect.kind).toBe('corrected');
    expect(inspect.rejectReason).toBe('no-history');
    expect(inspect.comparePath).toBe('none');
  });
});
