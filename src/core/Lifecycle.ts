import { Signal } from './events';

export type LifecycleState = 'LOADING' | 'LOADING_WORLD' | 'MENU' | 'PLAYING' | 'PAUSED' | 'AD' | 'BACKGROUND' | 'DEAD';

export class GameLifecycleManager {
  readonly changed = new Signal<LifecycleState>();
  private previous: LifecycleState = 'LOADING';
  state: LifecycleState = 'LOADING';

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state !== 'BACKGROUND') this.previous = this.state;
        this.setState('BACKGROUND');
      } else if (this.state === 'BACKGROUND') {
        this.setState(this.previous === 'PLAYING' ? 'PLAYING' : this.previous);
      }
    });
    window.addEventListener('blur', () => {
      if (this.state === 'PLAYING') {
        this.previous = this.state;
        this.setState('BACKGROUND');
      }
    });
    window.addEventListener('focus', () => {
      if (this.state === 'BACKGROUND' && !document.hidden) {
        this.setState(this.previous === 'PLAYING' ? 'PLAYING' : this.previous);
      }
    });
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
