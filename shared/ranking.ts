import { formatMegacoinAmount } from './megacoins';

export const RANKING_PAGE_SIZE = 10;
export const RANKING_MAX_ENTRIES = 50;
export const RANKING_MAX_PAGES = 5;
export const RANKING_KILLS_SUFFIX = 'Уб.';
export const RANKING_SWORD = '🗡️';
export const RANKING_NO_CLAN_MESSAGE = 'Вы не состоите в клане';

export const RANKING_KINDS = ['players-money', 'players-kills', 'clans-money', 'clans-kills'] as const;
export type RankingKind = (typeof RANKING_KINDS)[number];

export type ClanMemberSort = 'money' | 'kills';

export function isRankingKind(value: string | undefined): value is RankingKind {
  return value !== undefined && (RANKING_KINDS as readonly string[]).includes(value);
}

export function isClanMemberSort(value: string | undefined): value is ClanMemberSort {
  return value === 'money' || value === 'kills';
}

export function rankingTotalPages(count: number): number {
  const capped = Math.max(0, Math.min(RANKING_MAX_ENTRIES, Math.trunc(count) || 0));
  return Math.max(1, Math.min(RANKING_MAX_PAGES, Math.ceil(capped / RANKING_PAGE_SIZE) || 1));
}

export function clampRankingPage(page: number, totalCount: number): number {
  const totalPages = rankingTotalPages(totalCount);
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(totalPages, Math.trunc(page)));
}

export function sliceRankingPage<T>(items: readonly T[], page: number): {
  items: T[];
  page: number;
  totalPages: number;
  totalCount: number;
} {
  const capped = items.slice(0, RANKING_MAX_ENTRIES);
  const totalPages = rankingTotalPages(capped.length);
  const current = clampRankingPage(page, capped.length);
  const start = (current - 1) * RANKING_PAGE_SIZE;
  return {
    items: capped.slice(start, start + RANKING_PAGE_SIZE) as T[],
    page: current,
    totalPages,
    totalCount: capped.length,
  };
}

export function compareDescThenName(aValue: number, bValue: number, aName: string, bName: string): number {
  if (bValue !== aValue) return bValue - aValue;
  return aName.localeCompare(bName, 'ru', { sensitivity: 'base' });
}

export function formatKillsLabel(amount: number): string {
  return `${RANKING_SWORD} ${formatMegacoinAmount(amount)} ${RANKING_KILLS_SUFFIX}`;
}

export function personalRankText(rank: number | undefined): string {
  if (rank === undefined || rank <= 0) return '';
  return `Ваше место: #${rank}`;
}
