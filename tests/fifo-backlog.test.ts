import { describe, expect, it } from 'vitest';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import type { PlayerCommand } from '../shared/playerCommand';
import {
  applyPredictedTick,
  createPredictionBuffer,
  discardCompactedPrediction,
  predictLocalMove,
  predictedMoveFromInput,
  seedPredictionCheckpoint,
} from '../src/net/localPlayerPrediction';
import { PlayerController } from '../src/player';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { FIXED_DT } from '../src/core/constants';
import type { VoxelWorld } from '../src/world/World';
import type { MoveInput } from '../src/input/MoveInput';

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
  for (let z = -8; z <= 8; z += 1) {
    for (let x = -8; x <= 8; x += 1) world.set(x, 0, z, BlockId.Stone);
  }
  return world;
}

function cmd(seq: number, extra: Partial<PlayerCommand> = {}): PlayerCommand {
  return {
    commandSeq: seq,
    clientTick: seq,
    forward: 1,
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

const idle: MoveInput = { forward: 0, right: 0, jump: false, sprint: false, sneak: false };

describe('FIFO burst backlog', () => {
  it.each([
    ['50ms', 1],
    ['100ms', 2],
    ['200ms', 4],
    ['300ms', 6],
  ] as const)('%s burst stays under the bound and drains without dropping a jump', (_name, extraPackets) => {
    const queue = new PlayerCommandQueue();
    expect(queue.enqueue(cmd(1, { jump: true, forward: 0 }))).toBe('ok');
    for (let i = 0; i < extraPackets; i += 1) {
      expect(queue.enqueue(cmd(2 + i, { forward: 1 }))).toBe('ok');
    }
    expect(queue.length).toBe(1 + extraPackets);
    expect(queue.lastCompacted).toBeUndefined();
    expect(queue.takeForTick()?.jump).toBe(true);
    let ticks = 0;
    while (queue.length > 0) {
      queue.takeForTick();
      ticks += 1;
    }
    expect(ticks).toBe(extraPackets);
  });

  it('rebuilds live prediction after a reported compacted range', () => {
    const world = flatWorld() as unknown as VoxelWorld;
    const player = new PlayerController({ position: [0.5, 1, 0.5] });
    const buffer = createPredictionBuffer();
    seedPredictionCheckpoint(buffer, player.captureMovementState(), 0);
    for (let seq = 1; seq <= 6; seq += 1) {
      predictLocalMove(player, world, buffer, predictedMoveFromInput(seq, { ...idle, forward: 1 }, { yaw: 0, pitch: 0 }, true));
    }
    const dropped = discardCompactedPrediction(buffer, 1, 4, player, world, FIXED_DT);
    expect(dropped).toBe(4);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual([5, 6]);
    const replay = new PlayerController({ position: [0.5, 1, 0.5] });
    replay.creativeFlightAllowed = player.creativeFlightAllowed;
    replay.applyMovementState(buffer.lastAckedState!);
    for (const entry of buffer.entries) applyPredictedTick(replay, world, entry.input, FIXED_DT);
    expect(player.position.distanceTo(replay.position)).toBeLessThan(1e-6);
  });
});
