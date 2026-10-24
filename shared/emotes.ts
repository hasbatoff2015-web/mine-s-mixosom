/** Cosmetic emotes. They never move the player, deal damage, or change collision. */

export const EMOTE_IDS = ['wave', 'celebrate', 'point', 'bow'] as const;

export type EmoteId = (typeof EMOTE_IDS)[number];

export const EMOTE_LABELS: Readonly<Record<EmoteId, string>> = Object.freeze({
  wave: 'Приветствие',
  celebrate: 'Празднование',
  point: 'Указывание',
  bow: 'Поклон',
});

/** One-shot length. The server uses the same numbers as a lost-stop timeout. */
export const EMOTE_DURATION_SECONDS: Readonly<Record<EmoteId, number>> = Object.freeze({
  wave: 2.6,
  celebrate: 2.4,
  point: 1.9,
  bow: 2.0,
});

/**
 * Fraction of the wheel radius that does not select a sector.
 * Matches the center hub (34% of the disc diameter).
 */
export const EMOTE_WHEEL_DEAD_ZONE = 0.34;

/** Stick noise below this is not a movement intent. Keyboard axes are 0 or 1. */
export const EMOTE_MOVE_DEADZONE = 0.2;

export function isEmoteId(value: unknown): value is EmoteId {
  return typeof value === 'string' && (EMOTE_IDS as readonly string[]).includes(value);
}

export function emoteDurationSeconds(id: EmoteId): number {
  return EMOTE_DURATION_SECONDS[id];
}

export function emoteDurationTicks(id: EmoteId): number {
  return Math.round(EMOTE_DURATION_SECONDS[id] * 20);
}

export interface EmoteMoveIntent {
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly descend?: boolean;
}

/** Player intent only. Yaw, pitch, and velocity are not movement. */
export function emoteMovementInterrupts(input: EmoteMoveIntent): boolean {
  return Math.abs(input.forward) > EMOTE_MOVE_DEADZONE
    || Math.abs(input.right) > EMOTE_MOVE_DEADZONE
    || input.jump
    || input.sneak
    || input.descend === true;
}

/**
 * Pointer offset from the wheel center, Y down.
 * Sectors are 90° and centered on the cardinals: up, right, down, left.
 * The center disc selects nothing.
 */
export function emoteSectorFromPointer(dx: number, dy: number, radius: number): EmoteId | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 0) return null;
  const distance = Math.hypot(dx, dy);
  if (distance < radius * EMOTE_WHEEL_DEAD_ZONE) return null;
  const angle = Math.atan2(dy, dx);
  const quarter = Math.PI / 4;
  if (angle >= -quarter && angle < quarter) return 'celebrate';
  if (angle >= quarter && angle < quarter * 3) return 'point';
  if (angle >= -quarter * 3 && angle < -quarter) return 'wave';
  return 'bow';
}
