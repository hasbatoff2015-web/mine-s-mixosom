import { clamp } from '../core/constants';
import {
  applyPointerLockRequest,
  classifyPointerUnlock,
  isCoarsePointerMedia,
  shouldExitPointerLock,
  shouldTogglePauseOnEscapeKeydown,
  type PointerUnlockReason,
  PointerLockAttempt,
} from './pointerLock';
import { PointerMotionFilter } from './pointerMotion';
import { shouldBlurStaleTextField, shouldCaptureGameplayKey } from './gameplayKeys';

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export const DESKTOP_SPRINT_CODES = ['ShiftLeft', 'ShiftRight'] as const;
export const DESKTOP_SNEAK_CODE = 'KeyC';
export const DESKTOP_FLY_SPRINT_CODES = ['ControlLeft', 'ControlRight'] as const;

export interface InputCallbacks {
  canCapture(): boolean;
  toggleInventory(): void;
  togglePause(): void;
  openChat(prefix?: string): void;
  dropItem(): void;
  selectHotbar(index: number): void;
  onPointerLockAcquired(): void;
  onPointerLockReleased(reason: PointerUnlockReason): void;
  onPointerLockRequestFailed(): void;
  isChatOpen?(): boolean;
}

export interface MoveInput {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  /** Shift while flying: descend. Optional so older tests stay valid. */
  descend?: boolean;
  /** Ctrl while flying: faster horizontal flight. */
  flySprint?: boolean;
}

