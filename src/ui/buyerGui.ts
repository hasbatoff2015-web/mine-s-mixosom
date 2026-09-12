import { formatCompactMegacoins } from '../../shared/megacoins';
import type { ItemStack } from '../inventory';

export const BUYER_SELL_LABEL = 'ПРОДАТЬ';
export const BUYER_SAVE_LABEL = 'Сохранить';
export const BUYER_DELETE_LABEL = 'Удалить скупщика';
export const BUYER_PICK_LABEL = 'Выбрать товар';
export const BUYER_TRADE_LABEL = 'Открыть торговлю';
export const BUYER_HOLOGRAM_LABEL = 'Настроить голограмму';
export const BUYER_ADMIN_TITLE = 'Настройка скупщика';
export const BUYER_PICK_PROMPT = 'Выберите предмет из инвентаря';
export const BUYER_UNSELECTED_ITEM = 'Товар не выбран';

export interface BuyerScreenMarkup {
  readonly screen: string;
  readonly title: string;
  readonly name: string;
  readonly itemName?: string;
  readonly hologramText: string;
  readonly priceText: string;
  readonly priceLine: string;
  readonly quantity: number;
  readonly maxQuantity: number;
  readonly totalLabel: string;
  readonly configured: boolean;
  readonly messageHtml: string;
  readonly itemSlotHtml: string;
  readonly tradeSlotHtml: string;
  readonly inventoryHtml: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!
  ));
}

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

export function buyerSellDisabled(configured: boolean, quantity: number): boolean {
  return !configured || quantity < 1;
}

export function buyerScreenHtml(view: BuyerScreenMarkup): string {
  if (view.screen === 'pick-item') {
    return `<div class="mc-ah-body" data-buyer-screen="pick-item">
        <div class="mc-label">${escapeHtml(view.title)}</div>
        <p class="mc-ah-prompt">${BUYER_PICK_PROMPT}</p>
        <div data-buyer-inventory>${view.inventoryHtml}</div>
        <div class="mc-ah-actions">
          <button type="button" class="mc-ah-btn" data-buyer-action="back">НАЗАД</button>
        </div>
        ${view.messageHtml}
      </div>`;
  }
  if (view.screen === 'trade') {
    const amount = Math.max(0, view.quantity);
    const max = Math.max(amount, view.maxQuantity);
    const sellDisabled = buyerSellDisabled(view.configured, amount) ? ' disabled' : '';
    return `<div class="mc-ah-body" data-buyer-screen="trade">
        <div class="mc-label">${escapeHtml(view.title)}</div>
        <div class="mc-ah-center" data-buyer-item>${view.itemSlotHtml}</div>
        <p class="mc-ah-prompt" data-buyer-price-line>${escapeHtml(view.priceLine)}</p>
        <div class="mc-ah-amount">
          <button type="button" class="mc-slot mc-ah-icon" data-buyer-delta="-1"${amount <= 1 ? ' disabled' : ''} aria-label="Меньше">−</button>
          <div data-buyer-trade>${view.tradeSlotHtml}</div>
          <button type="button" class="mc-slot mc-ah-icon" data-buyer-delta="1"${amount >= max ? ' disabled' : ''} aria-label="Больше">+</button>
        </div>
        <p class="mc-ah-prompt">Количество: <span data-buyer-qty>${amount}</span></p>
        <p class="mc-ah-prompt">Вы получите: <span data-buyer-total>${escapeHtml(view.totalLabel)}</span></p>
        <div data-buyer-inventory>${view.inventoryHtml}</div>
        <div class="mc-ah-actions">
          <button type="button" class="mc-ah-btn" data-buyer-action="sell"${sellDisabled}>${BUYER_SELL_LABEL}</button>
        </div>
        ${view.messageHtml}
      </div>`;
  }
  return `<div class="mc-ah-body" data-buyer-screen="admin">
      <div class="mc-label">${escapeHtml(view.title)}</div>
      <label class="mc-ah-field">Имя
        <input data-buyer-name type="text" maxlength="32" value="${escapeHtml(view.name)}" autocomplete="off" spellcheck="false" name="buyer-name" />
      </label>
      <div class="mc-ah-center" data-buyer-item>${view.itemSlotHtml}</div>
      <p class="mc-ah-prompt">${escapeHtml(view.itemName ?? BUYER_UNSELECTED_ITEM)}</p>
      <label class="mc-ah-field">Цена за 1 шт.
        <input data-buyer-price type="text" inputmode="numeric" maxlength="9" value="${escapeHtml(view.priceText)}" autocomplete="off" spellcheck="false" name="buyer-price" />
      </label>
      <div class="mc-ah-actions">
        <button type="button" class="mc-ah-btn mc-ah-btn-2line" data-buyer-action="edit_hologram" aria-label="${BUYER_HOLOGRAM_LABEL}">
          Настроить
          <small>голограмму</small>
        </button>
        <button type="button" class="mc-ah-btn" data-buyer-action="pick_item">${BUYER_PICK_LABEL}</button>
        <button type="button" class="mc-ah-btn" data-buyer-action="save">${BUYER_SAVE_LABEL}</button>
        <button type="button" class="mc-ah-btn" data-buyer-action="open_trade">${BUYER_TRADE_LABEL}</button>
        <button type="button" class="mc-ah-btn" data-buyer-action="delete">${BUYER_DELETE_LABEL}</button>
      </div>
      ${view.messageHtml}
    </div>`;
}
