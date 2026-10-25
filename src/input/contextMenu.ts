/** Gameplay swallows the browser menu. Text fields keep selection, copy, and paste. */
export function shouldSuppressContextMenu(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return false;
  return true;
}
