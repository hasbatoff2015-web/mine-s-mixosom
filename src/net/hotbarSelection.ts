/** Optimistic hotbar select vs authoritative inventory echo. */

export interface PendingHotbarSelect {
  readonly slot: number;
  /** Last input seq already sent when the player pressed 1–9. The new slot goes out on seq+1. */
  readonly sinceInputSeq: number;
}

export function noteHotbarSelect(inputSeq: number, slot: number): PendingHotbarSelect {
  return { slot, sinceInputSeq: inputSeq };
}

/**
 * Keep the local 1–9 selection until the server has applied a command that
 * advertised it. An inventory flush from an earlier use/place must not roll back.
 */
export function resolveHotbarSelection(
  pending: PendingHotbarSelect | undefined,
  serverSlot: number,
  lastAckedSeq: number,
): { slot: number; pending: PendingHotbarSelect | undefined } {
  if (!pending) return { slot: serverSlot, pending: undefined };
  if (serverSlot === pending.slot) return { slot: serverSlot, pending: undefined };
  if (lastAckedSeq >= pending.sinceInputSeq + 1) return { slot: serverSlot, pending: undefined };
  return { slot: pending.slot, pending };
}
