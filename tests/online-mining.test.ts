import { describe, expect, it } from 'vitest';
import {
  abandonInFlightFinish,
  applyBreakActionResult,
  breakFinishHoldReason,
  isInFlightBreakReject,
  MAX_FINISH_WAIT_TICKS,
  miningBlockKey,
  noteBreakAbortSent,
  noteBreakFinishSent,
  noteBreakStartSent,
  noteMiningReleased,
  resetOnlineMiningGate,
  resolveOnlineMiningTick,
  shouldHoldServerMining,
  shouldRetargetOnlineMine,
  shouldSendBreakAbort,
  shouldSendBreakFinish,
  shouldWaitForInFlightFinish,
  inputMiningField,
  omittedMiningDuringHoldIsClientError,
  shouldKeepFinishWait,
  shouldResendBreakStartAfterFinishReject,
  type OnlineBreakGate,
} from '../src/net/onlineMining';

function gate(partial: OnlineBreakGate = {}): OnlineBreakGate {
  return { ...partial };
}

function ackStart(state: OnlineBreakGate, x: number, y: number, z: number): void {
  applyBreakActionResult(state, { ok: true, kind: 'block_break_start', x, y, z });
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
    expect(shouldHoldServerMining({ buttonDown: false, miningLocked: true })).toBe(true);
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

  it('waits for in-flight finish only while still holding on that block or air', () => {
    expect(shouldWaitForInFlightFinish({ finishKey: '1,2,3', clientWaitFinish: true })).toBe(true);
    expect(shouldWaitForInFlightFinish({
      finishKey: '1,2,3',
      targetKey: '1,2,3',
      clientWaitFinish: true,
    })).toBe(true);
    expect(shouldWaitForInFlightFinish({
      finishKey: '1,2,3',
      targetKey: '9,9,9',
      clientWaitFinish: true,
    })).toBe(false);
    expect(shouldWaitForInFlightFinish({ finishKey: '1,2,3' })).toBe(false);
    expect(shouldWaitForInFlightFinish({
      finishKey: '1,2,3',
      targetKey: '1,2,3',
      clientWaitFinish: false,
    })).toBe(false);
  });

  it('treats mining rejects as in-flight, not a hard deny', () => {
    expect(isInFlightBreakReject('mining')).toBe(true);
    expect(isInFlightBreakReject('in_progress')).toBe(true);
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
    ackStart(state, 8, 70, 12);
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
    ackStart(state, 8, 70, 12);
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
    ackStart(state, 9, 70, 12);
    expect(shouldSendBreakFinish(state, 9, 70, 12)).toBe(true);
  });

  it('unlocks the client gate on a mining reject so the next tick can resend finish', () => {
    const state = gate();
    noteBreakFinishSent(state, 4, 65, 4);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'mining',
      kind: 'block_break_finish',
      x: 4, y: 65, z: 4,
    });
    expect(state.pendingBlockAction).toBeUndefined();
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.clientWaitFinish).toBe(false);
    expect(state.miningLocked).toBe(false);
    expect(state.rejectedBlockKey).toBeUndefined();
    expect(shouldSendBreakFinish(state, 4, 65, 4)).toBe(true);
  });

  it('unlocks even when action_result has no coordinates', () => {
    const state = gate();
    noteBreakFinishSent(state, 4, 65, 4);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'invalid',
      kind: 'block_break_finish',
    });
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.clientWaitFinish).toBe(false);
    expect(state.miningLocked).toBe(false);
    expect(shouldSendBreakFinish(state, 4, 65, 4)).toBe(true);
  });

  it('does not require a reconnect-equivalent empty gate after Survival then Creative retry', () => {
    const state = gate();
    noteBreakStartSent(state, 3, 68, 10);
    ackStart(state, 3, 68, 10);
    noteBreakFinishSent(state, 3, 68, 10);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'stale',
      kind: 'block_break_finish',
      x: 3, y: 68, z: 10,
    });
    noteMiningReleased(state);
    noteBreakStartSent(state, 3, 68, 10);
    ackStart(state, 3, 68, 10);
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

