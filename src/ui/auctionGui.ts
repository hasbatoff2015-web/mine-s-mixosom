import type { ItemStack } from '../inventory';

export const AUCTION_CLAIM_HINT = 'Заберите этот предмет';
export const AUCTION_CLAIMABLE_CLASS = 'mc-ah-claimable';

/** Keep the live search draft when the field itself is focused (do not clobber caret/value). */
export function keepAuctionSearchDraft(active: EventTarget | null, input: HTMLInputElement | null): boolean {
  return input !== null && active === input;
}

/** Icon stack shown in sell-confirm / buy: count follows the listing amount, not the original inventory stack. */
export function auctionIconStack(item: ItemStack | null, amount: number | undefined): ItemStack | null {
  if (!item) return null;
  if (amount === undefined) return item;
  return { ...item, count: amount };
}

export function clampAuctionAmount(next: number, min: number, max: number): number {
  if (!Number.isFinite(next) || !Number.isFinite(min) || !Number.isFinite(max)) return min;
  return Math.max(min, Math.min(max, Math.trunc(next)));
}

/** CANCELLED / EXPIRED lots in `/ah list` are claimable. RELISTED / CLAIMED / SOLD / ACTIVE are not. */
export function isAuctionClaimableStatus(status: string | undefined): boolean {
  return status === 'CANCELLED' || status === 'EXPIRED';
}

export function auctionClaimableClass(status: string | undefined): string {
  return isAuctionClaimableStatus(status) ? AUCTION_CLAIMABLE_CLASS : '';
}

export function auctionClaimHint(status: string | undefined): string | undefined {
  return isAuctionClaimableStatus(status) ? AUCTION_CLAIM_HINT : undefined;
}
