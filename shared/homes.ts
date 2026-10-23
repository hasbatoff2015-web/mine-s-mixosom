export const HOME_PLUGIN_NAME = 'home';
export const HOME_MAX_DEFAULT = 3;
export const HOME_MAX_VIP = 4;
export const HOME_MAX_PREMIUM = 5;
export const HOME_MAX_BOSS = 6;
export const HOME_MAX_TITAN = 7;

export function resolveHomeLimit(options: {
  readonly donation: number;
  readonly operator: boolean;
  readonly wildcard: boolean;
  readonly multiple: boolean;
  readonly premiumNode: boolean;
  readonly configuredDefault?: number;
  readonly configuredVip?: number;
  readonly configuredPremium?: number;
}): number {
  const def = options.configuredDefault ?? HOME_MAX_DEFAULT;
  const vip = options.configuredVip ?? HOME_MAX_VIP;
  const premium = options.configuredPremium ?? HOME_MAX_PREMIUM;
  const donation = Number.isFinite(options.donation) ? options.donation : def;
  if (options.operator || options.wildcard) {
    return Math.max(premium, vip, def, HOME_MAX_TITAN, donation);
  }
  let max = Math.max(def, donation);
  if (options.multiple) max = Math.max(max, vip);
  if (options.premiumNode) max = Math.max(max, premium);
  return max;
}
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
