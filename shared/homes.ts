export const HOME_PLUGIN_NAME = 'home';
export const HOME_MAX_DEFAULT = 4;
export const HOME_NAME_MAX = 24;
export const HOME_NAME_EMPTY_ERROR = 'Введите название дома.';
export const HOME_NAME_LENGTH_ERROR = `Название дома не длиннее ${HOME_NAME_MAX} символов.`;
export const HOME_NAME_CHARS_ERROR = 'Название не должно содержать переносы строк.';
export const HOME_NAME_TAKEN_ERROR = 'Дом с таким названием уже есть.';
export const HOME_LIMIT_ERROR = (max: number) => `Можно сохранить не больше ${max} домов.`;
export const HOME_MISSING_ERROR = 'Дом не найден.';

export function normalizeHomeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function homeNameKey(raw: string): string {
  return normalizeHomeName(raw).toLowerCase();
}

export function validateHomeName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeHomeName(raw);
  if (!name) return { ok: false, error: HOME_NAME_EMPTY_ERROR };
  if (name.length > HOME_NAME_MAX) return { ok: false, error: HOME_NAME_LENGTH_ERROR };
  if (/[\n\r\t]/.test(name)) return { ok: false, error: HOME_NAME_CHARS_ERROR };
  return { ok: true, name };
}

export interface HomeLocation {
  name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
}

export interface HomeStore {
  players: Record<string, HomeLocation[]>;
}
