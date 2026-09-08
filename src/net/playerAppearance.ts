import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  sanitizeRegisteredAppearance,
  type PlayerAppearance,
} from '../player/appearance/PlayerAppearance';

export const PLAYER_APPEARANCE_STORAGE_KEY = 'fc.player.appearance';

export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): AppearanceStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: AppearanceStorage }).localStorage;
    if (!storage) return undefined;
    return storage;
  } catch {
    return undefined;
  }
}

export function loadPlayerAppearance(
  storage: AppearanceStorage | undefined = defaultStorage(),
): PlayerAppearance {
  if (!storage) return DEFAULT_PLAYER_APPEARANCE;
  try {
    const raw = storage.getItem(PLAYER_APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_APPEARANCE;
    const parsed = sanitizeRegisteredAppearance(JSON.parse(raw) as unknown);
    return parsed ?? DEFAULT_PLAYER_APPEARANCE;
  } catch {
    return DEFAULT_PLAYER_APPEARANCE;
  }
}

export function savePlayerAppearance(
  appearance: PlayerAppearance,
  storage: AppearanceStorage | undefined = defaultStorage(),
): PlayerAppearance {
  const next = createPlayerAppearance(sanitizeRegisteredAppearance(appearance) ?? DEFAULT_PLAYER_APPEARANCE);
  if (!storage) return next;
  try {
    storage.setItem(PLAYER_APPEARANCE_STORAGE_KEY, JSON.stringify({
      skinId: next.skinId,
      model: next.model,
      layers: next.layers,
    }));
  } catch {
    return next;
  }
  return next;
}
