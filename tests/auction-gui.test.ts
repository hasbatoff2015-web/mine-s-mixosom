import { describe, expect, it } from 'vitest';
import { createItemStack } from '../src/inventory';
import {
  AUCTION_CLAIM_HINT,
  AUCTION_CLAIMABLE_CLASS,
  auctionClaimHint,
  auctionClaimableClass,
  auctionIconStack,
  clampAuctionAmount,
  isAuctionClaimableStatus,
  keepAuctionSearchDraft,
} from '../src/ui/auctionGui';
import { itemHoverAttributeString, splitAuctionTooltip } from '../src/ui/itemTooltip';

describe('auction GUI helpers', () => {
  it('keeps the search draft only while that input is focused', () => {
    const input = { id: 'search' } as HTMLInputElement;
    const other = { id: 'other' } as HTMLInputElement;
    expect(keepAuctionSearchDraft(input, input)).toBe(true);
    expect(keepAuctionSearchDraft(other, input)).toBe(false);
    expect(keepAuctionSearchDraft(null, input)).toBe(false);
    expect(keepAuctionSearchDraft(input, null)).toBe(false);
  });

  it('shows the chosen listing amount on the item icon stack', () => {
    const stack = createItemStack('stone', 64);
    expect(auctionIconStack(stack, 59)).toEqual({ ...stack, count: 59 });
    expect(auctionIconStack(stack, 1)).toEqual({ ...stack, count: 1 });
    expect(auctionIconStack(stack, 64)).toEqual({ ...stack, count: 64 });
    expect(auctionIconStack(stack, undefined)?.count).toBe(64);
    expect(auctionIconStack(null, 8)).toBeNull();
  });

  it('clamps the sell amount between 1 and the original stack', () => {
    expect(clampAuctionAmount(0, 1, 8)).toBe(1);
    expect(clampAuctionAmount(-4, 1, 8)).toBe(1);
    expect(clampAuctionAmount(1, 1, 8)).toBe(1);
    expect(clampAuctionAmount(7, 1, 8)).toBe(7);
    expect(clampAuctionAmount(8, 1, 8)).toBe(8);
    expect(clampAuctionAmount(9, 1, 8)).toBe(8);
    expect(clampAuctionAmount(64, 1, 8)).toBe(8);
  });

  it('treats only cancelled and expired lots as claimable UI cells', () => {
    expect(isAuctionClaimableStatus('CANCELLED')).toBe(true);
    expect(isAuctionClaimableStatus('EXPIRED')).toBe(true);
    expect(isAuctionClaimableStatus('ACTIVE')).toBe(false);
    expect(isAuctionClaimableStatus('SOLD')).toBe(false);
    expect(isAuctionClaimableStatus('RELISTED')).toBe(false);
    expect(isAuctionClaimableStatus('CLAIMED')).toBe(false);
    expect(auctionClaimableClass('CANCELLED')).toBe(AUCTION_CLAIMABLE_CLASS);
    expect(auctionClaimableClass('EXPIRED')).toBe(AUCTION_CLAIMABLE_CLASS);
    expect(auctionClaimableClass('ACTIVE')).toBe('');
    expect(auctionClaimableClass('RELISTED')).toBe('');
    expect(auctionClaimableClass('CLAIMED')).toBe('');
    expect(auctionClaimHint('EXPIRED')).toBe(AUCTION_CLAIM_HINT);
    expect(auctionClaimHint('ACTIVE')).toBeUndefined();
  });

  it('emits a yellow-hint tooltip attribute for claimable lots', () => {
    const markup = itemHoverAttributeString('Камень', 'stone', (value) => value, AUCTION_CLAIM_HINT, 'auction');
    expect(markup).toContain('data-item-tooltip="Камень"');
    expect(markup).toContain(`data-item-tooltip-hint="${AUCTION_CLAIM_HINT}"`);
    expect(markup).toContain('data-item-tooltip-layout="auction"');
    expect(markup).toContain(`aria-label="Камень. ${AUCTION_CLAIM_HINT}"`);
    expect(itemHoverAttributeString('Камень', 'stone', (value) => value)).not.toContain('data-item-tooltip-hint');
    expect(itemHoverAttributeString('Камень', 'stone', (value) => value)).not.toContain('data-item-tooltip-layout');
  });

  it('splits auction tooltip lines into title, price, and meta', () => {
    const parts = splitAuctionTooltip([
      'Стеклянная бутылочка',
      'Цена: 123 Мегакоина',
      'Продавец: Игрок',
      'Осталось: 1 д 23 ч',
    ].join('\n'));
    expect(parts.name).toBe('Стеклянная бутылочка');
    expect(parts.price).toBe('Цена: 123 Мегакоина');
    expect(parts.meta).toEqual(['Продавец: Игрок', 'Осталось: 1 д 23 ч']);
    expect(parts.meta.join('\n')).not.toMatch(/Количество/);
    const expensive = splitAuctionTooltip('Зелье невидимости\nЦена: 100 000 000 Мегакоинов\nПродавец: Ada');
    expect(expensive.name).toBe('Зелье невидимости');
    expect(expensive.price).toBe('Цена: 100 000 000 Мегакоинов');
  });
});
