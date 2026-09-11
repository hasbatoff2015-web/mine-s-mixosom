import { describe, expect, it } from 'vitest';
import { createItemStack } from '../src/inventory';
import { formatCompactMegacoins } from '../shared/megacoins';
import {
  BUYER_DELETE_LABEL,
  BUYER_PICK_LABEL,
  BUYER_SAVE_LABEL,
  BUYER_SELL_LABEL,
  buyerPriceEachLabel,
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
    expect(buyerPriceEachLabel(undefined)).toBe('Цена не задана');
    expect(buyerShowsAdminFields('pick-item')).toBe(false);
    expect(buyerShowsInventoryGrid('admin')).toBe(false);
  });
});
