import { describe, expect, it } from 'vitest';
import { PlayerCommandQueue } from '../server/playerCommandQueue';
import { COMMAND_QUEUE_MAX, type PlayerCommand } from '../shared/playerCommand';

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

  it('drops oldest when bounded', () => {
    const queue = new PlayerCommandQueue();
    for (let seq = 1; seq <= COMMAND_QUEUE_MAX + 5; seq += 1) {
      expect(queue.enqueue(cmd(seq, { forward: 1 }))).toBe('ok');
    }
    expect(queue.length).toBe(COMMAND_QUEUE_MAX);
    expect(queue.takeForTick()?.commandSeq).toBe(6);
  });
});
