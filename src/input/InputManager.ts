import { clamp } from '../core/constants';
import {
  applyPointerLockRequest,
  classifyPointerUnlock,
  isCoarsePointerMedia,
  shouldExitPointerLock,
  shouldReleasePointerLockAfterAcquire,
  shouldTogglePauseOnEscapeKeydown,
  type PointerUnlockReason,
  PointerLockAttempt,
} from './pointerLock';
import { PointerMotionFilter } from './pointerMotion';
import { shouldBlurStaleTextField, shouldCaptureGameplayKey } from './gameplayKeys';
import type { MoveInput } from './MoveInput';
import {
  JUMP_LOCK_IDLE,
  TOUCH_HOLD_MS,
  TOUCH_LOOK_SCALE,
  advanceTouchTrack,
  beginTouchTrack,
  jumpInputActive,
  jumpLockAfterPolicy,
  jumpLockPolicyAfterMode,
  resolvePointerEnd,
  swipeLookDelta,
  type JumpLockState,
  type TouchTrack,
} from './touchGesture';
import {
  heldPointerEffect,
  MOBILE_SNEAK_IDLE,
  mobileSneakAfterFlight,
  mobileSneakAfterPointer,
  mobileSneakIntent,
  mobileSneakRelease,
  shouldFollowHoldAim,
  shouldRotateCameraDuringHold,
  sneakButtonActive,
  sprintFromStick,
  touchStickRadius,
  type MobileSneakState,
  type MobileTouchDecision,
  type MobileTouchIntent,
} from './mobileTouch';
import { TOUCH_LAYOUT_QUERY } from './touchLayout';
import { CROUCH_ICON, INVENTORY_ICON, JUMP_ICON } from './touchIcons';

/**
 * A stored finger aim (mining, food) is kept until the release sample.
 * A bow draw stores no ray, so the sample falls through to the camera.
 * `pointerup` and `pointercancel` both end here.
 */
export function aimAfterHoldEnd(state: {
  readonly mining: boolean;
  readonly using: boolean;
  readonly releaseAimPending: boolean;
  readonly aim: { readonly yaw: number; readonly pitch: number } | null;
}): {
  readonly miningReleased: boolean;
  readonly useReleased: boolean;
  readonly releaseAimPending: boolean;
  readonly aim: { readonly yaw: number; readonly pitch: number } | null;
} {
  const releaseAimPending = state.using ? true : state.releaseAimPending;
  return {
    miningReleased: state.mining,
    useReleased: state.using,
    releaseAimPending,
    aim: releaseAimPending ? state.aim : null,
  };
}

export type { MoveInput } from './MoveInput';

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export const DESKTOP_SNEAK_CODES = ['ShiftLeft', 'ShiftRight'] as const;
export const DESKTOP_CAMERA_TOGGLE_CODE = 'KeyC';
export const DESKTOP_FLY_SPRINT_CODES = ['ControlLeft', 'ControlRight'] as const;

export interface InputCallbacks {
  canCapture(): boolean;
  toggleInventory(): void;
  togglePause(): void;
  openChat(prefix?: string): void;
  dropItem(): void;
  selectHotbar(index: number): void;
  cyclePerspective?(): void;
  toggleMenu?(): void;
  classifyWorldTouch?(clientX: number, clientY: number, phase: 'tap' | 'hold'): MobileTouchDecision;
  /** Current finger position during a hold. Does not start a new action. */
  aimAtClientPoint?(clientX: number, clientY: number): { yaw: number; pitch: number } | undefined;
  onPointerLockAcquired(): void;
  onPointerLockReleased(reason: PointerUnlockReason): void;
  onPointerLockRequestFailed(): void;
  isChatOpen?(): boolean;
}

export function shouldCyclePerspectiveOnKey(input: {
  readonly code: string;
  readonly repeat: boolean;
  readonly typing: boolean;
  readonly canCapture: () => boolean;
  readonly hasCallback: boolean;
}): boolean {
  return input.code === DESKTOP_CAMERA_TOGGLE_CODE
    && !input.repeat
    && !input.typing
    && input.hasCallback
    && input.canCapture();
}

