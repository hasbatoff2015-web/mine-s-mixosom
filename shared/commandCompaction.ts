import type { PlayerCommand } from './playerCommand';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX } from './playerCommand';

/**
 * Continuous-state commands are compacted down to the latency budget.
 * `COMMAND_QUEUE_MAX` is the admission cap. A full queue rejects newer
 * commands instead of deleting an accepted edge.
 */
export const COMMAND_QUEUE_COMPACT_AT = COMMAND_QUEUE_LATENCY_BUDGET;
export { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX };

/** Snapshot payload cap. Adjacent skips merge, so a burst stays one range. */
export const MAX_SKIPPED_RANGES_PER_SNAPSHOT = 8;
/**
 * Action-classification suffixes that did not fit in the exact overload list.
 * One object per overflow episode. Older episodes drop when the cap is hit.
 */
export const MAX_ACTION_REJECT_SUFFIXES = 8;

export interface DroppedCommandRange {
  readonly fromCommandSeq: number;
  readonly toCommandSeq: number;
}

/**
 * Merge two dropped ranges only when they already form one solid span.
 * A gap means a command between them was kept or applied; reporting min..max
 * would make the client discard that command too.
 */
export function mergeDroppedRange(
  current: DroppedCommandRange | undefined,
  next: DroppedCommandRange,
): DroppedCommandRange | undefined {
  if (!current) return next;
  const overlapsOrAdjacent = next.fromCommandSeq <= current.toCommandSeq + 1
    && next.toCommandSeq >= current.fromCommandSeq - 1;
  if (!overlapsOrAdjacent) return undefined;
  return {
    fromCommandSeq: Math.min(current.fromCommandSeq, next.fromCommandSeq),
    toCommandSeq: Math.max(current.toCommandSeq, next.toCommandSeq),
  };
}

/**
 * Record `range` into `ranges`, merging only adjacent or overlapping spans.
 * Returns false when a new disjoint span would exceed `maxRanges`.
 * The caller must not invent a min..max across the gap.
 */
export function recordDroppedRange(
  ranges: DroppedCommandRange[],
  range: DroppedCommandRange,
  maxRanges = MAX_SKIPPED_RANGES_PER_SNAPSHOT,
): boolean {
  let incoming = range;
  let index = 0;
  while (index < ranges.length) {
    const merged = mergeDroppedRange(ranges[index], incoming);
    if (!merged) {
      index += 1;
      continue;
    }
    ranges.splice(index, 1);
    incoming = merged;
    index = 0;
  }
  if (ranges.length >= maxRanges) return false;
  ranges.push(incoming);
  ranges.sort((left, right) => left.fromCommandSeq - right.fromCommandSeq);
  return true;
}

/** True when dropping `older` would lose an edge-sensitive transition into `newer`. */
export function commandEdgeSensitive(older: PlayerCommand, newer: PlayerCommand): boolean {
  return older.jump !== newer.jump
    || (older.manualJump === true) !== (newer.manualJump === true)
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
 * Drop a contiguous continuous prefix from the head until `maxLength`.
 * Stops at an edge, a protected command, or the newest retained tail.
 * Never removes a command from the middle. A later overload skip is a
 * separate range, not a min..max across commands that stayed queued.
 */
export function compactContinuousCommands(
  items: PlayerCommand[],
  maxLength = COMMAND_QUEUE_LATENCY_BUDGET,
  protectedSeqs?: ReadonlySet<number>,
): DroppedCommandRange | undefined {
  const removed: PlayerCommand[] = [];
  while (items.length > maxLength) {
    const older = items[0];
    const newer = items[1];
    if (!older || !newer) break;
    if (protectedSeqs?.has(older.commandSeq)) break;
    if (commandEdgeSensitive(older, newer)) break;
    const dropped = items.shift();
    if (!dropped) break;
    removed.push(dropped);
  }
  const first = removed[0];
  const last = removed[removed.length - 1];
  if (!first || !last) return undefined;
  return { fromCommandSeq: first.commandSeq, toCommandSeq: last.commandSeq };
}
