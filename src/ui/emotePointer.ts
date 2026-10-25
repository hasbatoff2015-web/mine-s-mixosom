import { emoteSectorFromPointer, type EmoteId } from '../../shared/emotes';

export interface EmoteDiscRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface EmoteTouchSelection {
  readonly dx: number;
  readonly dy: number;
  readonly id: EmoteId | null;
  readonly inside: boolean;
}

/**
 * Touch point relative to the wheel's real box. Outside the disc and the
 * center hub select nothing. The four sectors use the same angles as the
 * pointer-lock wheel.
 */
export function emoteTouchSelection(disc: EmoteDiscRect, clientX: number, clientY: number): EmoteTouchSelection {
  const radius = disc.width / 2;
  if (!(radius > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return { dx: 0, dy: 0, id: null, inside: false };
  }
  const dx = clientX - (disc.left + radius);
  const dy = clientY - (disc.top + disc.height / 2);
  const inside = Math.hypot(dx, dy) <= radius;
  if (!inside) return { dx: 0, dy: 0, id: null, inside: false };
  return { dx, dy, id: emoteSectorFromPointer(dx, dy, radius), inside: true };
}
