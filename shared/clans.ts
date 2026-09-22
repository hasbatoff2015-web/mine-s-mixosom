export const CLAN_PLUGIN_NAME = 'clan';
export const CLAN_MAX_MEMBERS = 20;
export const CLAN_CREATE_COST = 10_000;
export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 16;
export const CLAN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const CLAN_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const CLAN_ANNOUNCEMENT_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const CLAN_BASE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
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

export const CLAN_ROLES = ['leader', 'veteran', 'member'] as const;
export type ClanRole = (typeof CLAN_ROLES)[number];

export const CLAN_ROLE_LABEL: Record<ClanRole, string> = {
  leader: 'Глава',
  veteran: 'Ветеран',
  member: 'Участник',
};

export const CLAN_PLAYER_NOT_FOUND_ERROR = 'Игрок не найден';
export const CLAN_ALREADY_IN_THIS_CLAN_ERROR = 'Игрок уже состоит в этом клане';
export const CLAN_ALREADY_IN_OTHER_CLAN_ERROR = 'Игрок уже состоит в другом клане';
export const CLAN_INVITE_EXISTS_ERROR = 'Игрок уже получил приглашение';
export const CLAN_INVITE_EMPTY_ERROR = 'Введите ник игрока.';
export const CLAN_INVITE_SENT_MESSAGE = 'Приглашение отправлено';
export const CLAN_TRANSFER_VETERAN_ONLY_ERROR = 'Передать главу можно только ветерану.';
export const CLAN_NO_VETERAN_ERROR = 'Нет ветеранов для передачи главы.';
export const CLAN_PROMOTE_MEMBER_ONLY_ERROR = 'Назначить ветераном можно только участника.';
export const CLAN_DEMOTE_VETERAN_ONLY_ERROR = 'Снять роль ветерана можно только с ветерана.';
export const CLAN_KICK_DENIED_ERROR = 'Нельзя выгнать этого игрока.';

export const CLAN_NAME_LENGTH_ERROR = 'Название клана должно содержать от 3 до 16 символов.';
export const CLAN_NAME_CHARS_ERROR = 'Название может содержать только буквы, цифры, пробел, _ и -.';
export const CLAN_NAME_UNSAFE_ERROR = 'Недопустимое название клана.';
export const CLAN_ANNOUNCE_EMPTY_ERROR = 'Введите текст объявления.';
export const CLAN_ANNOUNCE_COOLDOWN_PREFIX = 'Повторная отправка через ';
export const CLAN_BASE_SET_LABEL = 'Добавить точку базы клана';
export const CLAN_BASE_CHANGE_LABEL = 'Изменить точку базы клана';
export const CLAN_BASE_TELEPORT_LABEL = 'Телепорт на базу клана';
export const CLAN_BASE_PRESENT_LABEL = 'База клана: установлена';
export const CLAN_BASE_ABSENT_LABEL = 'База клана не установлена';
export const CLAN_BASE_OVERLAP_ERROR = 'Нельзя установить точку базы: зона пересекается с существующим приватом.';
export const CLAN_BASE_ANCHOR_ERROR = 'Невозможно установить точку базы на этой позиции.';
export const CLAN_BASE_POSITION_ERROR = 'Некорректная позиция для точки базы.';
export const CLAN_BASE_MISSING_ERROR = 'База клана не установлена.';
export const CLAN_BASE_WORLD_ERROR = 'База клана находится в другом мире.';
export const CLAN_BASE_ALREADY_HERE_ERROR = 'База клана уже установлена здесь.';
export const CLAN_BASE_COOLDOWN_PREFIX = 'Изменение доступно через ';
export const CLAN_BASE_SET_MESSAGE = 'Точка базы клана установлена.';
export const CLAN_BASE_CHANGED_MESSAGE = 'Точка базы клана изменена.';
export const CLAN_BASE_TELEPORT_MESSAGE = 'Телепорт на базу клана.';
export const CLAN_BASE_CONFIRM_PROMPT =
  'Вы уверены, что хотите добавить точку базы клана?\nТочка установиться в месте где вы стоите прямо сейчас.';
export const CLAN_BASE_CHANGE_CONFIRM_PROMPT =
  'Вы уверены, что хотите изменить точку базы клана?\nТочка установиться в месте где вы стоите прямо сейчас.';

export function clanBaseConfirmPrompt(hasBase: boolean): string {
  return hasBase ? CLAN_BASE_CHANGE_CONFIRM_PROMPT : CLAN_BASE_CONFIRM_PROMPT;
}

export function isClanRole(value: string | undefined): value is ClanRole {
  return value !== undefined && (CLAN_ROLES as readonly string[]).includes(value);
}

export function clanRoleLabel(role: ClanRole | undefined): string {
  return role ? CLAN_ROLE_LABEL[role] : CLAN_ROLE_LABEL.member;
}

export function canClanInvite(role: ClanRole | undefined): boolean {
  return role === 'leader' || role === 'veteran';
}

export function canClanKick(actor: ClanRole | undefined, target: ClanRole | undefined): boolean {
  if (actor === 'leader') return target === 'veteran' || target === 'member';
  if (actor === 'veteran') return target === 'member';
  return false;
}

export function canClanManageVeterans(role: ClanRole | undefined): boolean {
  return role === 'leader';
}

export function canClanAnnounce(role: ClanRole | undefined): boolean {
  return role === 'leader';
}

export function canClanSetBase(role: ClanRole | undefined): boolean {
  return role === 'leader';
}

export function clanInviteChat(inviterName: string, clanName: string): string {
  return `Игрок ${inviterName} пригласил вас в клан ${clanName}. Примите приглашение в меню`;
}

export function clanAnnouncementChat(text: string): string {
  return `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] - ${text}`;
}

export function formatRemainingDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч`;
  if (minutes > 0) return `${minutes} мин`;
  return 'меньше минуты';
}

export function clanAnnounceCooldownLabel(remainingMs: number): string {
  return `${CLAN_ANNOUNCE_COOLDOWN_PREFIX}${formatRemainingDuration(remainingMs)}`;
}

export function clanBaseCooldownLabel(remainingMs: number): string {
  return `${CLAN_BASE_COOLDOWN_PREFIX}${formatRemainingDuration(remainingMs)}`;
}

export function canClanTransferLeader(actor: ClanRole | undefined, target: ClanRole | undefined): boolean {
  return actor === 'leader' && target === 'veteran';
}

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
