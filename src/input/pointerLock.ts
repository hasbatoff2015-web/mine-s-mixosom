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
  readonly escapePressed?: boolean;
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

/**
 * Resume PLAYING (BACKGROUND after a respawn/focus race) before deciding
 * whether the newly acquired lock is legal. Inventory/pause still release.
 */
export function shouldReleasePointerLockAfterAcquire(canCapture: boolean): boolean {
  return !canCapture;
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

/** Chat/search fields own Escape; do not also open pause after they close. */
export function shouldTogglePauseOnEscapeKeydown(
  typing: boolean,
  lockedToCanvas: boolean,
  swallowEscapeKeyup: boolean,
): boolean {
  if (shouldIgnoreEscapeKeydown(lockedToCanvas) || swallowEscapeKeyup) return false;
  return !typing;
}

export function classifyPointerUnlock(event: PointerUnlockClassification): PointerUnlockReason | null {
  if (!event.previouslyLocked || event.nowLocked) return null;
  if (event.programmaticReleasePending) return 'programmatic';
  if (event.documentHidden || !event.documentHasFocus) return 'focus-lost';
  return event.escapePressed ? 'escape' : 'unknown';
}

export function shouldOpenPauseOnUnlock(
  reason: PointerUnlockReason,
  playing: boolean,
  overlayOpen: boolean,
): boolean {
  return reason === 'escape' && playing && !overlayOpen;
}

export function shouldShowPointerLockFallback(state: PointerLockFallbackState): boolean {
  return state.playing
    && !state.inventoryOpen
    && !state.coarsePointer
    && !state.lockedToCanvas
    && state.lastRequestFailed;
}

type LockRequest = (options?: { unadjustedMovement: boolean }) => Promise<void> | void;

/** One gesture-owned attempt, with at most one plain fallback. Events own lock
 * success; promise rejection supplies the reason (pointerlockerror has none).
 */
export class PointerLockAttempt {
  rawRequested = false;
  fallbackUsed = false;
  private finished = false;
  private promiseBased = false;
  private generation = 0;
  constructor(private readonly request: LockRequest, private readonly failed: () => void,
    private readonly canFallback: () => boolean = () => true) {}

  start(): void { this.rawRequested = true; this.issue(true); }
  finish(): void { this.finished = true; }
  handleErrorEvent(): void {
    if (!this.promiseBased) this.fail();
  }

  private issue(raw: boolean): void {
    const generation = ++this.generation;
    this.promiseBased = false;
    try {
      const pending = this.request(raw ? { unadjustedMovement: true } : undefined);
      if (pending && typeof pending.then === 'function') {
        this.promiseBased = true;
        void pending.catch((error: unknown) => {
          if (generation === this.generation) this.reject(error, raw);
        });
      }
    } catch (error) { this.reject(error, raw); }
  }

  private reject(error: unknown, raw: boolean): void {
    if (this.finished) return;
    const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
    if (raw && !this.fallbackUsed && (name === 'NotSupportedError' || name === 'TypeError') && this.canFallback()) {
      this.fallbackUsed = true;
      this.issue(false);
    } else this.fail();
  }

  private fail(): void {
    if (this.finished) return;
    this.finished = true;
    this.failed();
  }
}
