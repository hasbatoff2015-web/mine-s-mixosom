import type { PlayerCommand } from '../shared/playerCommand';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX } from '../shared/playerCommand';
import {
  compactContinuousCommands,
  recordDroppedRange,
  type DroppedCommandRange,
} from '../shared/commandCompaction';

/**
 * FIFO of movement commands. One command is applied per physics tick.
 * Empty queue repeats the last applied command (hold W / idle).
 *
 * Soft path: a contiguous continuous prefix compacts to the latency budget.
 * Edges and pinned action seqs stay.
 *
 * Hard path: once the queue is at `COMMAND_QUEUE_MAX` and the prefix cannot
 * shrink further, the new command is rejected. Accepted edges are not shifted
 * off the head. `lastEnqueuedSeq` is the highest seq presented to the queue,
 * including those rejects, so a duplicate of a skipped seq is not admitted
 * and a later higher seq still is.
 */
export class PlayerCommandQueue {
  private readonly items: PlayerCommand[] = [];
  /** Highest seq observed here, including overload skips. Not a queued-only watermark. */
  lastEnqueuedSeq = -1;
  lastApplied: PlayerCommand | null = null;
  /** Spans the client has not been told about yet. Cleared after the snapshot flush. */
  private readonly notifyRanges: DroppedCommandRange[] = [];
  /** Overload skips kept until reconnect or teleport so a late action does not wait. */
  private readonly overloadRanges: DroppedCommandRange[] = [];
  /** Command seqs a pending attack/bow/entity-use is waiting on. */
  protectedCommandSeqs: ReadonlySet<number> = new Set();
  overloadRejects = 0;
  compactedCommands = 0;

  get length(): number {
    return this.items.length;
  }

  /** One entry when the pending notification is a single span. Older snapshots use this. */
  get lastCompacted(): DroppedCommandRange | undefined {
    return this.notifyRanges.length === 1 ? this.notifyRanges[0] : undefined;
  }

  get skippedRanges(): readonly DroppedCommandRange[] {
    return this.notifyRanges;
  }

  clear(keepLook?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.lastEnqueuedSeq = -1;
    this.notifyRanges.length = 0;
    this.overloadRanges.length = 0;
    this.overloadRejects = 0;
    this.compactedCommands = 0;
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

  enqueue(command: PlayerCommand): 'ok' | 'stale' | 'duplicate' | 'overload' {
    if (command.commandSeq < this.lastEnqueuedSeq) return 'stale';
    if (command.commandSeq === this.lastEnqueuedSeq) return 'duplicate';
    this.lastEnqueuedSeq = command.commandSeq;
    this.items.push(command);
    this.compactToBudget();
    if (this.items.length <= COMMAND_QUEUE_MAX) return 'ok';
    const tail = this.items[this.items.length - 1];
    if (tail?.commandSeq === command.commandSeq) this.items.pop();
    this.noteOverload(command.commandSeq);
    return 'overload';
  }

  /**
   * Forget queued pre-teleport movement without rewinding the seq high-water.
   * The sticky command becomes idle so the destination is not walked by the
   * last pre-teleport intent.
   */
  discardQueuedMovement(look?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.notifyRanges.length = 0;
    this.overloadRanges.length = 0;
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

  /** Snapshot has copied the pending spans. Do not repeat them on the next flush. */
  clearNotifiedSkips(): void {
    this.notifyRanges.length = 0;
  }

  isQueued(commandSeq: number): boolean {
    return this.items.some((command) => command.commandSeq === commandSeq);
  }

  wasOverloadSkipped(commandSeq: number): boolean {
    return this.overloadRanges.some(
      (range) => commandSeq >= range.fromCommandSeq && commandSeq <= range.toCommandSeq,
    );
  }

  private compactToBudget(): void {
    const beforeBudget = this.items.slice();
    const dropped = compactContinuousCommands(
      this.items,
      COMMAND_QUEUE_LATENCY_BUDGET,
      this.protectedCommandSeqs,
    );
    if (!dropped) return;
    if (!recordDroppedRange(this.notifyRanges, dropped)) {
      this.items.length = 0;
      this.items.push(...beforeBudget);
      return;
    }
    this.compactedCommands += dropped.toCommandSeq - dropped.fromCommandSeq + 1;
  }

  private noteOverload(commandSeq: number): void {
    this.overloadRejects += 1;
    const range = { fromCommandSeq: commandSeq, toCommandSeq: commandSeq };
    recordDroppedRange(this.overloadRanges, range);
    recordDroppedRange(this.notifyRanges, range);
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
