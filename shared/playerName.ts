import { MAX_PLAYER_NAME_LENGTH, MIN_PLAYER_NAME_LENGTH } from './config';

/**
 * Display nickname only. ASCII letters and digits, 2–20 characters.
 * No trim: spaces and other characters stay invalid. Not an account id.
 */
export const PLAYER_NICKNAME_PATTERN = /^[A-Za-z0-9]+$/;

const LENGTH_MESSAGE = `Ник должен содержать от ${MIN_PLAYER_NAME_LENGTH} до ${MAX_PLAYER_NAME_LENGTH} символов.`;
const CHARSET_MESSAGE = 'Только английские буквы и цифры.';

export function playerNicknameError(raw: string): string | undefined {
  if (raw.length < MIN_PLAYER_NAME_LENGTH || raw.length > MAX_PLAYER_NAME_LENGTH) return LENGTH_MESSAGE;
  if (!PLAYER_NICKNAME_PATTERN.test(raw)) return CHARSET_MESSAGE;
  return undefined;
}

/** Returns a valid display name, or undefined so the server can keep Player-XXXX. */
export function sanitizePlayerName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (playerNicknameError(raw)) return undefined;
  return raw;
}
