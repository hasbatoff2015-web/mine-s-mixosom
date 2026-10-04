import { describe, expect, it } from 'vitest';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX, type PlayerCommand } from '../shared/playerCommand';
import { commandEdgeSensitive, compactContinuousCommands, mergeDroppedRange } from '../shared/commandCompaction';
import { createPredictionBuffer, discardCompactedPrediction } from '../src/net/localPlayerPrediction';

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

  it('compacts a continuous burst down to the latency budget, not the hard cap', () => {
    const queue = new PlayerCommandQueue();
    for (let seq = 1; seq <= 15; seq += 1) {
      expect(queue.enqueue(cmd(seq, { forward: 1, yaw: seq * 0.01 }))).toBe('ok');
    }
    expect(queue.length).toBeLessThanOrEqual(COMMAND_QUEUE_LATENCY_BUDGET);
    expect(queue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    expect(queue.lastCompacted).toEqual({ fromCommandSeq: 1, toCommandSeq: 15 - COMMAND_QUEUE_LATENCY_BUDGET });
    expect(queue.takeForTick()?.forward).toBe(1);
    expect(queue.peek()?.commandSeq).toBe(15 - COMMAND_QUEUE_LATENCY_BUDGET + 2);
  });

  it('keeps a jump edge at the head of a burst inside the hard cap', () => {
    const queue = new PlayerCommandQueue();
    expect(queue.enqueue(cmd(1, { jump: true }))).toBe('ok');
    for (let seq = 2; seq <= 15; seq += 1) {
      expect(queue.enqueue(cmd(seq, { forward: 1 }))).toBe('ok');
    }
    expect(queue.lastCompacted).toBeUndefined();
    expect(queue.takeForTick()?.jump).toBe(true);
    expect(queue.find(1)?.jump).toBe(true);
  });

  it('hard cap drops an unprotected head only after the latency budget cannot', () => {
    const queue = new PlayerCommandQueue();
    for (let seq = 1; seq <= COMMAND_QUEUE_MAX + 2; seq += 1) {
      expect(queue.enqueue(cmd(seq, { jump: seq % 2 === 0 }))).toBe('ok');
    }
    expect(queue.length).toBe(COMMAND_QUEUE_MAX);
    expect(queue.lastCompacted).toEqual({ fromCommandSeq: 1, toCommandSeq: 2 });
    expect(queue.peek()?.commandSeq).toBe(3);
  });
});

