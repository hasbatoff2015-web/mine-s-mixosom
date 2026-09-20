export const AUCTION_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
export const AUCTION_HISTORY_UI_LIMIT = 20;
export const AUCTION_HISTORY_EMPTY = 'История сделок пуста';

export type AuctionHistoryKind = 'buy' | 'sell';

export function isAuctionHistoryKind(value: string | undefined): value is AuctionHistoryKind {
  return value === 'buy' || value === 'sell';
}

export function isAuctionHistoryFresh(
  timestamp: number,
  now: number,
  ttlMs = AUCTION_HISTORY_TTL_MS,
): boolean {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return false;
  return now - timestamp < ttlMs;
}

export function russianHoursWord(hours: number): string {
  const n = Math.max(0, Math.floor(hours));
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'час';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'часа';
  return 'часов';
}

export function formatHoursAgo(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return 'меньше часа назад';
  return `${hours} ${russianHoursWord(hours)} назад`;
}

export function auctionHistoryTitle(
  kind: AuctionHistoryKind,
  quantity: number,
  itemName: string,
  priceLabel: string,
): string {
  const verb = kind === 'sell' ? 'продали' : 'купили';
  return `Вы ${verb} ${quantity} ${itemName} за ${priceLabel}`;
}
