import { MAX_PLAYER_NAME_LENGTH, MIN_PLAYER_NAME_LENGTH } from './config';

/**
 * Display nickname only. English letters and digits, 2–13 characters.
 * No trim: spaces and other symbols stay invalid. Not an account id.
 */
export const PLAYER_NICKNAME_PATTERN = /^[A-Za-z0-9]+$/;

const LENGTH_ERROR = `Ник должен содержать от ${MIN_PLAYER_NAME_LENGTH} до ${MAX_PLAYER_NAME_LENGTH} символов.`;
const CHARACTER_ERROR = 'Только английские буквы и цифры.';

export function playerNicknameError(raw: string): string | undefined {
  if (raw.length < MIN_PLAYER_NAME_LENGTH || raw.length > MAX_PLAYER_NAME_LENGTH) return LENGTH_ERROR;
  if (!PLAYER_NICKNAME_PATTERN.test(raw)) return CHARACTER_ERROR;
  return undefined;
}

/** Returns a valid display name, or undefined so the server can keep Player-XXXX. */
export function sanitizePlayerName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (playerNicknameError(raw)) return undefined;
  return raw;
}