describe('continuous command compaction', () => {
  it('treats jump/use/mining/slot/flight as edges', () => {
    expect(commandEdgeSensitive(cmd(1), cmd(2, { jump: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { use: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { mining: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { selectedSlot: 3 }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1), cmd(2, { flySprint: true }))).toBe(true);
    expect(commandEdgeSensitive(
      cmd(1, { jump: true, manualJump: false }),
      cmd(2, { jump: true, manualJump: true }),
    )).toBe(true);
    expect(commandEdgeSensitive(cmd(1, { forward: 1 }), cmd(2, { forward: 0, yaw: 1 }))).toBe(false);
    expect(commandEdgeSensitive(cmd(1, { descend: false }), cmd(2, { descend: true }))).toBe(true);
    expect(commandEdgeSensitive(cmd(1, { descend: true }), cmd(2, { descend: false }))).toBe(true);
  });

  it('keeps a descend press and its release when look and walk do not change', () => {
    const items = [
      cmd(1, { descend: false, forward: 1, yaw: 0.2 }),
      cmd(2, { descend: true, forward: 1, yaw: 0.2 }),
      cmd(3, { descend: false, forward: 1, yaw: 0.2 }),
    ];
    expect(compactContinuousCommands(items)).toBeUndefined();
    expect(items.map((item) => item.descend)).toEqual([false, true, false]);
    expect(items.map((item) => item.commandSeq)).toEqual([1, 2, 3]);
  });

  it('keeps a manual-jump edge while locomotion jump stays true', () => {
    const items = [
      cmd(1, { jump: true, manualJump: false }),
      cmd(2, { jump: true, manualJump: true }),
      cmd(3, { jump: true, manualJump: false }),
    ];
    expect(compactContinuousCommands(items)).toBeUndefined();
    expect(items.map((item) => item.commandSeq)).toEqual([1, 2, 3]);
  });

  it('collapses a run of WASD/look into the newest sample', () => {
    const items = [
      cmd(1, { forward: 1, yaw: 0.1 }),
      cmd(2, { forward: 1, yaw: 0.2 }),
      cmd(3, { forward: 1, yaw: 0.3 }),
      cmd(4, { jump: true, forward: 1 }),
    ];
    const dropped = compactContinuousCommands(items, 2);
    expect(dropped).toEqual({ fromCommandSeq: 1, toCommandSeq: 2 });
    expect(items.map((item) => item.commandSeq)).toEqual([3, 4]);
    expect(items[0]?.yaw).toBe(0.3);
  });

  it('does not report a dropped range that swallows a retained edge', () => {
    const items = [
      cmd(1, { forward: 1 }),
      cmd(2, { forward: 1 }),
      cmd(3, { forward: 1 }),
      cmd(4, { jump: true, forward: 1 }),
      cmd(5, { forward: 1 }),
      cmd(6, { forward: 1 }),
      cmd(7, { forward: 1 }),
      cmd(8, { forward: 1 }),
    ];
    const dropped = compactContinuousCommands(items, COMMAND_QUEUE_LATENCY_BUDGET);
    expect(dropped).toEqual({ fromCommandSeq: 1, toCommandSeq: 2 });
    expect(items.map((item) => item.commandSeq)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(items.find((item) => item.commandSeq === 4)?.jump).toBe(true);
    expect(dropped!.toCommandSeq).toBeLessThan(4);
    const buffer = createPredictionBuffer();
    buffer.entries = [cmd(1), cmd(2), ...items].map((command) => ({
      seq: command.commandSeq,
      predTick: command.commandSeq,
      input: {
        seq: command.commandSeq,
        forward: command.forward,
        right: 0,
        jump: command.jump,
        manualJump: false,
        sneak: false,
        sprint: false,
        descend: false,
        flySprint: false,
        yaw: 0,
        pitch: 0,
        locomotion: true,
      },
      state: {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        onGround: true, sneaking: false, sprinting: false, jumpHeld: false,
        isFlying: false, flyWindowTicks: 0, flyIgnoreGroundTicks: 0,
        onLadder: false, fallDistance: 0, meleeKnockback: false,
      },
    }));
    // Discarding the reported range must leave the jump at seq 4 and the kept command 3.
    const removed = discardCompactedPrediction(buffer, dropped!.fromCommandSeq, dropped!.toCommandSeq);
    expect(removed).toBe(2);
    expect(buffer.entries.map((entry) => entry.seq)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('refuses to merge dropped ranges across a gap', () => {
    expect(mergeDroppedRange({ fromCommandSeq: 1, toCommandSeq: 2 }, { fromCommandSeq: 4, toCommandSeq: 6 }))
      .toBeUndefined();
    expect(mergeDroppedRange({ fromCommandSeq: 1, toCommandSeq: 2 }, { fromCommandSeq: 3, toCommandSeq: 4 }))
      .toEqual({ fromCommandSeq: 1, toCommandSeq: 4 });
  });

  it('keeps sneak, descend, manualJump, use, mining, slot, and flight edges', () => {
    const edges: Partial<PlayerCommand>[] = [
      { sneak: true },
      { descend: true },
      { jump: true, manualJump: true },
      { use: true },
      { mining: true },
      { selectedSlot: 4 },
      { vehicleForward: 1 },
      { flySprint: true },
      { sprint: true },
    ];
    for (const edge of edges) {
      const queue = new PlayerCommandQueue();
      expect(queue.enqueue(cmd(1, edge))).toBe('ok');
      for (let seq = 2; seq <= 15; seq += 1) {
        expect(queue.enqueue(cmd(seq, { forward: 1 }))).toBe('ok');
      }
      expect(queue.lastCompacted, JSON.stringify(edge)).toBeUndefined();
      expect(queue.takeForTick()).toMatchObject(edge);
    }
  });

  it('does not compact a protected pending command boundary', () => {
    const queue = new PlayerCommandQueue();
    for (let seq = 1; seq <= 6; seq += 1) queue.enqueue(cmd(seq, { forward: 1 }));
    const head = queue.peek()!.commandSeq;
    queue.protectedCommandSeqs = new Set([head]);
    for (let seq = 7; seq <= 20; seq += 1) queue.enqueue(cmd(seq, { forward: 1 }));
    expect(queue.find(head)?.commandSeq).toBe(head);
    const compacted = queue.lastCompacted;
    expect(compacted === undefined || head < compacted.fromCommandSeq || head > compacted.toCommandSeq).toBe(true);
  });
});
