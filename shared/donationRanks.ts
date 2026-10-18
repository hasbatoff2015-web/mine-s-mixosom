/**
 * Timed donate ranks. Plugins ask this module for limits and permission nodes.
 * They do not branch on rank names.
 */

export const DONATION_DAY_MS = 24 * 60 * 60 * 1000;
export const DONATION_WEEK_MS = 7 * DONATION_DAY_MS;
/** Issued length of VIP, PREMIUM, BOSS, and TITAN. Grant and extend take this unless a caller passes another duration. */
export const DONATION_RANK_DURATION_MS = 30 * DONATION_DAY_MS;

export const DONATION_RANKS = ['vip', 'premium', 'boss', 'titan'] as const;
export type DonationRankId = (typeof DONATION_RANKS)[number];
export type EffectiveRank = 'default' | DonationRankId;

export const RANK_ORDER: Record<EffectiveRank, number> = {
  default: 0,
  vip: 1,
  premium: 2,
  boss: 3,
  titan: 4,
};

export interface RankLimits {
  readonly homes: number;
  readonly claims: number;
  readonly auction: number;
  /** Null keeps the existing unlimited `/back` rules for a death location. */
  readonly deathBackPerDay: number | null;
  readonly coordTeleportPerDay: number;
  readonly invseePerDay: number;
  readonly announcePerDay: number;
}

export const RANK_LIMITS: Record<EffectiveRank, RankLimits> = {
  default: { homes: 3, claims: 3, auction: 7, deathBackPerDay: null, coordTeleportPerDay: 0, invseePerDay: 0, announcePerDay: 0 },
  vip: { homes: 4, claims: 4, auction: 10, deathBackPerDay: null, coordTeleportPerDay: 0, invseePerDay: 0, announcePerDay: 0 },
  premium: { homes: 5, claims: 5, auction: 15, deathBackPerDay: null, coordTeleportPerDay: 0, invseePerDay: 0, announcePerDay: 1 },
  boss: { homes: 6, claims: 6, auction: 20, deathBackPerDay: 1, coordTeleportPerDay: 0, invseePerDay: 0, announcePerDay: 1 },
  titan: { homes: 7, claims: 7, auction: 25, deathBackPerDay: 2, coordTeleportPerDay: 1, invseePerDay: 1, announcePerDay: 1 },
};

export type LimitKind = 'homes' | 'claims' | 'auction';

export function limitForRank(rank: EffectiveRank, kind: LimitKind): number {
  return RANK_LIMITS[rank][kind];
}

/** Nodes added by a rank. Each entry is only the new nodes; callers union lower ranks. */
const RANK_ADDED_NODES: Record<DonationRankId, readonly string[]> = {
  vip: ['donate.rank.vip', 'enderchest.use', 'kit.use.vip', 'kit.use.food_vip'],
  premium: [
    'donate.rank.premium',
    'announce.use',
    'nick.color',
    'kit.use.prem',
    'kit.use.food_prem',
  ],
  boss: ['donate.rank.boss', 'back.death', 'kit.use.boss', 'kit.use.food_boss'],
  titan: ['donate.rank.titan', 'tp.coords', 'invsee.use', 'kit.use.titan', 'kit.use.food_titan'],
};

const ADMIN_NODE_PREFIXES = ['admin', 'server.', 'plugins.manage', 'server.admin'];

export function isDonationRank(value: string): value is DonationRankId {
  return (DONATION_RANKS as readonly string[]).includes(value);
}

export function parseDonationRank(raw: string | undefined): DonationRankId | undefined {
  const name = raw?.trim().toLowerCase();
  if (!name || !isDonationRank(name)) return undefined;
  return name;
}

/** Cumulative nodes for a rank. Never includes operator or server wildcards. */
export function permissionNodesForRank(rank: EffectiveRank): string[] {
  if (rank === 'default') return [];
  const nodes: string[] = [];
  for (const candidate of DONATION_RANKS) {
    if (RANK_ORDER[candidate] > RANK_ORDER[rank]) break;
    nodes.push(...RANK_ADDED_NODES[candidate]);
  }
  return nodes;
}

export function donationNodesAreNonAdmin(nodes: readonly string[]): boolean {
  return nodes.every((node) => {
    const lower = node.toLowerCase();
    if (lower === '*' || lower.endsWith('.*')) return false;
    return !ADMIN_NODE_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix));
  });
}

export interface KitAccessRule {
  readonly name: string;
  readonly permission: string;
  /** Null means the existing one-time start ledger, not a sliding cooldown. */
  readonly periodMs: number | null;
}

