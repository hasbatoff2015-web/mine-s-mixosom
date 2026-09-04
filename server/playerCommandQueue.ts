import type { PlayerCommand } from '../shared/playerCommand';
import { COMMAND_QUEUE_MAX } from '../shared/playerCommand';

/**
 * FIFO of movement commands. One command is applied per physics tick.
 * Empty queue repeats the last applied command (hold W / idle).
 */
export class PlayerCommandQueue {
  private readonly items: PlayerCommand[] = [];
  lastEnqueuedSeq = -1;
  lastApplied: PlayerCommand | null = null;

  get length(): number {
    return this.items.length;
  }

  clear(keepLook?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.lastEnqueuedSeq = -1;
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
    if (this.items.length >= COMMAND_QUEUE_MAX) this.items.shift();
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
