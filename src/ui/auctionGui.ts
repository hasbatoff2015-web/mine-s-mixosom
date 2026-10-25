import type { ItemStack } from '../inventory';
import type { AuctionScreenKind, ServerAuctionMessage } from '../../shared/protocol';

export type AuctionBackParent = 'menu' | 'browse' | 'sell-pick' | 'mine';

/**
 * One back control for the screen that can leave it.
 * Top-level screens return to the game menu only when the auction was opened from there.
 * Nested screens return to their parent. `/ah` browse has no menu to return to.
 */
export function auctionBackParent(
  screen: AuctionScreenKind,
  source: 'menu' | undefined,
): AuctionBackParent | null {
  if (screen === 'buy') return 'browse';
  if (screen === 'sell-confirm') return 'sell-pick';
  if (screen === 'manage' || screen === 'claim' || screen === 'relist') return 'mine';
  if (source === 'menu' && (screen === 'browse' || screen === 'sell-pick' || screen === 'mine')) return 'menu';
  return null;
}

export function auctionShowsBack(screen: AuctionScreenKind, source: 'menu' | undefined): boolean {
  return auctionBackParent(screen, source) !== null;
}

export function auctionBackButtonHtml(): string {
  return '<button type="button" class="mc-close mc-back" data-ah-action="back" aria-label="Назад">←</button>';
}

/** Buy / sell / manage forms are per listing or inventory slot. Browse is not. */
export function auctionFormContext(state: Pick<ServerAuctionMessage, 'screen' | 'selected'>): string {
  if (
    state.screen === 'buy'
    || state.screen === 'manage'
    || state.screen === 'claim'
    || state.screen === 'relist'
    || state.screen === 'sell-confirm'
  ) {
    if (state.selected?.listingId) return state.selected.listingId;
    if (state.selected?.slot !== undefined) return `slot:${state.selected.slot}`;
  }
  return '';
}

export function auctionLogicalHeight(screen: string): number {
  if (screen === 'sell-pick') return 222;
  if (screen === 'browse') return 216;
  if (screen === 'mine') return 200;
  if (screen === 'manage') return 236;
  if (screen === 'sell-confirm') return 204;
  return 218;
}

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

/** Claim copy wins. Otherwise the existing yellow hint can carry the item description. */
export function auctionSlotHint(status: string | undefined, description: string | undefined): string | undefined {
  const claim = auctionClaimHint(status);
  if (claim) return claim;
  const text = description?.trim();
  return text ? text : undefined;
}
