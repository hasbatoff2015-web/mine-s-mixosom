import { describe, expect, it } from 'vitest';
import {
  abandonInFlightFinish,
  applyBreakActionResult,
  breakFinishHoldReason,
  isInFlightBreakReject,
  miningBlockKey,
  noteBreakAbortSent,
  noteBreakFinishSent,
  noteBreakStartSent,
  noteMiningReleased,
  shouldHoldServerMining,
  shouldRetargetOnlineMine,
  shouldSendBreakAbort,
  shouldSendBreakFinish,
  shouldWaitForInFlightFinish,
  type OnlineBreakGate,
} from '../src/net/onlineMining';

function gate(partial: OnlineBreakGate = {}): OnlineBreakGate {
  return { ...partial };
}

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

  it('waits for in-flight finish only on the same block or empty air', () => {
    expect(shouldWaitForInFlightFinish({ finishKey: '1,2,3' })).toBe(true);
    expect(shouldWaitForInFlightFinish({ finishKey: '1,2,3', targetKey: '1,2,3' })).toBe(true);
    expect(shouldWaitForInFlightFinish({ finishKey: '1,2,3', targetKey: '9,9,9' })).toBe(false);
    expect(shouldWaitForInFlightFinish({ targetKey: '1,2,3' })).toBe(false);
  });

  it('treats mining rejects as in-flight, not a hard deny', () => {
    expect(isInFlightBreakReject('mining')).toBe(true);
    expect(isInFlightBreakReject('cancelled')).toBe(false);
    expect(isInFlightBreakReject('empty')).toBe(false);
    expect(isInFlightBreakReject('los')).toBe(false);
    expect(miningBlockKey(1, 2, 3)).toBe('1,2,3');
  });
});

describe('online break gate after a failed finish', () => {
  it('does not leave a coordinate permanently unbreakable after a hard reject', () => {
    const state = gate();
    noteBreakStartSent(state, 8, 70, 12);
    noteBreakFinishSent(state, 8, 70, 12);
    expect(shouldSendBreakFinish(state, 8, 70, 12)).toBe(false);
    expect(breakFinishHoldReason(state, 8, 70, 12)).toBe('finish-inflight');

    applyBreakActionResult(state, {
      ok: false,
      reason: 'los',
      kind: 'block_break_finish',
      x: 8, y: 70, z: 12,
    });

    expect(state.pendingBlockAction).toBeUndefined();
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.miningLocked).toBe(false);
    expect(state.rejectedBlockKey).toBe('8,70,12');

    noteMiningReleased(state);
    noteBreakStartSent(state, 8, 70, 12);
    expect(shouldSendBreakFinish(state, 8, 70, 12)).toBe(true);
  });

  it('allows another block to finish while a previous failed finish is still remembered', () => {
    const state = gate();
    noteBreakFinishSent(state, 8, 70, 12);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'los',
      kind: 'block_break_finish',
      x: 8, y: 70, z: 12,
    });
    expect(shouldSendBreakFinish(state, 9, 70, 12)).toBe(true);
    noteBreakStartSent(state, 9, 70, 12);
    expect(shouldSendBreakFinish(state, 9, 70, 12)).toBe(true);
  });

  it('clears pending on in-flight mining reject so a later hard outcome can retry', () => {
    const state = gate();
    noteBreakFinishSent(state, 4, 65, 4);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'mining',
      kind: 'block_break_finish',
      x: 4, y: 65, z: 4,
    });
    expect(state.pendingBlockAction).toBeUndefined();
    expect(state.miningFinishKey).toBe('4,65,4');
    expect(state.rejectedBlockKey).toBeUndefined();
    expect(shouldSendBreakFinish(state, 4, 65, 4)).toBe(false);

    applyBreakActionResult(state, {
      ok: false,
      reason: 'los',
      kind: 'block_break_finish',
      x: 4, y: 65, z: 4,
    });
    noteMiningReleased(state);
    expect(shouldSendBreakFinish(state, 4, 65, 4)).toBe(true);
  });

  it('does not require a reconnect-equivalent empty gate after Survival then Creative retry', () => {
    const state = gate();
    noteBreakStartSent(state, 3, 68, 10);
    noteBreakFinishSent(state, 3, 68, 10);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'stale',
      kind: 'block_break_finish',
      x: 3, y: 68, z: 10,
    });
    noteMiningReleased(state);
    noteBreakStartSent(state, 3, 68, 10);
    expect(shouldSendBreakFinish(state, 3, 68, 10)).toBe(true);

    const reconnected = gate();
    expect(shouldSendBreakFinish(reconnected, 3, 68, 10)).toBe(true);
  });

  it('abandons an in-flight finish when looking at a different block', () => {
    const state = gate();
    noteBreakFinishSent(state, 1, 2, 3);
    expect(shouldWaitForInFlightFinish({
      finishKey: state.miningFinishKey,
      targetKey: '9,9,9',
    })).toBe(false);
    abandonInFlightFinish(state);
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.pendingBlockAction).toBeUndefined();
    expect(shouldSendBreakFinish(state, 9, 9, 9)).toBe(true);
  });

  it('clears the gate on abort so the same coords can be finished later', () => {
    const state = gate();
    noteBreakStartSent(state, 2, 2, 2);
    noteBreakFinishSent(state, 2, 2, 2);
    noteBreakAbortSent(state);
    expect(shouldSendBreakFinish(state, 2, 2, 2)).toBe(true);
  });

  it('does not treat a successful ack as a leftover pending lock', () => {
    const state = gate();
    noteBreakFinishSent(state, 1, 1, 1);
    applyBreakActionResult(state, {
      ok: true,
      kind: 'block_break_finish',
      x: 1, y: 1, z: 1,
    });
    expect(state.pendingBlockAction).toBeUndefined();
    expect(state.miningFinishKey).toBeUndefined();
    expect(shouldSendBreakFinish(state, 1, 1, 1)).toBe(true);
  });
});
