import { describe, expect, it } from 'vitest';
import { createItemStack } from '../src/inventory';
import { auctionIconStack, keepAuctionSearchDraft } from '../src/ui/auctionGui';

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
});