export class InputManager {
  yaw = 0;
  pitch = 0;
  mining = false;
  using = false;
  private attackPresses = 0;
  usePressed = false;
  lastUnlockReason: PointerUnlockReason = 'unknown';
  private readonly keys = new Set<string>();
  private touchForward = 0;
  private touchRight = 0;
  private touchJump = false;
  private touchSprint = false;
  private touchSneak = false;
  private activeLookPointer?: number;
  private lastLookX = 0;
  private lastLookY = 0;
  private sensitivity = 0.0022;
  private lockedToCanvas = false;
  private programmaticReleasePending = false;
  private requestPending = false;
  private swallowEscapeKeyup = false;
  private escapePressed = false;
  private readonly pointerMotion = new PointerMotionFilter();
  private lockAttempt?: PointerLockAttempt;
  private lockChanges = 0;
  private lockErrors = 0;
  private inputDebug?: HTMLPreElement;
  private inputDebugTimer?: number;
  private readonly recentDeltas: Array<readonly [number, number]> = [];
  private inputEvents = 0;
  private inputEpoch = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    this.bindDesktop();
    this.bindTouch();
    this.bindPointerLock();
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('inputDebug') === '1') {
      this.inputDebug = document.createElement('pre');
      this.inputDebug.id = 'input-debug';
      this.inputDebug.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;pointer-events:none;background:#000c;color:#fff;padding:8px;font:12px monospace';
      document.body.append(this.inputDebug);
      this.inputEpoch = performance.now();
      this.inputDebugTimer = window.setInterval(() => this.refreshInputDebug(), 250);
    }
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.0005, 0.006);
  }

  movement(): MoveInput {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) + this.touchForward;
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.touchRight;
    const length = Math.hypot(forward, right);
    return {
      forward: length > 1 ? forward / length : forward,
      right: length > 1 ? right / length : right,
      jump: this.keys.has('Space') || this.touchJump,
      sprint: DESKTOP_SPRINT_CODES.some((code) => this.keys.has(code)) || this.touchSprint,
      sneak: this.keys.has(DESKTOP_SNEAK_CODE) || this.touchSneak,
      descend: DESKTOP_SPRINT_CODES.some((code) => this.keys.has(code)),
      flySprint: DESKTOP_FLY_SPRINT_CODES.some((code) => this.keys.has(code)),
    };
  }

  get attackPressed(): boolean { return this.attackPresses > 0; }

  set attackPressed(pressed: boolean) {
    if (pressed) this.attackPresses += 1;
    else this.attackPresses = 0;
  }

  disposeDebug(): void {
    if (this.inputDebugTimer !== undefined) window.clearInterval(this.inputDebugTimer);
    this.inputDebug?.remove();
    this.inputDebug = undefined;
  }

  /** Retain every click between fixed ticks; no cooldown or artificial CPS cap. */
  consumeAttackPresses(): number {
    const count = this.attackPresses;
    this.attackPresses = 0;
    return count;
  }

  consumeAttackPressed(): boolean {
    return this.consumeAttackPresses() > 0;
  }

  consumeUsePressed(): boolean {
    const value = this.usePressed;
    this.usePressed = false;
    return value;
  }

  releaseActions(): void {
    this.mining = false;
    this.using = false;
    this.attackPressed = false;
    this.usePressed = false;
    this.touchJump = false;
  }

  /** Drop held WASD/Space/Shift so a lost keyup cannot stick, and so chat cannot leave W=true. */
  clearHeldKeys(): void {
    this.keys.clear();
    this.touchForward = 0;
    this.touchRight = 0;
    this.touchJump = false;
    this.touchSprint = false;
    this.touchSneak = false;
    this.releaseActions();
  }

  isPointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
  }

  /**
   * Programmatic unlock (inventory/death/pause while still locked).
   * No-op if the pointer is already free — avoids a second exit after Esc.
   */
  releasePointerLock(): void {
    this.lockAttempt?.finish();
    this.requestPending = false;
    this.resetPointerSession();
    if (!shouldExitPointerLock(this.isPointerLocked())) return;
    this.programmaticReleasePending = true;
    document.exitPointerLock?.();
  }

  /**
   * Re-enter mouse-look after a gameplay overlay closes.
   * Returns whether a lock request was issued. Failure is reported asynchronously.
   */
  tryRequestPointerLock(): boolean {
    if (this.requestPending) return false;
    return applyPointerLockRequest({
      canCapture: this.callbacks.canCapture(),
      coarsePointer: isCoarsePointerMedia(),
      lockedToCanvas: this.isPointerLocked(),
    }, () => {
      if (typeof this.canvas.requestPointerLock !== 'function') {
        this.callbacks.onPointerLockRequestFailed();
        return;
      }
      this.requestPending = true;
      this.lockAttempt = new PointerLockAttempt(
        (options) => (this.canvas.requestPointerLock as (options?: { unadjustedMovement: boolean }) => Promise<void> | void).call(this.canvas, options),
        () => this.notifyRequestFailure(),
        () => this.callbacks.canCapture() && !document.hidden && document.hasFocus(),
      );
      this.lockAttempt.start();
    });
  }

  private bindDesktop(): void {
    window.addEventListener('keydown', (event) => {
      const typing = isTypingElement(event.target);
      if (event.code === 'KeyE' && !event.repeat) {
        if (typing) return;
        event.preventDefault();
        this.callbacks.toggleInventory();
        return;
      }
      if (event.code === 'Escape' && !event.repeat) {
        if (this.isPointerLocked()) this.escapePressed = true;
        if (!shouldTogglePauseOnEscapeKeydown(typing, this.isPointerLocked(), this.swallowEscapeKeyup)) return;
        this.callbacks.togglePause();
        return;
      }
      if (typing) {
        const chatOpen = this.callbacks.isChatOpen?.() === true;
        if (!shouldCaptureGameplayKey({ typingInField: true, chatOpen })) return;
        if (shouldBlurStaleTextField({ typingInField: true, chatOpen })) {
          if (event.target instanceof HTMLElement) event.target.blur();
        } else {
          return;
        }
      }
      if ((event.code === 'KeyT' || event.key === '/') && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.callbacks.openChat(event.key === '/' ? '/' : '');
        return;
      }
      if (event.code === 'KeyQ' && !event.repeat) {
        this.callbacks.dropItem();
        return;
      }
      if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
        this.callbacks.selectHotbar(Number(event.code.slice(-1)) - 1);
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Escape') this.swallowEscapeKeyup = false;
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.resetPointerSession();
      this.lockAttempt?.finish();
      this.requestPending = false;
      this.clearHeldKeys();
    });
    document.addEventListener('visibilitychange', () => {
      this.resetPointerSession();
      if (document.hidden) {
        this.clearHeldKeys();
        this.lockAttempt?.finish();
        this.requestPending = false;
      }
    });

    this.canvas.addEventListener('click', () => this.tryRequestPointerLock());
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (this.inputDebug) {
        this.inputEvents++;
        this.recentDeltas.push([event.movementX, event.movementY]);
        if (this.recentDeltas.length > 16) this.recentDeltas.shift();
      }
      const [dx, dy] = this.pointerMotion.accept(event.movementX, event.movementY);
      this.rotate(dx, dy);
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (!this.callbacks.canCapture()) return;
      if (event.button === 0) {
        this.mining = true;
        this.attackPressed = true;
      }
      if (event.button === 2) {
        this.using = true;
        this.usePressed = true;
      }
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mining = false;
      if (event.button === 2) this.using = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const current = Number(this.canvas.dataset.hotbar ?? 0);
      const next = (current + Math.sign(event.deltaY) + 9) % 9;
      this.callbacks.selectHotbar(next);
    }, { passive: false });
  }

  private bindTouch(): void {
    const joystick = document.createElement('div');
    joystick.id = 'touch-joystick';
    joystick.innerHTML = '<div class="joystick-ring"><div class="joystick-knob"></div></div>';
    const actions = document.createElement('div');
    actions.id = 'touch-actions';
    actions.innerHTML = [
      '<button data-action="mine" aria-label="Ломать или атаковать">⛏</button>',
      '<button data-action="use" aria-label="Использовать или поставить">▣</button>',
      '<button data-action="jump" aria-label="Прыжок">↑</button>',
      '<button data-action="sneak" aria-label="Присесть">⌄</button>',
      '<button data-action="sprint" aria-label="Бег">»</button>',
      '<button data-action="inventory" aria-label="Инвентарь">▦</button>',
      '<button data-action="pause" aria-label="Пауза">Ⅱ</button>',
    ].join('');
    const look = document.createElement('div');
    look.id = 'touch-look-zone';
    document.querySelector('#app')?.append(look, joystick, actions);

    let joystickPointer: number | undefined;
    const knob = joystick.querySelector<HTMLElement>('.joystick-knob')!;
    const updateJoystick = (event: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const radius = rect.width * 0.34;
      const scale = Math.min(1, radius / Math.max(radius, Math.hypot(dx, dy)));
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.touchRight = x / radius;
      this.touchForward = -y / radius;
    };
    joystick.addEventListener('pointerdown', (event) => {
      joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event);
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId === joystickPointer) updateJoystick(event);
    });
    const releaseJoystick = (event: PointerEvent) => {
      if (event.pointerId !== joystickPointer) return;
      joystickPointer = undefined;
      this.touchForward = 0;
      this.touchRight = 0;
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', releaseJoystick);
    joystick.addEventListener('pointercancel', releaseJoystick);

    look.addEventListener('pointerdown', (event) => {
      if (!this.callbacks.canCapture()) return;
      this.activeLookPointer = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      look.setPointerCapture(event.pointerId);
    });
    look.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.activeLookPointer) return;
      this.rotate((event.clientX - this.lastLookX) * 1.35, (event.clientY - this.lastLookY) * 1.35);
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    });
    const stopLook = (event: PointerEvent) => {
      if (event.pointerId === this.activeLookPointer) this.activeLookPointer = undefined;
    };
    look.addEventListener('pointerup', stopLook);
    look.addEventListener('pointercancel', stopLook);

    for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        if (action === 'mine') {
          this.mining = true;
          this.attackPressed = true;
        } else if (action === 'use') {
          this.using = true;
          this.usePressed = true;
        } else if (action === 'jump') this.touchJump = true;
        else if (action === 'sneak') this.touchSneak = !this.touchSneak;
        else if (action === 'sprint') this.touchSprint = !this.touchSprint;
        else if (action === 'inventory') this.callbacks.toggleInventory();
        else if (action === 'pause') this.callbacks.togglePause();
      };
      const up = () => {
        if (action === 'mine') this.mining = false;
        else if (action === 'use') this.using = false;
        else if (action === 'jump') this.touchJump = false;
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
    }
  }

  private bindPointerLock(): void {
    if (typeof document === 'undefined') return;
    this.lockedToCanvas = document.pointerLockElement === this.canvas;
    document.addEventListener('pointerlockchange', () => this.handlePointerLockChange());
    document.addEventListener('pointerlockerror', () => {
      this.lockErrors++;
      this.lockAttempt?.handleErrorEvent();
    });
  }

  private handlePointerLockChange(): void {
    this.lockChanges++;
    this.resetPointerSession();
    const nowLocked = this.isPointerLocked();
    const previouslyLocked = this.lockedToCanvas;
    this.lockedToCanvas = nowLocked;
    if (nowLocked) {
      this.lockAttempt?.finish();
      this.escapePressed = false;
      this.requestPending = false;
      this.programmaticReleasePending = false;
      if (!this.callbacks.canCapture()) {
        this.releasePointerLock();
        return;
      }
      this.callbacks.onPointerLockAcquired();
      return;
    }
    const reason = classifyPointerUnlock({
      previouslyLocked,
      nowLocked: false,
      programmaticReleasePending: this.programmaticReleasePending,
      documentHidden: document.hidden,
      documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
      escapePressed: this.escapePressed,
    });
    this.escapePressed = false;
    this.programmaticReleasePending = false;
    if (!reason) return;
    this.lastUnlockReason = reason;
    if (reason === 'escape') this.swallowEscapeKeyup = true;
    this.callbacks.onPointerLockReleased(reason);
  }

  private notifyRequestFailure(): void {
    if (!this.requestPending) return;
    this.requestPending = false;
    this.callbacks.onPointerLockRequestFailed();
  }

  private rotate(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  private resetPointerSession(): void {
    this.pointerMotion.reset();
    this.recentDeltas.length = 0;
    this.inputEvents = 0;
    this.inputEpoch = performance.now();
  }

  private refreshInputDebug(): void {
    if (!this.inputDebug) return;
    const now = performance.now();
    const rate = Math.round(this.inputEvents * 1000 / Math.max(1, now - this.inputEpoch));
    const last = this.recentDeltas.at(-1) ?? [0, 0];
    const largest = this.recentDeltas.reduce<readonly number[]>((best, value) =>
      Math.hypot(...value) > Math.hypot(...best) ? value : best, [0, 0]);
    this.inputDebug.textContent = [
      'INPUT DEBUG — lock loss ≠ delta spike',
      `locked=${this.isPointerLocked()} changes=${this.lockChanges} errors=${this.lockErrors} reason=${this.lastUnlockReason}`,
      `focus=${document.hasFocus()} visibility=${document.visibilityState} events/s=${rate}`,
      `last dx/dy=${last.join('/')} largest(16)=${largest.join('/')}`,
      `accepted avg/median=${this.pointerMotion.average.toFixed(1)}/${this.pointerMotion.median.toFixed(1)}`,
      `discard invalid=${this.pointerMotion.discardedInvalid} spikes=${this.pointerMotion.discardedSpikes}`,
      `raw requested=${this.lockAttempt?.rawRequested ?? false} plain fallback=${this.lockAttempt?.fallbackUsed ?? false}`,
    ].join('\n');
    this.inputEvents = 0;
    this.inputEpoch = now;
  }
}
