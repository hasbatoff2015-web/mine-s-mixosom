import { formatCompactMegacoins } from '../../shared/megacoins';
import type { ItemStack } from '../inventory';

export const BUYER_SELL_LABEL = 'ПРОДАТЬ';
export const BUYER_SAVE_LABEL = 'Сохранить';
export const BUYER_DELETE_LABEL = 'Удалить скупщика';
export const BUYER_PICK_LABEL = 'Выбрать товар';
export const BUYER_TRADE_LABEL = 'Открыть торговлю';

export function keepBuyerDraft(active: EventTarget | null, input: HTMLInputElement | null): boolean {
  return input !== null && active === input;
}

export function buyerTotalLabel(total: number, compact: boolean): string {
  if (compact) return `${formatCompactMegacoins(total)} МК`;
  return String(total);
}

export function buyerPriceEachLabel(price: number | undefined): string {
  if (price === undefined) return 'Цена не задана';
  return `${formatCompactMegacoins(price)} МК / шт.`;
}

export function buyerShowsInventoryGrid(screen: string): boolean {
  return screen === 'pick-item' || screen === 'trade';
}

export function buyerShowsAdminFields(screen: string): boolean {
  return screen === 'admin';
}

export function buyerTradeSlotAccepts(itemId: string | undefined, stack: ItemStack | null): boolean {
  if (!itemId || !stack) return false;
  return stack.itemId === itemId;
}

export function clampBuyerAmount(next: number, min: number, max: number): number {
  if (!Number.isFinite(next) || !Number.isFinite(min) || !Number.isFinite(max)) return min;
  return Math.max(min, Math.min(max, Math.trunc(next)));
}
