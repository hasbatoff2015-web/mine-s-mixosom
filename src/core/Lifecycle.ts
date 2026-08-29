import { Signal } from './events';
import {
  shouldEnterBackgroundFromBlur,
  shouldEnterBackgroundFromVisibility,
  shouldResumeFromBackground,
} from './lifecycleFocus';

export type LifecycleState = 'LOADING' | 'LOADING_WORLD' | 'MENU' | 'PLAYING' | 'PAUSED' | 'AD' | 'BACKGROUND' | 'DEAD';

export class GameLifecycleManager {
  readonly changed = new Signal<LifecycleState>();
  private previous: LifecycleState = 'LOADING';
  state: LifecycleState = 'LOADING';

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
        if (!shouldEnterBackgroundFromBlur({
          documentHidden: stillHidden || hidden,
          documentHasFocus: stillFocused,
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
