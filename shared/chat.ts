import { MAX_CHAT_LENGTH } from './config';

export const CHAT_CHANNELS = ['global', 'nearby', 'clan'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** Inclusive 3D radius in blocks for the Nearby chat channel. */
export const NEARBY_CHAT_RADIUS = 20;

/** Max messages kept for each tab's viewable history. */
export const CHAT_TAB_HISTORY_LIMIT = 40;

export const CHAT_NO_CLAN_HINT = 'Вы не состоите в клане.';
export const CHAT_TOO_LONG_ERROR = `Сообщение слишком длинное (максимум ${MAX_CHAT_LENGTH} символов).`;

export function isChatChannel(value: unknown): value is ChatChannel {
  return value === 'global' || value === 'nearby' || value === 'clan';
}

export function nearbyChatDistanceSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

/** Full 3D distance, inclusive of the radius boundary. */
export function isWithinNearbyChatRange(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius = NEARBY_CHAT_RADIUS,
): boolean {
  return nearbyChatDistanceSq(ax, ay, az, bx, by, bz) <= radius * radius;
}

export function formatPlayerChatLine(from: string, text: string): string {
  return `${from}: ${text}`;
}

export function normalizeOutgoingChatText(raw: string): string {
  return raw.replace(/\s+$/g, '');
}