export class InputManager {
  yaw = 0;
  pitch = 0;
  mining = false;
  using = false;
  private attackPresses = 0;
  usePressed = false;
  useReleased = false;
  miningReleased = false;
  lastUnlockReason: PointerUnlockReason = 'unknown';
  private readonly keys = new Set<string>();
  private touchForward = 0;
  private touchRight = 0;
  private touchJumpPressed = false;
  private jumpLock: JumpLockState = JUMP_LOCK_IDLE;
  private jumpDownAt = 0;
  /** Survival latches a double tap. Creative leaves the button as a flight tap. */
  private jumpLockAllowed = true;
  private touchSprint = false;
  /** Ground latch and the physical crouch finger are separate. Descend reads only the finger. */
  private sneak: MobileSneakState = MOBILE_SNEAK_IDLE;
  private touchLayout = false;
  private autoJumpArmed = false;
  private worldTouch?: TouchTrack;
  private worldPointer?: number;
  private holdTimer?: number;
  private holdingWorldTouch = false;
  private activeHoldIntent: MobileTouchIntent | null = null;
  private interactionAim: { yaw: number; pitch: number } | null = null;
  /** Kept through bow/use release until the sample that fires the shot. */
  private releaseAimPending = false;
  private sneakButton?: HTMLButtonElement;
  private jumpButton?: HTMLButtonElement;
  private coarseMedia?: MediaQueryList;
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

  isTouchLayout(): boolean {
    return this.touchLayout;
  }

  /** Next movement sample only. Desktop never arms this. */
  armAutoJump(armed: boolean): void {
    this.autoJumpArmed = armed;
  }

  /**
   * Creative Flight holds crouch. Ground, including grounded creative, keeps the toggle.
   * A change either way clears the latch so a crouch that was on cannot descend.
   */
  setMobileSneakFlightHold(flying: boolean): void {
    const next = mobileSneakAfterFlight(this.sneak, flying);
    if (next === this.sneak) return;
    this.sneak = next;
    this.syncSneakButton();
  }

  /**
   * Survival may latch the jump button. Creative must not: the same double
   * tap is the flight toggle. A change in either direction drops a pending
   * tap so the other mode cannot inherit it.
   */
  setJumpLockAllowed(allowed: boolean): void {
    const policy = jumpLockPolicyAfterMode(this.jumpLockAllowed, allowed);
    this.jumpLockAllowed = policy.allowed;
    if (!policy.clearGesture) return;
    this.jumpLock = JUMP_LOCK_IDLE;
    this.jumpDownAt = 0;
    this.syncJumpButton();
  }

  /** Locked touch ray. Camera yaw stays independent. */
  interactionLook(): { yaw: number; pitch: number } | null {
    return this.interactionAim;
  }

  /** Drop a finished tap aim after attack/use has been sampled. Holds and an unsampled release keep the ray. */
  dismissTapAim(): void {
    if (this.holdingWorldTouch || this.usePressed || this.using || this.releaseAimPending) return;
    this.interactionAim = null;
  }

  /** Last finger aim for an in-progress mine or held use. Does not press attack or use. */
  refreshHoldAim(aimAt: (x: number, y: number) => { yaw: number; pitch: number } | undefined): void {
    if (!this.holdingWorldTouch || !this.worldTouch) return;
    if (!this.activeHoldIntent || !shouldFollowHoldAim(this.activeHoldIntent)) return;
    const aim = aimAt(this.worldTouch.x, this.worldTouch.y);
    if (aim) this.interactionAim = aim;
  }

  /** Call after the release sample. A stale touch aim must not stick to the next action. */
  consumeReleaseAim(): void {
    if (!this.releaseAimPending) return;
    this.releaseAimPending = false;
    if (!this.holdingWorldTouch && !this.using && !this.usePressed) this.interactionAim = null;
  }

  movement(): MoveInput {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) + this.touchForward;
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.touchRight;
    const length = Math.hypot(forward, right);
    const space = this.keys.has('Space');
    const manualJump = space || this.touchJumpPressed;
    const desktopSneak = DESKTOP_SNEAK_CODES.some((code) => this.keys.has(code));
    const touchSneak = mobileSneakIntent(this.sneak, desktopSneak);
    return {
      forward: length > 1 ? forward / length : forward,
      right: length > 1 ? right / length : right,
      jump: jumpInputActive({
        space,
        pressed: this.touchJumpPressed,
        locked: this.jumpLockAllowed && this.jumpLock.locked,
        autoJump: this.autoJumpArmed,
      }),
      manualJump,
      sprint: this.touchSprint,
      sneak: touchSneak.sneak,
      descend: touchSneak.descend,
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

  consumeUseReleased(): boolean {
    const value = this.useReleased;
    this.useReleased = false;
    return value;
  }

  consumeMiningReleased(): boolean {
    const value = this.miningReleased;
    this.miningReleased = false;
    return value;
  }

  releaseActions(): void {
    this.cancelWorldTouch();
    this.mining = false;
    this.using = false;
    this.attackPressed = false;
    this.usePressed = false;
    this.useReleased = false;
    this.miningReleased = false;
    this.touchJumpPressed = false;
    this.jumpLock = JUMP_LOCK_IDLE;
    this.jumpDownAt = 0;
    this.sneak = mobileSneakRelease(this.sneak);
    this.releaseAimPending = false;
    this.interactionAim = null;
    this.holdingWorldTouch = false;
    this.syncJumpButton();
    this.syncSneakButton();
  }

  /** Drop held WASD/Space/Shift so a lost keyup cannot stick, and so chat cannot leave W=true. */
  clearHeldKeys(): void {
    this.keys.clear();
    this.touchForward = 0;
    this.touchRight = 0;
    this.touchJumpPressed = false;
    this.touchSprint = false;
    this.autoJumpArmed = false;
    this.releaseActions();
    this.syncSneakButton();
  }

  isPointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
  }

