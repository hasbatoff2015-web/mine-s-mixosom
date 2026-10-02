/**
 * Touch classification for the world area.
 *
 * Deadzone 10px: finger jitter stays a tap/hold candidate and does not move the camera.
 * Swipe threshold 18px: crossing this while the gesture is still pending commits it to the camera.
 * Hold 200ms: a finger that is still inside the swipe threshold becomes a hold interaction.
 *
 * After a swipe, the same finger never attacks or uses.
 * After a hold, the same finger never rotates the camera.
 */

export const TOUCH_DEADZONE_PX = 10;
export const TOUCH_SWIPE_THRESHOLD_PX = 18;
export const TOUCH_HOLD_MS = 200;
/** Matches the previous look-zone scale so swipe speed stays familiar. */
export const TOUCH_LOOK_SCALE = 1.35;

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

/** Camera delta for an in-progress swipe. The classifying sample itself is zero. */
export function swipeLookDelta(
  previous: TouchTrack,
  x: number,
  y: number,
): { dx: number; dy: number } | undefined {
  if (previous.phase !== 'swipe') return undefined;
  return { dx: x - previous.lastX, dy: y - previous.lastY };
}
