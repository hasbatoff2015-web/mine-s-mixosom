/**
 * Touch classification for the world area.
 *
 * Deadzone 10px: finger jitter stays a tap/hold candidate and does not move the camera.
 * Swipe threshold 18px: crossing this while the gesture is still pending commits it to the camera.
 * Hold 200ms: a finger that is still inside the swipe threshold becomes a hold interaction.
 *
 * After a swipe, the same finger never attacks or uses.
 * A mining or food hold does not rotate the camera. A bow hold does.
 */

export const TOUCH_DEADZONE_PX = 10;
export const TOUCH_SWIPE_THRESHOLD_PX = 18;
export const TOUCH_HOLD_MS = 200;
/**
 * Mobile look is twice the old 1.35 baseline. Desktop mouse never reads this.
 * The settings slider is unchanged; this is the only extra multiplier.
 */
export const TOUCH_LOOK_BASELINE = 1.35;
export const MOBILE_LOOK_MULTIPLIER = 2;
export const TOUCH_LOOK_SCALE = TOUCH_LOOK_BASELINE * MOBILE_LOOK_MULTIPLIER;

/** A jump tap shorter than this can pair into a double tap. A longer hold cannot. */
export const JUMP_TAP_MAX_MS = 280;
/** Two taps inside this window toggle the latched jump. */
export const JUMP_DOUBLE_TAP_MS = 320;

export interface JumpLockState {
  readonly locked: boolean;
  readonly lastTapAt: number;
}

export const JUMP_LOCK_IDLE: JumpLockState = { locked: false, lastTapAt: 0 };

export function jumpLockAfterRelease(
  state: JumpLockState,
  downAt: number,
  upAt: number,
  cancelled: boolean,
): JumpLockState {
  if (cancelled) return state;
  if (upAt - downAt > JUMP_TAP_MAX_MS) return { locked: state.locked, lastTapAt: 0 };
  if (state.lastTapAt > 0 && upAt - state.lastTapAt <= JUMP_DOUBLE_TAP_MS) {
    return { locked: !state.locked, lastTapAt: 0 };
  }
  return { locked: state.locked, lastTapAt: upAt };
}

export function jumpInputActive(input: {
  readonly space: boolean;
  readonly pressed: boolean;
  readonly locked: boolean;
  readonly autoJump: boolean;
}): boolean {
  return input.space || input.pressed || input.locked || input.autoJump;
}

export type TouchPhase = 'pending' | 'swipe' | 'hold';

export interface TouchTrack {
  readonly phase: TouchPhase;
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  readonly lastX: number;
  readonly lastY: number;
}

export type TouchFinish = 'tap' | 'swipe' | 'hold-end' | 'ignore';
export type PointerEndKind = 'up' | 'cancel';

export function beginTouchTrack(x: number, y: number, now: number): TouchTrack {
  return {
    phase: 'pending',
    originX: x,
    originY: y,
    x,
    y,
    startedAt: now,
    lastX: x,
    lastY: y,
  };
}

export function touchTravel(track: Pick<TouchTrack, 'originX' | 'originY' | 'x' | 'y'>): number {
  return Math.hypot(track.x - track.originX, track.y - track.originY);
}

export function movementBeyondDeadzone(travel: number): boolean {
  return travel >= TOUCH_DEADZONE_PX;
}

export function advanceTouchTrack(track: TouchTrack, x: number, y: number, now: number): TouchTrack {
  const next: TouchTrack = { ...track, x, y };
  if (next.phase !== 'pending') return next;
  const travel = touchTravel(next);
  const elapsed = now - track.startedAt;
  if (travel >= TOUCH_SWIPE_THRESHOLD_PX) {
    return { ...next, phase: 'swipe', lastX: x, lastY: y };
  }
  if (elapsed >= TOUCH_HOLD_MS) {
    return { ...next, phase: 'hold' };
  }
  return next;
}

export function finishTouchTrack(track: TouchTrack, now: number): TouchFinish {
  if (track.phase === 'swipe') return 'swipe';
  if (track.phase === 'hold') return 'hold-end';
  const travel = touchTravel(track);
  if (now - track.startedAt <= TOUCH_HOLD_MS && travel < TOUCH_SWIPE_THRESHOLD_PX) return 'tap';
  return 'ignore';
}

/**
 * `pointerup` can become a tap. `pointercancel` is the browser aborting the
 * gesture, so a pending finger never attacks or places. A hold still ends
 * so mining and a drawn bow release.
 */
export function resolvePointerEnd(track: TouchTrack, kind: PointerEndKind, now: number): TouchFinish {
  if (kind === 'cancel') return track.phase === 'hold' ? 'hold-end' : 'ignore';
  return finishTouchTrack(track, now);
}

/** Hold keeps its phase and its screen point. The camera delta stays empty. */
export function moveHeldTouch(
  track: TouchTrack,
  x: number,
  y: number,
  now: number,
): { track: TouchTrack; cameraDelta: { dx: number; dy: number } | undefined; aimX: number; aimY: number } {
  return {
    track: advanceTouchTrack(track, x, y, now),
    cameraDelta: swipeLookDelta(track, x, y),
    aimX: x,
    aimY: y,
  };
}

/** Camera delta for an in-progress swipe. The classifying sample itself is zero. */
export function swipeLookDelta(
  previous: TouchTrack,
  x: number,
  y: number,
): { dx: number; dy: number } | undefined {
  if (previous.phase !== 'swipe') return undefined;
  return { dx: x - previous.lastX, dy: y - previous.lastY };
}
