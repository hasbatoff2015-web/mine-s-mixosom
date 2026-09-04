import { describe, expect, it } from 'vitest';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import { COMMAND_QUEUE_MAX, type PlayerCommand } from '../shared/playerCommand';
import { commandEdgeSensitive, compactContinuousCommands } from '../shared/commandCompaction';

function cmd(seq: number, extra: Partial<PlayerCommand> = {}): PlayerCommand {
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

describe('PlayerCommandQueue FIFO', () => {
  it('applies one command per take and sticks the last when empty', () => {
    const queue = new PlayerCommandQueue();
    expect(queue.enqueue(cmd(1, { forward: 1 }))).toBe('ok');
    expect(queue.enqueue(cmd(2, { forward: 0 }))).toBe('ok');
    expect(queue.takeForTick()?.commandSeq).toBe(1);
    expect(queue.takeForTick()?.commandSeq).toBe(2);
    expect(queue.takeForTick()?.commandSeq).toBe(2);
    expect(queue.takeForTick()?.forward).toBe(0);
  });

  it('rejects stale and duplicate seq', () => {
    const queue = new PlayerCommandQueue();
    expect(queue.enqueue(cmd(3))).toBe('ok');
    expect(queue.enqueue(cmd(3))).toBe('duplicate');
    expect(queue.enqueue(cmd(2))).toBe('stale');
  });

  it('compacts continuous walks on overflow and reports the dropped range', () => {
    const queue = new PlayerCommandQueue();
    for (let seq = 1; seq <= COMMAND_QUEUE_MAX + 5; seq += 1) {
      expect(queue.enqueue(cmd(seq, { forward: 1 }))).toBe('ok');
    }
    expect(queue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    expect(queue.lastCompacted).toBeDefined();
    expect(queue.lastCompacted!.fromCommandSeq).toBe(1);
    expect(queue.takeForTick()?.forward).toBe(1);
  });

  it('does not compact a jump edge away to make room for later walks', () => {
    const queue = new PlayerCommandQueue();
    expect(queue.enqueue(cmd(1, { jump: true }))).toBe('ok');
    for (let seq = 2; seq <= COMMAND_QUEUE_MAX + 2; seq += 1) {
      expect(queue.enqueue(cmd(seq, { forward: 1 }))).toBe('ok');
    }
    expect(queue.takeForTick()?.jump).toBe(true);
    expect(queue.lastCompacted).toBeDefined();
    expect(queue.lastCompacted!.fromCommandSeq).toBeGreaterThanOrEqual(2);
  });
});

describe('continuous command compaction', () => {
  it('treats jump/use/mining/slot/flight as edges', () => {
    expect(commandEdgeSensitive(cmd(1), cmd(2, { jump: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { use: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { mining: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { selectedSlot: 3 }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { flySprint: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1, { forward: 1 }), cmd(2, { forward: 0, yaw: 1 }))).toBe(false);
  });

  it('collapses a run of WASD/look into the newest sample', () => {
    const items = [
      cmd(1, { forward: 1, yaw: 0.1 }),
      cmd(2, { forward: 1, yaw: 0.2 }),
      cmd(3, { forward: 1, yaw: 0.3 }),
      cmd(4, { jump: true, forward: 1 }),
    ];
    const dropped = compactContinuousCommands(items);
    expect(dropped).toEqual({ fromCommandSeq: 1, toCommandSeq: 2 });
    expect(items.map((item) => item.commandSeq)).toEqual([3, 4]);
    expect(items[0]?.yaw).toBe(0.3);
  });
});
