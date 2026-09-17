import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRADE_SLOT_COUNT, tradeInventoryFullError } from '../shared/trade';
import { tradeAcceptEnabled, tradeMoneyCaption, tradeReadyLabel, tradeSlotCount, tradeWindowChrome } from '../src/ui/tradeGui';

const STYLE = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

describe('trade GUI helpers', () => {
  it('uses six trade slots and two-stage confirmation copy', () => {
    expect(tradeSlotCount()).toBe(TRADE_SLOT_COUNT);
    expect(TRADE_SLOT_COUNT).toBe(6);
    expect(tradeReadyLabel(false, false)).toContain('Вы не готовы');
    expect(tradeReadyLabel(false, false)).toContain('Партнёр не готов');
    expect(tradeReadyLabel(true, true)).toContain('Вы готовы');
    expect(tradeReadyLabel(true, true)).toContain('Партнёр готов');
    expect(tradeAcceptEnabled({ bothReady: false, selfAccepted: false, partnerAccepted: false })).toBe(false);
    expect(tradeAcceptEnabled({ bothReady: true, selfAccepted: false, partnerAccepted: false })).toBe(true);
    expect(tradeAcceptEnabled({ bothReady: true, selfAccepted: true, partnerAccepted: false })).toBe(false);
  });

  it('renders inventory-style trade chrome with money, ready and cancel', () => {
    const html = tradeWindowChrome({
      type: 'trade',
      screen: 'session',
      title: 'Обмен',
      partnerName: 'Bob',
      selfReady: false,
      partnerReady: false,
      bothReady: false,
      moneyText: '100',
      money: 100,
      partnerMoney: 500,
      partnerMoneyText: '500',
    }, (value) => value, {
      self: '[self]',
      partner: '[partner]',
      inventory: '[inv]',
    });
    expect(html).toContain('Вы отдаёте');
    expect(html).toContain('Bob');
    expect(html).toContain('Монет:');
    expect(html).toContain('data-trade-money');
    expect(html).toContain('value="100"');
    expect(html).toContain('data-trade-partner-money');
    expect(html).toContain(tradeMoneyCaption('500'));
    expect(html.indexOf('data-trade-money')).toBeLessThan(html.indexOf('data-trade-partner-money'));
    expect(html).toContain('data-trade-action="ready"');
    expect(html).toContain('data-trade-action="accept"');
    expect(html).toContain('data-trade-action="cancel"');
    expect(html).toContain('Отклонить');
    expect(html).toContain(' disabled');
    expect(html).toContain('[self]');
    expect(html).toContain('[partner]');
    expect(html).toContain('[inv]');
    expect(tradeMoneyCaption(undefined)).toBe('Монет: 0');
    expect(STYLE).toContain('.mc-trade-money-partner');
    expect(STYLE).toContain('.mc-trade-side');
    expect(tradeInventoryFullError('Ada')).toBe('У Ada недостаточно места в инвентаре для обмена');
  });
});
