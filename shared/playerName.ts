import { MAX_PLAYER_NAME_LENGTH } from './config';

/**
 * Display nickname only. Letters (Latin/Cyrillic), digits, underscore, hyphen.
 * No spaces or control characters. Not an account id.
 */
const PLAYER_NICKNAME_PATTERN = /^[A-Za-z0-9_А-Яа-яЁё-]+$/;
const CONTROL_OR_SPACE = /[\s\u0000-\u001F\u007F]/;

export function playerNicknameError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return 'Никнейм не может быть пустым.';
  if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    return `Никнейм не длиннее ${MAX_PLAYER_NAME_LENGTH} символов.`;
  }
  if (CONTROL_OR_SPACE.test(trimmed)) return 'Пробелы и управляющие символы не допускаются.';
  if (!PLAYER_NICKNAME_PATTERN.test(trimmed)) {
    return 'Используйте буквы, цифры, подчёркивание или дефис.';
  }
  return undefined;
}

/** Returns a valid display name, or undefined so the server can keep Player-XXXX. */
export function sanitizePlayerName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  if (!trimmed || CONTROL_OR_SPACE.test(trimmed) || !PLAYER_NICKNAME_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}
