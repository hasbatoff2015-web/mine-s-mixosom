/** Same rounding as a right-click half pickup: 64 → 32, 7 → 4, 1 → 1. */
export function initialStackAmount(count: number): number {
  if (!Number.isInteger(count) || count < 1) return 1;
  return Math.ceil(count / 2);
}

/**
 * Split keeps a remainder in the source and needs an empty regular slot.
 * Drop stays available when this is false.
 */
export function splitAmountAllowed(selected: number, sourceCount: number, hasEmptySlot: boolean): boolean {
  return hasEmptySlot
    && Number.isInteger(selected)
    && Number.isInteger(sourceCount)
    && selected >= 1
    && selected < sourceCount;
}
