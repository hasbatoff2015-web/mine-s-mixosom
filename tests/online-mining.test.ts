import { describe, expect, it } from 'vitest';
import {
  isInFlightBreakReject,
  miningBlockKey,
  shouldHoldServerMining,
  shouldRetargetOnlineMine,
  shouldSendBreakAbort,
} from '../src/net/onlineMining';

describe('online mining finish/abort coordination', () => {
  it('does not abort after finish was sent for the same target', () => {
    expect(shouldSendBreakAbort({
      miningReleased: true,
      miningTarget: '3,4,5',
      finishKey: '3,4,5',
    })).toBe(false);
  });

  it('still aborts when the player cancels before finish', () => {
    expect(shouldSendBreakAbort({
      miningReleased: true,
      miningTarget: '3,4,5',
    })).toBe(true);
  });

  it('keeps server mining held after local finish even if the button is up', () => {
    expect(shouldHoldServerMining({ buttonDown: false, finishKey: '1,2,3' })).toBe(true);
    expect(shouldHoldServerMining({ buttonDown: false })).toBe(false);
    expect(shouldHoldServerMining({ buttonDown: true })).toBe(true);
  });

  it('does not retarget while a finish is in flight', () => {
    expect(shouldRetargetOnlineMine({
      nextTargetKey: '9,9,9',
      currentTarget: '1,2,3',
      finishKey: '1,2,3',
    })).toBe(false);
    expect(shouldRetargetOnlineMine({
      nextTargetKey: '9,9,9',
      currentTarget: '1,2,3',
    })).toBe(true);
  });

  it('treats mining rejects as in-flight, not a hard deny', () => {
    expect(isInFlightBreakReject('mining')).toBe(true);
    expect(isInFlightBreakReject('cancelled')).toBe(false);
    expect(isInFlightBreakReject('empty')).toBe(false);
    expect(miningBlockKey(1, 2, 3)).toBe('1,2,3');
  });
});
