export type PointerUnlockReason = 'escape' | 'programmatic' | 'focus-lost' | 'unknown';

export interface PointerLockCaptureState {
  readonly canCapture: boolean;
  readonly coarsePointer: boolean;
  readonly lockedToCanvas: boolean;
}

export interface PointerUnlockClassification {
  readonly previouslyLocked: boolean;
  readonly nowLocked: boolean;
  readonly programmaticReleasePending: boolean;
  readonly documentHidden: boolean;
  readonly documentHasFocus: boolean;
}

export interface PointerLockFallbackState {
  readonly playing: boolean;
  readonly inventoryOpen: boolean;
  readonly coarsePointer: boolean;
  readonly lockedToCanvas: boolean;
  readonly lastRequestFailed: boolean;
}

/** Never auto-retry; a real user click must issue the next request. */
export const POINTER_LOCK_AUTO_RETRY = false;

/**
 * Desktop look capture after a gameplay overlay actually closes.
 * Inventory/pause/menu keep `canCapture` false, so this never steals the cursor
 * while a modal or pause screen is open.
 */
export function shouldRequestPointerLock(state: PointerLockCaptureState): boolean {
  return state.canCapture && !state.coarsePointer && !state.lockedToCanvas;
}

export function applyPointerLockRequest(state: PointerLockCaptureState, request: () => void): boolean {
  if (!shouldRequestPointerLock(state)) return false;
  request();
  return true;
}

export function isCoarsePointerMedia(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Skip a second exit when the browser already unlocked (Esc default gesture). */
export function shouldExitPointerLock(lockedToCanvas: boolean): boolean {
  return lockedToCanvas;
}

/** Esc while locked is the browser unlock gesture; do not also toggle pause. */
export function shouldIgnoreEscapeKeydown(lockedToCanvas: boolean): boolean {
  return lockedToCanvas;
}

export function classifyPointerUnlock(event: PointerUnlockClassification): PointerUnlockReason | null {
  if (!event.previouslyLocked || event.nowLocked) return null;
  if (event.programmaticReleasePending) return 'programmatic';
  if (event.documentHidden || !event.documentHasFocus) return 'focus-lost';
  return 'escape';
}

export function shouldOpenPauseOnUnlock(
  reason: PointerUnlockReason,
  playing: boolean,
  inventoryOpen: boolean,
): boolean {
  return reason === 'escape' && playing && !inventoryOpen;
}

export function shouldShowPointerLockFallback(state: PointerLockFallbackState): boolean {
  return state.playing
    && !state.inventoryOpen
    && !state.coarsePointer
    && !state.lockedToCanvas
    && state.lastRequestFailed;
}
