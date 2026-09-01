import { Signal } from './events';
import {
  shouldEnterBackgroundFromBlur,
  shouldEnterBackgroundFromVisibility,
  shouldResumeFromBackground,
} from './lifecycleFocus';
import type { LifecycleState } from './lifecycleTypes';

export type { LifecycleState } from './lifecycleTypes';

export interface LifecycleBlurContext {
  readonly pointerLocked: boolean;
  readonly pointerLockRequestPending: boolean;
}

const RESPAWN_RESTORE_GUARD_MS = 400;

export class GameLifecycleManager {
  readonly changed = new Signal<LifecycleState>();
  private previous: LifecycleState = 'LOADING';
  state: LifecycleState = 'LOADING';
  private suppressBlurBackground = false;
  private restoreGuardTimer: number | undefined;
  private blurContext: () => LifecycleBlurContext = () => ({
    pointerLocked: typeof document !== 'undefined' && Boolean(document.pointerLockElement),
    pointerLockRequestPending: false,
  });

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (shouldEnterBackgroundFromVisibility(document.hidden)) {
        if (this.state !== 'BACKGROUND') this.previous = this.state;
        this.setState('BACKGROUND');
      } else if (shouldResumeFromBackground({ state: this.state, documentHidden: document.hidden })) {
        this.setState(this.previous === 'PLAYING' ? 'PLAYING' : this.previous);
      }
    });
    window.addEventListener('blur', () => {
      if (this.state !== 'PLAYING') return;
      const hidden = document.hidden;
      const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      queueMicrotask(() => {
        if (this.state !== 'PLAYING') return;
        const stillHidden = document.hidden;
        const stillFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : hasFocus;
        const context = this.blurContext();
        if (!shouldEnterBackgroundFromBlur({
          documentHidden: stillHidden || hidden,
          documentHasFocus: stillFocused,
          pointerLocked: context.pointerLocked,
          pointerLockRequestPending: context.pointerLockRequestPending,
          suppressBackground: this.suppressBlurBackground,
        })) return;
        this.previous = this.state;
        this.setState('BACKGROUND');
      });
    });
    window.addEventListener('focus', () => {
      if (shouldResumeFromBackground({ state: this.state, documentHidden: document.hidden })) {
        this.setState(this.previous === 'PLAYING' ? 'PLAYING' : this.previous);
      }
    });
  }

  setBlurContext(query: () => LifecycleBlurContext): void {
    this.blurContext = query;
  }

  /** Hold BACKGROUND off while respawn restores pointer lock / canvas focus. */
  beginOnlineRespawnRestore(): void {
    this.suppressBlurBackground = true;
    if (typeof window === 'undefined') return;
    if (this.restoreGuardTimer !== undefined) window.clearTimeout(this.restoreGuardTimer);
    this.restoreGuardTimer = window.setTimeout(() => this.endOnlineRespawnRestore(), RESPAWN_RESTORE_GUARD_MS);
  }

  endOnlineRespawnRestore(): void {
    this.suppressBlurBackground = false;
    if (this.restoreGuardTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(this.restoreGuardTimer);
      this.restoreGuardTimer = undefined;
    }
  }

  /** Pointer lock / chat close / canvas click: leave BACKGROUND while the tab is visible. */
  resumePlayingIfVisible(): void {
    if (!shouldResumeFromBackground({ state: this.state, documentHidden: document.hidden })) return;
    this.setState(this.previous === 'PLAYING' ? 'PLAYING' : this.previous);
  }

  setState(state: LifecycleState): void {
    if (state === this.state) return;
    if (this.state !== 'BACKGROUND') this.previous = this.state;
    this.state = state;
    this.changed.emit(state);
  }

  get simulating(): boolean {
    return this.state === 'PLAYING';
  }
}
