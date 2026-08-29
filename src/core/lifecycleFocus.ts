import type { LifecycleState } from './Lifecycle';

/**
 * Pointer-lock exit and focusing the chat field can fire `window.blur`
 * without the document actually losing OS focus. Pausing on that leaves
 * PLAYING stuck in BACKGROUND: mouse-look still renders, WASD never ticks.
 */
export function shouldEnterBackgroundFromBlur(options: {
  readonly documentHidden: boolean;
  readonly documentHasFocus: boolean;
}): boolean {
  if (options.documentHidden) return true;
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
