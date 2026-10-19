import {
  emoteDurationSeconds,
  emoteMovementInterrupts,
  emoteSectorFromPointer,
  type EmoteId,
  type EmoteMoveIntent,
} from '../../shared/emotes';

export type EmotePhase = 'idle' | 'wheel' | 'playing';

/**
 * Local cosmetic session. Pointer lock, camera, and network stay with the caller.
 * A second open is ignored while a wheel or an emote is already active.
 */
export class EmoteSession {
  private phase: EmotePhase = 'idle';
  private selectedId: EmoteId | null = null;
  private playingId: EmoteId | null = null;
  private elapsedSeconds = 0;
  /** Pixels from the wheel center. Every open starts at the hub. */
  private pointerX = 0;
  private pointerY = 0;

  get phaseName(): EmotePhase {
    return this.phase;
  }

  get selected(): EmoteId | null {
    return this.phase === 'wheel' ? this.selectedId : null;
  }

  get playing(): EmoteId | null {
    return this.phase === 'playing' ? this.playingId : null;
  }

  get elapsed(): number {
    return this.phase === 'playing' ? this.elapsedSeconds : 0;
  }

  get forcesThirdPerson(): boolean {
    return this.phase === 'playing';
  }

  /** Wheel only. Playback still reads movement so the player can cancel it. */
  get blocksMovement(): boolean {
    return this.phase === 'wheel';
  }

  /** Wheel and playback both swallow primary-hand actions. */
  get blocksPrimaryHand(): boolean {
    return this.phase !== 'idle';
  }

  /** Offset from the hub. Zero means the cancel circle, not a sector. */
  get pointer(): { readonly x: number; readonly y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  tryOpen(allowed: boolean): boolean {
    if (!allowed || this.phase !== 'idle') return false;
    this.phase = 'wheel';
    this.selectedId = null;
    this.playingId = null;
    this.elapsedSeconds = 0;
    this.pointerX = 0;
    this.pointerY = 0;
    return true;
  }

  point(dx: number, dy: number, radius: number): EmoteId | null {
    if (this.phase !== 'wheel') return null;
    this.pointerX = Number.isFinite(dx) ? dx : 0;
    this.pointerY = Number.isFinite(dy) ? dy : 0;
    this.selectedId = emoteSectorFromPointer(this.pointerX, this.pointerY, radius);
    return this.selectedId;
  }

  /**
   * One pointer-lock sample. The wheel opens at the hub, so a leftover
   * screen coordinate cannot select a sector before the player moves.
   */
  nudgePointer(dx: number, dy: number, radius: number): EmoteId | null {
    if (this.phase !== 'wheel') return null;
    if (Number.isFinite(dx)) this.pointerX += dx;
    if (Number.isFinite(dy)) this.pointerY += dy;
    const limit = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const distance = Math.hypot(this.pointerX, this.pointerY);
    if (limit > 0 && distance > limit) {
      const scale = limit / distance;
      this.pointerX *= scale;
      this.pointerY *= scale;
    }
    this.selectedId = emoteSectorFromPointer(this.pointerX, this.pointerY, radius);
    return this.selectedId;
  }

  /** Close the wheel. Returns the emote that should start, if one was selected. */
  release(): EmoteId | null {
    if (this.phase !== 'wheel') return null;
    const selected = this.selectedId;
    this.selectedId = null;
    if (!selected) {
      this.phase = 'idle';
      this.playingId = null;
      this.elapsedSeconds = 0;
      this.pointerX = 0;
      this.pointerY = 0;
      return null;
    }
    this.phase = 'playing';
    this.playingId = selected;
    this.elapsedSeconds = 0;
    return selected;
  }

  /**
   * Render-frame playback. Movement is the player's intent, not simulated speed.
   * Returns `finished` or `interrupted` after the session is already idle.
   */
  advance(deltaSeconds: number, movement: EmoteMoveIntent): 'idle' | 'playing' | 'finished' | 'interrupted' {
    if (this.phase !== 'playing' || !this.playingId) return 'idle';
    if (emoteMovementInterrupts(movement)) {
      this.clear();
      return 'interrupted';
    }
    const delta = Math.min(0.1, Math.max(0, deltaSeconds));
    this.elapsedSeconds += delta;
    if (this.elapsedSeconds >= emoteDurationSeconds(this.playingId)) {
      this.clear();
      return 'finished';
    }
    return 'playing';
  }

  /** Drop the wheel or the playback. Returns the phase that was active. */
  cancel(): EmotePhase | 'idle' {
    const previous = this.phase;
    this.clear();
    return previous;
  }

  private clear(): void {
    this.phase = 'idle';
    this.selectedId = null;
    this.playingId = null;
    this.elapsedSeconds = 0;
    this.pointerX = 0;
    this.pointerY = 0;
  }
}