describe('online mining tick after overlay reaches 100%', () => {
  function afterFinish(): OnlineBreakGate {
    const state = gate();
    noteBreakStartSent(state, 8, 70, 12);
    ackStart(state, 8, 70, 12);
    noteBreakFinishSent(state, 8, 70, 12);
    return state;
  }

  it('waits only while still holding the finished cell', () => {
    const state = afterFinish();
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '8,70,12',
      miningTarget: '8,70,12',
      finishKey: state.miningFinishKey,
      clientWaitFinish: true,
    }).type).toBe('wait');
  });

  it('does not swallow the next pointerdown after mouse-up on the same cell', () => {
    const state = afterFinish();
    noteMiningReleased(state);
    expect(state.clientWaitFinish).toBe(false);
    expect(shouldHoldServerMining({ buttonDown: false, finishKey: state.miningFinishKey })).toBe(true);
    expect(resolveOnlineMiningTick({
      buttonDown: false,
      targetKey: '8,70,12',
      miningTarget: '8,70,12',
      finishKey: state.miningFinishKey,
      clientWaitFinish: state.clientWaitFinish,
    })).toEqual({ type: 'hold-idle' });
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '8,70,12',
      miningTarget: undefined,
      finishKey: state.miningFinishKey,
      clientWaitFinish: false,
    })).toEqual({ type: 'start', targetKey: '8,70,12' });
  });

  it('starts a second block after a stuck finish without reconnect', () => {
    const state = afterFinish();
    noteMiningReleased(state);
    const second = resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '9,70,12',
      miningTarget: undefined,
      finishKey: state.miningFinishKey,
      clientWaitFinish: false,
    });
    expect(second).toEqual({ type: 'abandon-start', targetKey: '9,70,12' });
    abandonInFlightFinish(state);
    resetOnlineMiningGate(state);
    noteBreakStartSent(state, 9, 70, 12);
    ackStart(state, 9, 70, 12);
    expect(state.miningLocked).toBe(true);
    expect(shouldSendBreakFinish(state, 9, 70, 12)).toBe(true);
  });

  it('resets every mining flag after a hard reject so another coordinate is accepted', () => {
    const state = afterFinish();
    applyBreakActionResult(state, {
      ok: false,
      reason: 'los',
      kind: 'block_break_finish',
      x: 8, y: 70, z: 12,
    });
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.clientWaitFinish).toBe(false);
    expect(state.miningLocked).toBe(false);
    expect(state.pendingBlockAction).toBeUndefined();
    noteMiningReleased(state);
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '10,70,12',
      miningTarget: undefined,
      finishKey: state.miningFinishKey,
      clientWaitFinish: state.clientWaitFinish,
    })).toEqual({ type: 'start', targetKey: '10,70,12' });
  });

  it('abandons a stuck finish after MAX_FINISH_WAIT_TICKS', () => {
    const state = afterFinish();
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '8,70,12',
      miningTarget: '8,70,12',
      finishKey: state.miningFinishKey,
      clientWaitFinish: true,
      finishWaitTicks: MAX_FINISH_WAIT_TICKS,
    })).toEqual({ type: 'abandon-start', targetKey: '8,70,12' });
  });
});

describe('input mining hold vs idle omit', () => {
  it('encodes mining:true only while an action is held', () => {
    expect(inputMiningField(shouldHoldServerMining({ buttonDown: true }))).toEqual({ mining: true });
    expect(inputMiningField(shouldHoldServerMining({ buttonDown: false, miningLocked: true }))).toEqual({ mining: true });
    expect(inputMiningField(shouldHoldServerMining({ buttonDown: false }))).toEqual({});
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: false, miningLocked: true })).toBe(true);
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: false })).toBe(false);
  });
});

describe('first START ack vs premature finish', () => {
  it('blocks finish until the first start is acked', () => {
    const state = gate();
    noteBreakStartSent(state, 8, 65, 6);
    expect(state.miningStartUnacked).toBe(true);
    expect(breakFinishHoldReason(state, 8, 65, 6)).toBe('awaiting-start');
    expect(shouldSendBreakFinish(state, 8, 65, 6)).toBe(false);
    ackStart(state, 8, 65, 6);
    expect(state.miningStartUnacked).toBe(false);
    expect(shouldSendBreakFinish(state, 8, 65, 6)).toBe(true);
  });

  it('does not treat a missing kind as a finish ack', () => {
    const state = gate();
    noteBreakStartSent(state, 8, 65, 6);
    noteBreakFinishSent(state, 8, 65, 6);
    applyBreakActionResult(state, { ok: true, x: 8, y: 65, z: 6 });
    expect(state.miningFinishKey).toBe('8,65,6');
    expect(state.clientWaitFinish).toBe(true);
    expect(state.miningLocked).toBe(true);
  });

  it('keeps the in-flight finish when the server lock exists at progress 0', () => {
    const state = gate();
    noteBreakStartSent(state, 8, 65, 6);
    ackStart(state, 8, 65, 6);
    noteBreakFinishSent(state, 8, 65, 6);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'in_progress',
      kind: 'block_break_finish',
      x: 8, y: 65, z: 6,
    });
    expect(shouldKeepFinishWait('in_progress')).toBe(true);
    expect(shouldResendBreakStartAfterFinishReject('in_progress')).toBe(false);
    expect(shouldResendBreakStartAfterFinishReject('mining')).toBe(true);
    expect(state.miningFinishKey).toBe('8,65,6');
    expect(state.clientWaitFinish).toBe(true);
    expect(state.miningLocked).toBe(true);
    expect(state.finishWaitTicks).toBe(0);
    expect(shouldSendBreakFinish(state, 8, 65, 6)).toBe(false);
    expect(state.awaitingAutoBreak).toBe(true);
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '8,65,6',
      miningTarget: '8,65,6',
      finishKey: state.miningFinishKey,
      clientWaitFinish: true,
      finishWaitTicks: MAX_FINISH_WAIT_TICKS,
      awaitingAutoBreak: true,
    }).type).toBe('wait');
    expect(shouldSendBreakAbort({
      miningReleased: true,
      miningTarget: '8,65,6',
      finishKey: '8,65,6',
      awaitingAutoBreak: true,
    })).toBe(true);
  });
});