  isLockRequestPending(): boolean {
    return this.requestPending;
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
      if (shouldCyclePerspectiveOnKey({
        code: event.code,
        repeat: event.repeat,
        typing,
        canCapture: () => this.callbacks.canCapture(),
        hasCallback: this.callbacks.cyclePerspective !== undefined,
      })) {
        event.preventDefault();
        this.callbacks.cyclePerspective!();
        return;
      }
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
      if (event.code === 'Tab' && !event.repeat) {
        event.preventDefault();
        if (this.callbacks.isChatOpen?.()) return;
        this.callbacks.togglePause();
        return;
      }
      if (typing) {
        const chatOpen = this.callbacks.isChatOpen?.() === true;
        const isChatInput = event.target instanceof HTMLElement && event.target.id === 'chat-input';
        if (!isChatInput) return;
        if (!shouldCaptureGameplayKey({ typingInField: true, chatOpen })) return;
        if (shouldBlurStaleTextField({ typingInField: true, chatOpen, isChatInput: true })) {
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
      if (event.code === 'KeyM' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.callbacks.toggleMenu?.();
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
      if (event.button === 0) {
        if (this.mining) this.miningReleased = true;
        this.mining = false;
      }
      if (event.button === 2) {
        if (this.using) this.useReleased = true;
        this.using = false;
      }
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
      `<button type="button" data-action="jump" aria-label="Прыжок" aria-pressed="false">${JUMP_ICON}</button>`,
      `<button type="button" data-action="sneak" aria-label="Присесть" aria-pressed="false">${CROUCH_ICON}</button>`,
      `<button type="button" data-action="inventory" aria-label="Инвентарь" title="Инвентарь">${INVENTORY_ICON}</button>`,
    ].join('');
    const look = document.createElement('div');
    look.id = 'touch-look-zone';
    const app = document.querySelector('#app');
    app?.append(look, joystick, actions);
    const blockGameplayCallout = (event: Event) => {
      if (!this.touchLayout) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
    };
    app?.addEventListener('selectstart', blockGameplayCallout);
    app?.addEventListener('contextmenu', blockGameplayCallout);
    app?.addEventListener('dragstart', blockGameplayCallout);
    this.sneakButton = actions.querySelector<HTMLButtonElement>('button[data-action="sneak"]') ?? undefined;
    this.jumpButton = actions.querySelector<HTMLButtonElement>('button[data-action="jump"]') ?? undefined;
    this.coarseMedia = typeof matchMedia === 'function' ? matchMedia(TOUCH_LAYOUT_QUERY) : undefined;
    this.touchLayout = this.coarseMedia?.matches === true;
    this.coarseMedia?.addEventListener?.('change', () => {
      this.touchLayout = this.coarseMedia?.matches === true;
    });

    let joystickPointer: number | undefined;
    const knob = joystick.querySelector<HTMLElement>('.joystick-knob')!;
    const updateJoystick = (event: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const radius = touchStickRadius(rect.width);
      const scale = Math.min(1, radius / Math.max(radius, Math.hypot(dx, dy)));
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.touchRight = x / radius;
      this.touchForward = -y / radius;
      this.touchSprint = sprintFromStick(this.touchRight, this.touchForward);
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
      this.touchSprint = false;
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', releaseJoystick);
    joystick.addEventListener('pointercancel', releaseJoystick);

    look.addEventListener('pointerdown', (event) => {
      if (!this.callbacks.canCapture() || !this.touchLayout) return;
      if (this.worldPointer !== undefined) return;
      event.preventDefault();
      this.worldPointer = event.pointerId;
      this.worldTouch = beginTouchTrack(event.clientX, event.clientY, performance.now());
      look.setPointerCapture(event.pointerId);
      this.armHoldTimer();
    });
    look.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.worldPointer || !this.worldTouch) return;
      event.preventDefault();
      this.advanceWorldTouch(event.clientX, event.clientY, performance.now());
    });
    look.addEventListener('pointerup', (event) => {
      if (event.pointerId !== this.worldPointer || !this.worldTouch) return;
      event.preventDefault();
      this.worldTouch = { ...this.worldTouch, x: event.clientX, y: event.clientY };
      this.finishWorldTouch(performance.now());
    });
    look.addEventListener('pointercancel', (event) => {
      if (event.pointerId !== this.worldPointer || !this.worldTouch) return;
      this.worldTouch = { ...this.worldTouch, x: event.clientX, y: event.clientY };
      this.cancelWorldTouchGesture();
    });

    for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        try { button.setPointerCapture(event.pointerId); } catch { /* lost pointer still counts as a press */ }
        if (action === 'jump') this.pressJump(performance.now());
        else if (action === 'sneak') this.pressSneak(event.pointerId);
        else if (action === 'inventory') this.callbacks.toggleInventory();
      };
      const up = (event: PointerEvent) => {
        if (action === 'jump') this.releaseJump(performance.now(), event.type === 'pointercancel');
        else if (action === 'sneak') this.releaseSneak(event.pointerId);
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
    }
  }

  private armHoldTimer(): void {
    this.clearHoldTimer();
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = undefined;
      if (!this.worldTouch || this.worldTouch.phase !== 'pending') return;
      const now = Math.max(performance.now(), this.worldTouch.startedAt + TOUCH_HOLD_MS);
      this.advanceWorldTouch(this.worldTouch.x, this.worldTouch.y, now);
    }, TOUCH_HOLD_MS);
  }

  private clearHoldTimer(): void {
    if (this.holdTimer === undefined) return;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
  }

  private advanceWorldTouch(x: number, y: number, now: number): void {
    const previous = this.worldTouch;
    if (!previous) return;
    let next = advanceTouchTrack(previous, x, y, now);
    if (next.phase === 'swipe') {
      this.clearHoldTimer();
      const delta = swipeLookDelta(previous, x, y);
      if (delta) this.rotate(delta.dx * TOUCH_LOOK_SCALE, delta.dy * TOUCH_LOOK_SCALE);
      next = { ...next, lastX: x, lastY: y };
      if (previous.phase !== 'swipe') this.interactionAim = null;
      this.activeHoldIntent = null;
    } else if (previous.phase === 'pending' && next.phase === 'hold') {
      this.clearHoldTimer();
      this.beginWorldHold(next);
      next = this.applyHeldPointer(previous, next, x, y);
    } else if (previous.phase === 'hold') {
      next = this.applyHeldPointer(previous, next, x, y);
    }
    this.worldTouch = next;
  }

  /** Bow rotates the camera. Mining and food keep the finger ray and the camera still. */
  private applyHeldPointer(previous: TouchTrack, next: TouchTrack, x: number, y: number): TouchTrack {
    const effect = heldPointerEffect({
      intent: this.activeHoldIntent,
      lastX: previous.lastX,
      lastY: previous.lastY,
      x,
      y,
      fingerAim: shouldFollowHoldAim(this.activeHoldIntent ?? 'none')
        ? this.callbacks.aimAtClientPoint?.(x, y) ?? null
        : null,
      interactionAim: this.interactionAim,
    });
    if (effect.lookDx !== 0 || effect.lookDy !== 0) {
      this.rotate(effect.lookDx * TOUCH_LOOK_SCALE, effect.lookDy * TOUCH_LOOK_SCALE);
    }
    this.interactionAim = effect.interactionAim;
    if (shouldRotateCameraDuringHold(this.activeHoldIntent ?? 'none')) {
      return { ...next, lastX: x, lastY: y };
    }
    return next;
  }

  /** Mining and held use track the finger. This sample does not press attack or use again. */
  private followHoldAim(x: number, y: number): void {
    if (!this.activeHoldIntent || !shouldFollowHoldAim(this.activeHoldIntent)) return;
    const aim = this.callbacks.aimAtClientPoint?.(x, y);
    if (aim) this.interactionAim = aim;
  }

  private beginWorldHold(track: TouchTrack): void {
    this.holdingWorldTouch = true;
    const decision = this.callbacks.classifyWorldTouch?.(track.x, track.y, 'hold');
    this.activeHoldIntent = decision?.intent ?? 'none';
    this.applyWorldDecision(decision, 'hold');
  }

  private finishWorldTouch(now: number): void {
    const track = this.worldTouch;
    this.clearHoldTimer();
    this.worldPointer = undefined;
    this.worldTouch = undefined;
    if (!track) return;
    if (track.phase === 'hold' && this.activeHoldIntent && shouldFollowHoldAim(this.activeHoldIntent)) {
      this.followHoldAim(track.x, track.y);
    }
    this.completePointerEnd(track, resolvePointerEnd(track, 'up', now));
  }

  /** Browser/OS cancelled the finger. A pending gesture must not become a tap. */
  private cancelWorldTouchGesture(): void {
    const track = this.worldTouch;
    this.clearHoldTimer();
    this.worldPointer = undefined;
    this.worldTouch = undefined;
    if (!track) return;
    const kind = resolvePointerEnd(track, 'cancel', performance.now());
    if (kind === 'hold-end') {
      if (this.activeHoldIntent && shouldFollowHoldAim(this.activeHoldIntent)) {
        this.followHoldAim(track.x, track.y);
      }
      this.endWorldHold();
      return;
    }
    this.holdingWorldTouch = false;
    this.activeHoldIntent = null;
    this.interactionAim = null;
  }

  private completePointerEnd(track: TouchTrack, kind: ReturnType<typeof resolvePointerEnd>): void {
    if (kind === 'tap') {
      const decision = this.callbacks.classifyWorldTouch?.(track.originX, track.originY, 'tap');
      this.applyWorldDecision(decision, 'tap');
      return;
    }
    if (kind === 'hold-end') this.endWorldHold();
  }

  private applyWorldDecision(decision: MobileTouchDecision | undefined, phase: 'tap' | 'hold'): void {
    if (!decision || decision.intent === 'none') {
      if (phase === 'tap') this.interactionAim = null;
      return;
    }
    this.interactionAim = decision.intent === 'bow-hold'
      ? null
      : { yaw: decision.yaw, pitch: decision.pitch };
    if (decision.intent === 'attack') this.attackPressed = true;
    else if (decision.intent === 'use') this.usePressed = true;
    else if (decision.intent === 'use-hold' || decision.intent === 'bow-hold') {
      this.using = true;
      this.usePressed = true;
    } else if (decision.intent === 'mine') {
      this.mining = true;
      this.attackPressed = true;
    }
  }

  private endWorldHold(): void {
    this.holdingWorldTouch = false;
    this.activeHoldIntent = null;
    const finished = aimAfterHoldEnd({
      mining: this.mining,
      using: this.using,
      releaseAimPending: this.releaseAimPending,
      aim: this.interactionAim,
    });
    this.mining = false;
    this.using = false;
    if (finished.miningReleased) this.miningReleased = true;
    if (finished.useReleased) this.useReleased = true;
    this.releaseAimPending = finished.releaseAimPending;
    this.interactionAim = finished.aim;
  }

  private cancelWorldTouch(): void {
    this.clearHoldTimer();
    this.worldTouch = undefined;
    this.worldPointer = undefined;
    this.holdingWorldTouch = false;
    this.activeHoldIntent = null;
  }

  private pressJump(now: number): void {
    this.touchJumpPressed = true;
    this.jumpDownAt = now;
  }

  private releaseJump(now: number, cancelled: boolean): void {
    this.touchJumpPressed = false;
    const next = jumpLockAfterPolicy(
      this.jumpLockAllowed,
      this.jumpLock,
      this.jumpDownAt,
      now,
      cancelled,
    );
    this.jumpLock = next.lock;
    this.jumpDownAt = next.downAt;
    this.syncJumpButton();
  }

  private syncJumpButton(): void {
    const button = this.jumpButton;
    if (!button) return;
    button.classList.toggle('is-active', this.jumpLock.locked);
    button.setAttribute('aria-pressed', this.jumpLock.locked ? 'true' : 'false');
  }

  private pressSneak(pointerId: number): void {
    const next = mobileSneakAfterPointer(this.sneak, { type: 'down', pointerId });
    if (next === this.sneak) return;
    this.sneak = next;
    this.syncSneakButton();
  }

  private releaseSneak(pointerId: number): void {
    const next = mobileSneakAfterPointer(this.sneak, { type: 'up', pointerId });
    if (next === this.sneak) return;
    this.sneak = next;
    this.syncSneakButton();
  }

  private syncSneakButton(): void {
    const button = this.sneakButton;
    if (!button) return;
    const active = sneakButtonActive(this.sneak);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
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
      this.callbacks.onPointerLockAcquired();
      if (shouldReleasePointerLockAfterAcquire(this.callbacks.canCapture())) {
        this.releasePointerLock();
      }
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
