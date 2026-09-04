import type { PlayerCommand } from '../shared/playerCommand';
import { COMMAND_QUEUE_MAX } from '../shared/playerCommand';
import {
  compactContinuousCommands,
  mergeDroppedRange,
  type DroppedCommandRange,
} from '../shared/commandCompaction';

/**
 * FIFO of movement commands. One command is applied per physics tick.
 * Empty queue repeats the last applied command (hold W / idle).
 * Overflow compact continuous-state commands and reports the dropped seq range.
 */
export class PlayerCommandQueue {
  private readonly items: PlayerCommand[] = [];
  lastEnqueuedSeq = -1;
  lastApplied: PlayerCommand | null = null;
  lastCompacted: DroppedCommandRange | undefined;

  get length(): number {
    return this.items.length;
  }

  clear(keepLook?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.lastEnqueuedSeq = -1;
    this.lastCompacted = undefined;
    if (this.lastApplied && keepLook) {
      this.lastApplied = {
        ...this.lastApplied,
        commandSeq: this.lastApplied.commandSeq,
        clientTick: this.lastApplied.clientTick,
        forward: 0,
        right: 0,
        jump: false,
        sneak: false,
        sprint: false,
        descend: false,
        flySprint: false,
        mining: false,
        use: false,
        vehicleForward: 0,
        yaw: keepLook.yaw,
        pitch: keepLook.pitch,
        selectedSlot: keepLook.selectedSlot,
      };
    } else {
      this.lastApplied = null;
    }
  }

  enqueue(command: PlayerCommand): 'ok' | 'stale' | 'duplicate' {
    if (command.commandSeq < this.lastEnqueuedSeq) return 'stale';
    if (command.commandSeq === this.lastEnqueuedSeq) return 'duplicate';
    if (this.items.length >= COMMAND_QUEUE_MAX) {
      const compacted = compactContinuousCommands(this.items);
      if (compacted) this.lastCompacted = mergeDroppedRange(this.lastCompacted, compacted);
      while (this.items.length >= COMMAND_QUEUE_MAX) {
        const dropped = this.items.shift();
        if (!dropped) break;
        this.lastCompacted = mergeDroppedRange(this.lastCompacted, {
          fromCommandSeq: dropped.commandSeq,
          toCommandSeq: dropped.commandSeq,
        });
      }
    }
    this.items.push(command);
    this.lastEnqueuedSeq = command.commandSeq;
    return 'ok';
  }

  /** Pop the next command, or sticky last applied. */
  takeForTick(): PlayerCommand | null {
    const next = this.items.shift() ?? this.lastApplied;
    if (next) this.lastApplied = next;
    return next;
  }

  peek(): PlayerCommand | undefined {
    return this.items[0];
  }
}