const KIT_RULES: Record<string, KitAccessRule> = {
  start: { name: 'start', permission: 'player', periodMs: null },
  vip: { name: 'vip', permission: 'kit.use.vip', periodMs: DONATION_WEEK_MS },
  food_vip: { name: 'food_vip', permission: 'kit.use.food_vip', periodMs: DONATION_DAY_MS },
  prem: { name: 'prem', permission: 'kit.use.prem', periodMs: DONATION_WEEK_MS },
  food_prem: { name: 'food_prem', permission: 'kit.use.food_prem', periodMs: DONATION_DAY_MS },
  boss: { name: 'boss', permission: 'kit.use.boss', periodMs: DONATION_WEEK_MS },
  food_boss: { name: 'food_boss', permission: 'kit.use.food_boss', periodMs: DONATION_DAY_MS },
  titan: { name: 'titan', permission: 'kit.use.titan', periodMs: DONATION_WEEK_MS },
  food_titan: { name: 'food_titan', permission: 'kit.use.food_titan', periodMs: DONATION_DAY_MS },
};

export function kitAccessRule(name: string): KitAccessRule | undefined {
  return KIT_RULES[name];
}

export function kitsForRank(rank: EffectiveRank): KitAccessRule[] {
  return Object.values(KIT_RULES).filter((rule) => {
    if (rule.name === 'start') return true;
    return permissionNodesForRank(rank).includes(rule.permission);
  });
}

export const DONATION_COLORS = {
  yellow: '#ffe14a',
  light_purple: '#d27bff',
  red: '#ff5a5a',
  black: '#1a1a1a',
  white: '#f4f4f4',
  gold: '#ffd700',
  green: '#55ff55',
  aqua: '#55ffff',
  blue: '#5555ff',
  gray: '#aaaaaa',
  dark_green: '#00aa00',
  dark_aqua: '#00aaaa',
  dark_red: '#aa0000',
} as const;

export type DonationColorId = keyof typeof DONATION_COLORS;

/** Colors a PREMIUM, BOSS, or TITAN player may store. Prefix colors stay fixed. */
export const NICK_COLOR_IDS = [
  'white',
  'gold',
  'yellow',
  'green',
  'dark_green',
  'aqua',
  'dark_aqua',
  'blue',
  'light_purple',
  'red',
  'gray',
] as const satisfies readonly DonationColorId[];

export type NickColorId = (typeof NICK_COLOR_IDS)[number];

export function isNickColorId(value: string): value is NickColorId {
  return (NICK_COLOR_IDS as readonly string[]).includes(value);
}

export function isDonationColorId(value: string): value is DonationColorId {
  return Object.prototype.hasOwnProperty.call(DONATION_COLORS, value);
}

export interface RankPrefixStyle {
  readonly text: string;
  readonly color: DonationColorId;
  readonly bold: true;
}

export const RANK_PREFIX: Record<DonationRankId | 'admin', RankPrefixStyle> = {
  vip: { text: '[VIP]', color: 'yellow', bold: true },
  premium: { text: '[PREMIUM]', color: 'light_purple', bold: true },
  boss: { text: '[BOSS]', color: 'red', bold: true },
  titan: { text: '[TITAN]', color: 'black', bold: true },
  admin: { text: '[ADMIN]', color: 'yellow', bold: true },
};

export const ALLOWED_PREFIXES = new Set(Object.values(RANK_PREFIX).map((entry) => entry.text));

export interface PlayerNameStyle {
  readonly prefix?: string;
  readonly prefixColor?: DonationColorId;
  readonly nameColor?: DonationColorId;
  readonly bold?: boolean;
}

export function playerNameStyle(
  rank: EffectiveRank,
  operator: boolean,
  nickColor: NickColorId | undefined,
): PlayerNameStyle | undefined {
  if (operator) {
    return {
      prefix: RANK_PREFIX.admin.text,
      prefixColor: RANK_PREFIX.admin.color,
      bold: true,
      ...(nickColor ? { nameColor: nickColor } : {}),
    };
  }
  if (rank === 'default') return undefined;
  const prefix = RANK_PREFIX[rank];
  const colored = rank !== 'vip';
  return {
    prefix: prefix.text,
    prefixColor: prefix.color,
    bold: colored ? true : undefined,
    ...(colored && nickColor ? { nameColor: nickColor } : {}),
  };
}

export function sanitizePlayerNameStyle(value: unknown): PlayerNameStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { prefix?: unknown; prefixColor?: unknown; nameColor?: unknown; bold?: unknown };
  const prefix = typeof raw.prefix === 'string' && ALLOWED_PREFIXES.has(raw.prefix) ? raw.prefix : undefined;
  const prefixColor = typeof raw.prefixColor === 'string' && isDonationColorId(raw.prefixColor)
    ? raw.prefixColor
    : undefined;
  const nameColor = typeof raw.nameColor === 'string' && isNickColorId(raw.nameColor) ? raw.nameColor : undefined;
  const bold = raw.bold === true ? true : undefined;
  if (!prefix && !nameColor && !bold) return undefined;
  return {
    ...(prefix ? { prefix } : {}),
    ...(prefix && prefixColor ? { prefixColor } : {}),
    ...(nameColor ? { nameColor } : {}),
    ...(bold ? { bold } : {}),
  };
}

