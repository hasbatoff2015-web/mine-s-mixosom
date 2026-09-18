export const CLAN_PLUGIN_NAME = 'clan';
export const CLAN_MAX_MEMBERS = 20;
export const CLAN_CREATE_COST = 10_000;
export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 16;
export const CLAN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const CLAN_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const CLAN_PAGE_SIZE = 6;

export const CLAN_ICON_IDS = [
  'swords',
  'shield',
  'flame',
  'crown',
  'skull',
  'dragon',
  'moon',
  'lightning',
  'crystal',
  'mask',
] as const;

export type ClanIconId = (typeof CLAN_ICON_IDS)[number];

export const CLAN_ICON_GLYPH: Record<ClanIconId, string> = {
  swords: '⚔',
  // U+1F6E1 without VS16 is a text-presentation codepoint and often renders blank
  // in UI fonts. FE0F forces the color-emoji shield while keeping icon id `shield`.
  shield: '🛡️',
  flame: '🔥',
  crown: '👑',
  skull: '💀',
  dragon: '🐉',
  moon: '🌙',
  lightning: '⚡',
  crystal: '💎',
  mask: '🎭',
};

export const CLAN_NAME_LENGTH_ERROR = 'Название клана должно содержать от 3 до 16 символов.';
export const CLAN_NAME_CHARS_ERROR = 'Название может содержать только буквы, цифры, пробел, _ и -.';
export const CLAN_NAME_UNSAFE_ERROR = 'Недопустимое название клана.';

const NAME_CHARS = /^[\p{L}\p{N} _-]+$/u;
const UNSAFE_NAME = /[<>&"'`\\]|[\u0000-\u001f\u007f]/;

export function isClanIconId(value: string | undefined): value is ClanIconId {
  return value !== undefined && (CLAN_ICON_IDS as readonly string[]).includes(value);
}

export function clanNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function validateClanName(raw: string | undefined): { ok: true; name: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: false, error: CLAN_NAME_LENGTH_ERROR };
  if (UNSAFE_NAME.test(raw)) return { ok: false, error: CLAN_NAME_UNSAFE_ERROR };
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < CLAN_NAME_MIN || name.length > CLAN_NAME_MAX) {
    return { ok: false, error: CLAN_NAME_LENGTH_ERROR };
  }
  if (!NAME_CHARS.test(name)) return { ok: false, error: CLAN_NAME_CHARS_ERROR };
  return { ok: true, name };
}

export interface ClanCreatePolicy {
  canCreateClan(playerId: string): { ok: true } | { ok: false; error: string };
}

/** Future PlaytimeService plugs in here. Today creation has no playtime gate. */
export const defaultClanCreatePolicy: ClanCreatePolicy = {
  canCreateClan: () => ({ ok: true }),
};
