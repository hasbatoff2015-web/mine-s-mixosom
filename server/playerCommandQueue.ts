import type { PlayerCommand } from '../shared/playerCommand';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX } from '../shared/playerCommand';
import {
  MAX_ACTION_REJECT_SUFFIXES,
  compactContinuousCommands,
  mergeDroppedRange,
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
  /**
   * Set when another disjoint skip will not fit in `notifyRanges`.
   * Until the snapshot flush, every newer command extends this span and is refused,
   * even if a physics tick has freed a queue slot.
   */
  private notifyOverflow: DroppedCommandRange | undefined;
  /** Exact overload skips kept until reconnect or teleport so a late action does not wait. */
  private readonly overloadRanges: DroppedCommandRange[] = [];
  /**
   * Overflow episodes that did not fit in `overloadRanges`.
   * Survives the snapshot flush. Cleared on teleport and reconnect.
   */
  private readonly actionRejectSuffixes: DroppedCommandRange[] = [];
  /** Command seqs a pending attack/bow/entity-use is waiting on. */
  protectedCommandSeqs: ReadonlySet<number> = new Set();
  overloadRejects = 0;
  compactedCommands = 0;

  get length(): number {
    return this.items.length;
  }

  /** One entry when the pending notification is a single span and there is no suffix. */
  get lastCompacted(): DroppedCommandRange | undefined {
    if (this.notifyOverflow) return undefined;
    return this.notifyRanges.length === 1 ? this.notifyRanges[0] : undefined;
  }

  get skippedRanges(): readonly DroppedCommandRange[] {
    return this.notifyRanges;
  }

  /** Contiguous commands refused after the exact range list filled. Cleared on flush. */
  get skippedOverflow(): DroppedCommandRange | undefined {
    return this.notifyOverflow;
  }

  clear(keepLook?: { readonly yaw: number; readonly pitch: number; readonly selectedSlot: number }): void {
    this.items.length = 0;
    this.lastEnqueuedSeq = -1;
    this.notifyRanges.length = 0;
    this.notifyOverflow = undefined;
    this.overloadRanges.length = 0;
    this.actionRejectSuffixes.length = 0;
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
    if (this.notifyOverflow) {
      this.noteOverload(command.commandSeq);
      return 'overload';
    }
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
    this.notifyOverflow = undefined;
    this.overloadRanges.length = 0;
    this.actionRejectSuffixes.length = 0;
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

  /**
   * Snapshot has copied the pending spans. Admission resumes.
   * Action-classification history is kept for a late melee, bow, or entity-use.
   */
  clearNotifiedSkips(): void {
    this.notifyRanges.length = 0;
    this.notifyOverflow = undefined;
  }

  isQueued(commandSeq: number): boolean {
    return this.items.some((command) => command.commandSeq === commandSeq);
  }

  wasOverloadSkipped(commandSeq: number): boolean {
    const covers = (range: DroppedCommandRange) => commandSeq >= range.fromCommandSeq
      && commandSeq <= range.toCommandSeq;
    return this.overloadRanges.some(covers) || this.actionRejectSuffixes.some(covers);
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
    if (!recordDroppedRange(this.overloadRanges, range)) this.rememberActionSuffix(range);
    if (this.notifyOverflow) {
      this.notifyOverflow = {
        fromCommandSeq: this.notifyOverflow.fromCommandSeq,
        toCommandSeq: Math.max(this.notifyOverflow.toCommandSeq, commandSeq),
      };
      return;
    }
    if (!recordDroppedRange(this.notifyRanges, range)) this.notifyOverflow = range;
  }

  /** Keep a refused span that would not fit in the exact overload list. Bounded. */
  private rememberActionSuffix(range: DroppedCommandRange): void {
    let incoming = range;
    let index = 0;
    while (index < this.actionRejectSuffixes.length) {
      const merged = mergeDroppedRange(this.actionRejectSuffixes[index], incoming);
      if (!merged) {
        index += 1;
        continue;
      }
      this.actionRejectSuffixes.splice(index, 1);
      incoming = merged;
      index = 0;
    }
    if (this.actionRejectSuffixes.length >= MAX_ACTION_REJECT_SUFFIXES) {
      this.actionRejectSuffixes.shift();
    }
    this.actionRejectSuffixes.push(incoming);
    this.actionRejectSuffixes.sort((left, right) => left.fromCommandSeq - right.fromCommandSeq);
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
