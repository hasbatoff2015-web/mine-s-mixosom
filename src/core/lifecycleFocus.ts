import type { LifecycleState } from './Lifecycle';

export interface BlurBackgroundOptions {
  readonly documentHidden: boolean;
  readonly documentHasFocus: boolean;
  readonly pointerLocked?: boolean;
  readonly pointerLockRequestPending?: boolean;
  readonly suppressBackground?: boolean;
}

/**
 * Pointer-lock exit and focusing the chat field can fire `window.blur`
 * without the document actually losing OS focus. Pausing on that leaves
 * PLAYING stuck in BACKGROUND: mouse-look still renders, WASD never ticks.
 *
 * Respawn can also request pointer lock / canvas focus while the tab is
 * still visible. During that transition `document.hasFocus()` is often
 * false even though the player never left the game. Pointer-locked (or
 * lock-pending) visible tabs must keep `tickOnline` running.
 */
export function shouldEnterBackgroundFromBlur(options: BlurBackgroundOptions): boolean {
  if (options.documentHidden) return true;
  if (options.suppressBackground) return false;
  if (options.pointerLocked) return false;
  if (options.pointerLockRequestPending) return false;
  if (options.documentHasFocus) return false;
  return true;
}

export function shouldEnterBackgroundFromVisibility(hidden: boolean): boolean {
  return hidden;
}

export function shouldResumeFromBackground(options: {
  readonly state: LifecycleState;
  readonly documentHidden: boolean;
}): boolean {
  return options.state === 'BACKGROUND' && !options.documentHidden;
}
