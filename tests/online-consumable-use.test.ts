import { describe, expect, it } from 'vitest';
import { shouldClearLocalFoodUseFromSnapshot } from '../src/net/onlineConsumableUse';

describe('Online consumable render-edge sequencing', () => {
  it('keeps local presentation through the delayed pre-use boundary snapshot', () => {
    expect(shouldClearLocalFoodUseFromSnapshot({
      actionBoundaryCommandSeq: 15,
      snapshotInputSeq: 15,
      authoritativeFoodUseProgress: 0,
    })).toBe(false);
  });

  it('lets the first strictly newer authoritative snapshot confirm or cancel presentation', () => {
    expect(shouldClearLocalFoodUseFromSnapshot({
      actionBoundaryCommandSeq: 15,
      snapshotInputSeq: 16,
      authoritativeFoodUseProgress: 0,
    })).toBe(true);
    expect(shouldClearLocalFoodUseFromSnapshot({
      actionBoundaryCommandSeq: 15,
      snapshotInputSeq: 16,
      authoritativeFoodUseProgress: 1 / 32,
    })).toBe(false);
  });
});
