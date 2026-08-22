export interface PointerLockCaptureState {
  readonly canCapture: boolean;
  readonly coarsePointer: boolean;
  readonly lockedToCanvas: boolean;
}

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
