import { describe, expect, it } from 'vitest';
import { createItemStack } from '../src/inventory';
import { formatCompactMegacoins } from '../shared/megacoins';
import {
  BUYER_ADMIN_TITLE,
  BUYER_DELETE_LABEL,
  BUYER_PICK_LABEL,
  BUYER_PICK_PROMPT,
  BUYER_SAVE_LABEL,
  BUYER_SELL_LABEL,
  BUYER_TRADE_LABEL,
  BUYER_UNSELECTED_ITEM,
  buyerPriceEachLabel,
  buyerScreenHtml,
  buyerSellDisabled,
  buyerShowsAdminFields,
  buyerShowsInventoryGrid,
  buyerTotalLabel,
  buyerTradeSlotAccepts,
  clampBuyerAmount,
  keepBuyerDraft,
} from '../src/ui/buyerGui';
import {
  BUYER_EXAMPLE_GOLDEN_APPLE_PRICE,
  BUYER_EXAMPLE_PUMPKIN_PRICE,
  buyerPayout,
  parseBuyerPrice,
} from '../shared/buyers';

describe('buyer GUI helpers', () => {
  it('keeps admin drafts only while that input is focused', () => {
    const input = { id: 'name' } as HTMLInputElement;
    const other = { id: 'other' } as HTMLInputElement;
    expect(keepBuyerDraft(input, input)).toBe(true);
    expect(keepBuyerDraft(other, input)).toBe(false);
    expect(keepBuyerDraft(null, input)).toBe(false);
  });

  it('shows inventory picker and trade grid, and admin fields on the setup screen', () => {
    expect(buyerShowsInventoryGrid('pick-item')).toBe(true);
    expect(buyerShowsInventoryGrid('trade')).toBe(true);
    expect(buyerShowsInventoryGrid('admin')).toBe(false);
    expect(buyerShowsAdminFields('admin')).toBe(true);
    expect(buyerShowsAdminFields('trade')).toBe(false);
  });

  it('accepts only the configured item in the trade slot', () => {
    expect(buyerTradeSlotAccepts('pumpkin', createItemStack('pumpkin', 32))).toBe(true);
    expect(buyerTradeSlotAccepts('pumpkin', createItemStack('melon', 32))).toBe(false);
    expect(buyerTradeSlotAccepts('pumpkin', null)).toBe(false);
    expect(buyerTradeSlotAccepts(undefined, createItemStack('pumpkin', 1))).toBe(false);
  });

  it('clamps quantity and formats compact totals', () => {
    expect(clampBuyerAmount(0, 1, 64)).toBe(1);
    expect(clampBuyerAmount(32, 1, 64)).toBe(32);
    expect(clampBuyerAmount(80, 1, 64)).toBe(64);
    expect(buyerPayout(32, BUYER_EXAMPLE_PUMPKIN_PRICE)).toBe(1600);
    expect(buyerTotalLabel(1600, true)).toBe(`${formatCompactMegacoins(1600)} МК`);
    expect(buyerPriceEachLabel(BUYER_EXAMPLE_PUMPKIN_PRICE)).toContain('50');
    expect(buyerPriceEachLabel(BUYER_EXAMPLE_GOLDEN_APPLE_PRICE)).toContain('600');
    expect(parseBuyerPrice('50')).toBe(50);
  });

  it('keeps inventory-style button captions and unconfigured price copy', () => {
    expect(BUYER_SELL_LABEL).toBe('ПРОДАТЬ');
    expect(BUYER_SAVE_LABEL).toBe('Сохранить');
    expect(BUYER_PICK_LABEL).toBe('Выбрать товар');
    expect(BUYER_DELETE_LABEL).toBe('Удалить скупщика');
    expect(BUYER_TRADE_LABEL).toBe('Открыть торговлю');
    expect(buyerPriceEachLabel(undefined)).toBe('Цена не задана');
    expect(buyerShowsAdminFields('pick-item')).toBe(false);
    expect(buyerShowsInventoryGrid('admin')).toBe(false);
  });

  it('renders admin, picker and trade markup without HP and with a disabled sell button', () => {
    const admin = buyerScreenHtml({
      screen: 'admin',
      title: BUYER_ADMIN_TITLE,
      name: 'Фермер',
      hologramText: 'ПРИЁМ ТЫКВ',
      priceText: '50',
      priceLine: buyerPriceEachLabel(50),
      quantity: 0,
      maxQuantity: 0,
      totalLabel: '0 МК',
      configured: false,
      messageHtml: '',
      itemSlotHtml: '<div class="mc-slot"></div>',
      tradeSlotHtml: '',
      inventoryHtml: '',
    });
    expect(admin).toContain('data-buyer-screen="admin"');
    expect(admin).toContain(BUYER_ADMIN_TITLE);
    expect(admin).toContain('Имя');
    expect(admin).toContain(BUYER_UNSELECTED_ITEM);
    expect(admin).toContain('Цена за 1 шт.');
    expect(admin).toContain('Голограмма');
    expect(admin).toContain(BUYER_PICK_LABEL);
    expect(admin).toContain(BUYER_SAVE_LABEL);
    expect(admin).toContain(BUYER_DELETE_LABEL);
    expect(admin).toContain('mc-ah-btn');
    expect(admin).not.toMatch(/HP|20\/20|здоров/i);

    const picker = buyerScreenHtml({
      screen: 'pick-item',
      title: BUYER_ADMIN_TITLE,
      name: 'Фермер',
      hologramText: '',
      priceText: '',
      priceLine: '',
      quantity: 0,
      maxQuantity: 0,
      totalLabel: '',
      configured: false,
      messageHtml: '',
      itemSlotHtml: '',
      tradeSlotHtml: '',
      inventoryHtml: '<div class="mc-grid mc-grid-9"></div>',
    });
    expect(picker).toContain('data-buyer-screen="pick-item"');
    expect(picker).toContain('data-buyer-inventory');
    expect(picker).toContain(BUYER_PICK_PROMPT);
    expect(picker).toContain('data-buyer-action="back"');

    expect(buyerSellDisabled(true, 0)).toBe(true);
    expect(buyerSellDisabled(false, 32)).toBe(true);
    expect(buyerSellDisabled(true, 32)).toBe(false);
    const trade = buyerScreenHtml({
      screen: 'trade',
      title: 'Скупщик Фермер',
      name: 'Фермер',
      hologramText: '',
      priceText: '50',
      priceLine: buyerPriceEachLabel(50),
      quantity: 32,
      maxQuantity: 64,
      totalLabel: '1 600 Мегакоинов',
      configured: true,
      messageHtml: '',
      itemSlotHtml: '<div class="mc-slot" data-item="pumpkin"></div>',
      tradeSlotHtml: '<div class="mc-slot" data-item="pumpkin"></div>',
      inventoryHtml: '<div class="mc-grid mc-grid-9"></div>',
    });
    expect(trade).toContain('Скупщик Фермер');
    expect(trade).toContain('Количество:');
    expect(trade).toContain('32');
    expect(trade).toContain('1 600 Мегакоинов');
    expect(trade).toContain(BUYER_SELL_LABEL);
    expect(trade).toContain('data-buyer-inventory');
    expect(trade).not.toContain(' disabled');
    const emptyTrade = buyerScreenHtml({
      screen: 'trade',
      title: 'Скупщик Фермер',
      name: 'Фермер',
      hologramText: '',
      priceText: '50',
      priceLine: buyerPriceEachLabel(50),
      quantity: 0,
      maxQuantity: 32,
      totalLabel: '0 МК',
      configured: true,
      messageHtml: '',
      itemSlotHtml: '',
      tradeSlotHtml: '',
      inventoryHtml: '',
    });
    expect(emptyTrade).toContain('data-buyer-action="sell" disabled');
    expect(emptyTrade).not.toMatch(/HP|20\/20/);
  });
});
