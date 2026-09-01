/**
 * Shared lifecycle labels. The GameLifecycleManager that talks to
 * `document` / `window` stays client-only in `Lifecycle.ts`.
 */
export type LifecycleState =
  | 'LOADING'
  | 'LOADING_WORLD'
  | 'MENU'
  | 'PLAYING'
  | 'PAUSED'
  | 'AD'
  | 'BACKGROUND'
  | 'DEAD';
