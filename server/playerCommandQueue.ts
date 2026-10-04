import type { PlayerCommand } from '../shared/playerCommand';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX } from '../shared/playerCommand';
import {
  compactContinuousCommands,
  mergeDroppedRange,
  type DroppedCommandRange,
} from '../shared/commandCompaction';

/**
 * FIFO of movement commands. One command is applied per physics tick.
 * Empty queue repeats the last applied command (hold W / idle).
 * Continuous prefixes are compacted to the latency budget. The hard cap
 * only sheds an unprotected head, and the reported range stays contiguous.
 */
export class PlayerCommandQueue {
  private readonly items: PlayerCommand[] = [];
  lastEnqueuedSeq = -1;
  lastApplied: PlayerCommand | null = null;
  lastCompacted: DroppedCommandRange | undefined;
  /** Command seqs a pending attack/bow/entity-use is waiting on. */
  protectedCommandSeqs: ReadonlySet<number> = new Set();

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
        manualJump: false,
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
    this.items.push(command);
    this.lastEnqueuedSeq = command.commandSeq;
    this.compactToBudget();
    return 'ok';
  }

  /**
   * Forget queued pre-teleport movement without rewinding the seq high-water.
   * The sticky command becomes idle so the destination is not walked by the
   * last pre-teleport intent.
   */
  discardQueuedMovement(look?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.lastCompacted = undefined;
    const seq = this.lastEnqueuedSeq >= 0 ? this.lastEnqueuedSeq : (this.lastApplied?.commandSeq ?? 0);
    this.lastApplied = {
      commandSeq: seq,
      clientTick: this.lastApplied?.clientTick ?? seq,
      forward: 0,
      right: 0,
      jump: false,
      manualJump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      mining: false,
      use: false,
      vehicleForward: 0,
      yaw: look?.yaw ?? this.lastApplied?.yaw ?? 0,
      pitch: look?.pitch ?? this.lastApplied?.pitch ?? 0,
      selectedSlot: look?.selectedSlot ?? this.lastApplied?.selectedSlot ?? 0,
    };
  }

  private compactToBudget(): void {
    const beforeBudget = this.items.slice();
    const dropped = compactContinuousCommands(
      this.items,
      COMMAND_QUEUE_LATENCY_BUDGET,
      this.protectedCommandSeqs,
    );
    if (dropped && !this.acceptDropped(dropped)) {
      this.items.length = 0;
      this.items.push(...beforeBudget);
    }
    while (this.items.length > COMMAND_QUEUE_MAX) {
      const head = this.items[0];
      if (!head || this.protectedCommandSeqs.has(head.commandSeq)) break;
      const beforeCap = this.items.slice();
      this.items.shift();
      if (!this.acceptDropped({ fromCommandSeq: head.commandSeq, toCommandSeq: head.commandSeq })) {
        this.items.length = 0;
        this.items.push(...beforeCap);
        break;
      }
    }
  }

  /** Record a dropped span. A gap would lie about a kept command, so refuse it. */
  private acceptDropped(range: DroppedCommandRange): boolean {
    const merged = mergeDroppedRange(this.lastCompacted, range);
    if (!merged) return false;
    this.lastCompacted = merged;
    return true;
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

  find(commandSeq: number): PlayerCommand | undefined {
    if (this.lastApplied?.commandSeq === commandSeq) return this.lastApplied;
    return this.items.find((command) => command.commandSeq === commandSeq);
  }
}
