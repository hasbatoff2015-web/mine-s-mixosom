/**
 * Render-only bee motion. The server does not replicate wing angles.
 * `seconds` is a wrapped render clock, so flap rate stays the same at 60, 120, and 180 FPS.
 */

export const BEE_WING_HZ = 6.5;
export const BEE_WING_AMPLITUDE = 32 * Math.PI / 180;
export const BEE_BOB_HZ = 1.55;
export const BEE_BOB_AMPLITUDE = 0.06;
export const BEE_TILT_MAX = 8 * Math.PI / 180;
export const BEE_LEG_AMPLITUDE = 0.11;
export const BEE_ANIM_PERIOD_SECONDS = 60;

export function beeWingRadians(seconds: number, side: 'left' | 'right'): number {
  const wave = Math.sin(seconds * BEE_WING_HZ * Math.PI * 2);
  const angle = wave * BEE_WING_AMPLITUDE;
  return side === 'left' ? angle : -angle;
}

export function beeBobOffset(seconds: number): number {
  return Math.sin(seconds * BEE_BOB_HZ * Math.PI * 2) * BEE_BOB_AMPLITUDE;
}

export function beeLegRadians(seconds: number, index: number): number {
  const wave = Math.sin(seconds * BEE_BOB_HZ * Math.PI * 2 + index * 0.7);
  return wave * BEE_LEG_AMPLITUDE;
}

export function beeBodyPitch(horizontalSpeed: number, previousPitch: number, deltaSeconds: number): number {
  const target = Math.min(BEE_TILT_MAX, Math.max(0, horizontalSpeed) * (BEE_TILT_MAX / 8));
  const dt = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : 0;
  return previousPitch + (target - previousPitch) * Math.min(1, dt * 8);
}

/** Advance a wrapped clock. Large gaps do not fast-forward a burst of flaps. */
export function advanceBeeAnimSeconds(current: number, deltaSeconds: number): number {
  let dt = deltaSeconds;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > 0.1) dt = 0.1;
  const next = current + dt;
  return next >= BEE_ANIM_PERIOD_SECONDS ? next % BEE_ANIM_PERIOD_SECONDS : next;
}
