import type { ItemStack } from '../inventory';

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
