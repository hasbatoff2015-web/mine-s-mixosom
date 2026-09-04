import type { PlayerCommand } from './playerCommand';
import { COMMAND_QUEUE_MAX } from './playerCommand';

/** Compact continuous-state commands when the FIFO would overflow. */
export const COMMAND_QUEUE_COMPACT_AT = COMMAND_QUEUE_MAX;

export interface DroppedCommandRange {
  readonly fromCommandSeq: number;
  readonly toCommandSeq: number;
}

export function mergeDroppedRange(
  current: DroppedCommandRange | undefined,
  next: DroppedCommandRange,
): DroppedCommandRange {
  if (!current) return next;
  return {
    fromCommandSeq: Math.min(current.fromCommandSeq, next.fromCommandSeq),
    toCommandSeq: Math.max(current.toCommandSeq, next.toCommandSeq),
  };
}

/** True when dropping `older` would lose an edge-sensitive transition into `newer`. */
export function commandEdgeSensitive(older: PlayerCommand, newer: PlayerCommand): boolean {
  return older.jump !== newer.jump
    || Boolean(older.use) !== Boolean(newer.use)
    || Boolean(older.mining) !== Boolean(newer.mining)
    || older.sneak !== newer.sneak
    || older.sprint !== newer.sprint
    || older.descend !== newer.descend
    || older.flySprint !== newer.flySprint
    || older.selectedSlot !== newer.selectedSlot
    || (older.vehicleForward ?? 0) !== (newer.vehicleForward ?? 0);
}

/**
 * Drop older commands whose only difference vs the next is continuous WASD/look.
 * Keeps jump/use/mining/slot/flight/vehicle edges. Mutates `items` in place.
 */
export function compactContinuousCommands(items: PlayerCommand[]): DroppedCommandRange | undefined {
  let dropped: DroppedCommandRange | undefined;
  let i = 0;
  while (i + 1 < items.length) {
    const older = items[i];
    const newer = items[i + 1];
    if (!older || !newer || commandEdgeSensitive(older, newer)) {
      i += 1;
      continue;
    }
    items.splice(i, 1);
    dropped = mergeDroppedRange(dropped, {
      fromCommandSeq: older.commandSeq,
      toCommandSeq: older.commandSeq,
    });
  }
  return dropped;
}
