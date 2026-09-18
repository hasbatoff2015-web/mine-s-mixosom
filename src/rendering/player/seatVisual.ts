import { MINECART_FLOOR_TOP } from '../minecartGeometry';
import { PLAYER_MODEL_PIXEL } from './PlayerSkinGeometry';

export interface SeatVisualTransform {
  readonly yOffset: number;
  readonly backwardOffset: number;
}

export interface SeatVisualOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Same as `UPPER_BODY_PIVOT_Y`: hip / pelvis in PlayerVisual space. */
export const PLAYER_SEAT_HIP_HEIGHT = 12 * PLAYER_MODEL_PIXEL;

/**
 * Gameplay rider feet stay `cart.y + 0.2`. Presentation sits relative to that
 * anchor; do not change the authoritative ride position.
 */
export const MINECART_RIDER_GAMEPLAY_Y = 0.2;

/**
 * Sit on the inner floor with pelvis nearer the rear wall. Front is local −Z,
 * so the root moves toward local +Z. 0.25 is the largest back-shift in the
 * 0.18–0.25 range that still keeps the 4px-deep torso inside the cart.
 */
export const MINECART_SEAT_BACK_OFFSET = 0.25;

export const MINECART_SEAT_VISUAL: SeatVisualTransform = {
  yOffset: MINECART_FLOOR_TOP - MINECART_RIDER_GAMEPLAY_Y - PLAYER_SEAT_HIP_HEIGHT,
  backwardOffset: MINECART_SEAT_BACK_OFFSET,
};

/** World offset of a visual seat root. Backward is opposite player front (−Z at yaw 0). */
export function seatVisualOffset(yaw: number, seat: SeatVisualTransform): SeatVisualOrigin {
  return {
    x: Math.sin(yaw) * seat.backwardOffset,
    y: seat.yOffset,
    z: Math.cos(yaw) * seat.backwardOffset,
  };
}

export function applySeatVisualRoot(
  root: { readonly position: { set(x: number, y: number, z: number): void } },
  origin: SeatVisualOrigin,
  yaw: number,
  seated: boolean,
  seat: SeatVisualTransform = MINECART_SEAT_VISUAL,
): void {
  if (!seated) {
    root.position.set(origin.x, origin.y, origin.z);
    return;
  }
  const offset = seatVisualOffset(yaw, seat);
  root.position.set(origin.x + offset.x, origin.y + offset.y, origin.z + offset.z);
}
