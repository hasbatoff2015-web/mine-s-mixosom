export const HOME_PLUGIN_NAME = 'home';
export const HOME_MAX_DEFAULT = 4;
export const HOME_MAX_VIP = 4;
export const HOME_MAX_PREMIUM = 5;
export const HOME_NAME_MIN = 1;
export const HOME_NAME_MAX = 24;

export const HOME_NAME_LENGTH_ERROR = 'Название дома должно содержать от 1 до 24 символов.';
export const HOME_NAME_CHARS_ERROR = 'Название может содержать только буквы, цифры, пробел, _ и -.';
export const HOME_NAME_UNSAFE_ERROR = 'Недопустимое название дома.';
export const HOME_NAME_TAKEN_ERROR = 'Дом с таким названием уже есть.';
export const HOME_LIMIT_ERROR = 'У вас уже максимальное количество домов: 4.';
export const HOME_MISSING_ERROR = 'Дом не найден.';

const NAME_CHARS = /^[\p{L}\p{N} _-]+$/u;
const UNSAFE_NAME = /[<>&"'`\\]|[\u0000-\u001f\u007f]/;

export function homeNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function validateHomeName(raw: string | undefined): { ok: true; name: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: false, error: HOME_NAME_LENGTH_ERROR };
  if (UNSAFE_NAME.test(raw)) return { ok: false, error: HOME_NAME_UNSAFE_ERROR };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < HOME_NAME_MIN || name.length > HOME_NAME_MAX) {
    return { ok: false, error: HOME_NAME_LENGTH_ERROR };
  }
  if (!NAME_CHARS.test(name)) return { ok: false, error: HOME_NAME_CHARS_ERROR };
  return { ok: true, name };
}
