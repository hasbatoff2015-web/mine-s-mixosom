import type { PlayerCommand } from './playerCommand';
import { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX } from './playerCommand';

/**
 * Continuous-state commands are compacted down to the latency budget.
 * `COMMAND_QUEUE_MAX` remains the hard safety cap only.
 */
export const COMMAND_QUEUE_COMPACT_AT = COMMAND_QUEUE_LATENCY_BUDGET;
export { COMMAND_QUEUE_LATENCY_BUDGET, COMMAND_QUEUE_MAX };

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
 * Never removes a command from the middle: one `queueCompacted` range can
 * only describe a solid seq span.
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
