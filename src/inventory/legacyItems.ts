/** Only the removed item is discarded. Unknown/corrupt items retain validation. */
export function migrateLegacyStack<T>(stack: T): T | null {
  return stack !== null && typeof stack === 'object' && 'itemId' in stack
    && stack.itemId === 'shield' ? null : stack;
}
