import { playerNicknameError, sanitizePlayerName } from '../../shared/playerName';

export const PLAYER_NICKNAME_STORAGE_KEY = 'fc.player.nickname';

export interface NicknameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): NicknameStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: NicknameStorage }).localStorage;
    if (!storage) return undefined;
    return storage;
  } catch {
    return undefined;
  }
}

/** Last user-chosen display nick, or undefined to keep the Player-XXXX fallback. */
export function loadPlayerNickname(storage: NicknameStorage | undefined = defaultStorage()): string | undefined {
  if (!storage) return undefined;
  try {
    return sanitizePlayerName(storage.getItem(PLAYER_NICKNAME_STORAGE_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

export function savePlayerNickname(
  raw: string,
  storage: NicknameStorage | undefined = defaultStorage(),
): { ok: true; name: string } | { ok: false; error: string } {
  const name = sanitizePlayerName(raw);
  if (!name) {
    return { ok: false, error: playerNicknameError(raw) ?? 'Некорректный никнейм.' };
  }
  if (!storage) return { ok: false, error: 'Локальное хранилище недоступно.' };
  try {
    storage.setItem(PLAYER_NICKNAME_STORAGE_KEY, name);
  } catch {
    return { ok: false, error: 'Не удалось сохранить никнейм.' };
  }
  return { ok: true, name };
}