export const ANNOUNCE_TEXT_MAX = 120;

const ANNOUNCE_PREFIX = /\[(?:VIP|PREMIUM|BOSS|TITAN|ADMIN)\]/gi;

/** Drops control characters, formatting marks, and forged rank prefixes. */
export function sanitizeAnnouncementText(raw: string): string | undefined {
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[§&][0-9a-fk-or]/gi, '')
    .replace(/[§&]/g, '')
    .replace(ANNOUNCE_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > ANNOUNCE_TEXT_MAX) return undefined;
  return cleaned;
}

export function announcementLine(displayName: string, text: string): string {
  return `[ОБЪЯВЛЕНИЕ ОТ ИГРОКА ${displayName}] ${text}`;
}

const RANK_TEST_UNIT_MS = {
  s: 1000,
  m: 60_000,
  h: 60 * 60_000,
  d: DONATION_DAY_MS,
} as const;

/** DEV `/ranktest set` duration. A suffix is required so `30` is not silently 30 days. */
export function parseRankTestDuration(raw: string | undefined): { ok: true; ms: number } | { ok: false; error: string } {
  const match = raw?.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) {
    return { ok: false, error: 'Срок: <число><s|m|h|d>, например 30s, 5m, 2h или 1d.' };
  }
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof RANK_TEST_UNIT_MS;
  if (!Number.isInteger(amount) || amount < 1) {
    return { ok: false, error: 'Срок должен быть целым числом от 1.' };
  }
  const ms = amount * RANK_TEST_UNIT_MS[unit];
  if (ms > 3650 * DONATION_DAY_MS) {
    return { ok: false, error: 'Срок не длиннее 3650 дней.' };
  }
  return { ok: true, ms };
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

function ruPlural(value: number, one: string, few: string, many: string): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Date and remaining time, without the clock time of expiry. */
export function formatRankExpiry(expiresAt: number, now = Date.now()): string {
  const date = new Date(expiresAt);
  const day = date.getUTCDate();
  const month = RU_MONTHS[date.getUTCMonth()] ?? '';
  const left = Math.max(0, expiresAt - now);
  return `До ${day} ${month} · осталось ${formatRemainingWords(left)}`;
}

export function formatRemainingWords(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const word = (value: number, one: string, few: string, many: string) => (
    `${value} ${ruPlural(value, one, few, many)}`
  );
  if (days > 0) return `${word(days, 'день', 'дня', 'дней')} ${word(hours, 'час', 'часа', 'часов')}`;
  if (hours > 0) return `${word(hours, 'час', 'часа', 'часов')} ${word(minutes, 'минута', 'минуты', 'минут')}`;
  if (minutes > 0) return word(minutes, 'минута', 'минуты', 'минут');
  return 'меньше минуты';
}

export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  if (minutes > 0) return `${minutes}м ${seconds}с`;
  return `${seconds}с`;
}

export interface SlidingUse {
  readonly used: number;
  readonly limit: number;
  readonly remainingMs: number;
  readonly allowed: boolean;
}

export function slidingUse(stamps: readonly number[], limit: number, now: number, windowMs = DONATION_DAY_MS): SlidingUse {
  const live = stamps.filter((stamp) => now - stamp < windowMs && stamp <= now);
  const oldest = live.length > 0 ? Math.min(...live) : now;
  const remainingMs = live.length >= limit && limit > 0 ? Math.max(0, oldest + windowMs - now) : 0;
  return {
    used: live.length,
    limit,
    remainingMs,
    allowed: limit > 0 && live.length < limit,
  };
}

export interface DonationCommandInfo {
  readonly id: string;
  readonly usage: string;
  readonly available: boolean;
  readonly cooldownRemainingMs: number;
}

export interface DonationKitInfo {
  readonly name: string;
  readonly available: boolean;
  readonly cooldownRemainingMs: number;
  readonly once: boolean;
}

export interface DonationLimitInfo {
  readonly current?: number;
  readonly max: number;
}

export interface DonationStatus {
  readonly rank: EffectiveRank;
  readonly expiresAt?: number;
  readonly remainingMs: number;
  readonly limits: {
    readonly homes: DonationLimitInfo;
    readonly claims: DonationLimitInfo;
    readonly auction: DonationLimitInfo;
  };
  readonly commands: readonly DonationCommandInfo[];
  readonly kits: readonly DonationKitInfo[];
  readonly nick: {
    readonly canColor: boolean;
    readonly color?: NickColorId;
    readonly choices: readonly NickColorId[];
  };
  /** Set when the rank file could not be read. The menu must not invent a rank. */
  readonly loadError?: string;
}
