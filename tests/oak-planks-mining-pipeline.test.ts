import { describe, expect, it } from 'vitest';
import {
  BlockId,
  breakTimeSeconds,
  canHarvestBlock,
  getBlockDefinition,
  miningProgressPerTick,
} from '../src/blocks';
import {
  captureBlockBreakFinish,
  captureBlockBreakStart,
  composeOnlineBreakFinish,
} from '../src/net/actionIntent';
import {
  applyAuthoritativeVoxelToMiningGate,
  applyBreakActionResult,
  MAX_FINISH_WAIT_TICKS,
  noteBreakFinishSent,
  noteBreakStartSent,
  resolveOnlineMiningTick,
  shouldResendBreakStartAfterFinishReject,
  shouldSkipMiningTickForRemote,
  shouldHoldServerMining,
  inputMiningField,
  omittedMiningDuringHoldIsClientError,
  noteResendBreakStart,
  shouldSendBreakFinish,
  breakFinishHoldReason,
  type OnlineBreakGate,
} from '../src/net/onlineMining';
import { ACTION_POSE_HISTORY_MAX } from '../shared/actionPoseHistory';
import { encodeMessage, parseClientMessage, parseServerMessage } from '../shared/protocol';
import { Vec3 } from '../src/math/vec3';
import type { VoxelHit } from '../src/world/World';

function gate(): OnlineBreakGate {
  return {};
}

function hit(block: BlockId, x = 8, y = 70, z = 10): VoxelHit {
  return {
    x, y, z, block,
    normal: new Vec3(0, 0, -1),
    point: new Vec3(x + 0.5, y + 0.5, z),
    distance: 3,
  };
}

function miningFields(id: BlockId) {
  const definition = getBlockDefinition(id);
  const perTick = miningProgressPerTick(definition);
  return {
    id,
    key: definition.key,
    hardness: definition.hardness,
    tool: definition.tool,
    tier: definition.tier,
    material: definition.category,
    solid: definition.solid,
    opaque: definition.opaque,
    breakable: definition.breakable !== false,
    requiresCorrectTool: definition.drop?.requiresCorrectTool === true,
    harvestByHand: canHarvestBlock(definition),
    progressPerTick: perTick,
    clientTicksToFinish: Math.ceil(1 / perTick),
    breakTimeSeconds: breakTimeSeconds(definition),
  };
}

describe('oak planks vs dirt/stone/oak log mining fields', () => {
  const dirt = miningFields(BlockId.Dirt);
  const stone = miningFields(BlockId.Stone);
  const oakLog = miningFields(BlockId.OakLog);
  const oakPlanks = miningFields(BlockId.OakPlanks);

  it('uses the same wood() mining numbers as oak log, not a special planks flag', () => {
    expect(oakPlanks).toMatchObject({
      id: BlockId.OakPlanks,
      key: 'oak_planks',
      hardness: 2,
      tool: 'axe',
      tier: 'hand',
      material: 'wood',
      solid: true,
      opaque: true,
      breakable: true,
      requiresCorrectTool: false,
      harvestByHand: true,
      progressPerTick: 1 / 60,
      clientTicksToFinish: 60,
    });
    expect(oakLog.hardness).toBe(oakPlanks.hardness);
    expect(oakLog.progressPerTick).toBe(oakPlanks.progressPerTick);
    expect(oakLog.tool).toBe(oakPlanks.tool);
    expect(oakLog.requiresCorrectTool).toBe(false);
    expect(dirt.hardness).toBe(0.5);
    expect(dirt.clientTicksToFinish).toBe(15);
    expect(stone.hardness).toBe(1.5);
    expect(stone.requiresCorrectTool).toBe(true);
    expect(stone.harvestByHand).toBe(false);
    expect(stone.clientTicksToFinish).toBe(150);
  });

  it('shares one mining formula: client overlay and server advanceMining both call miningProgressPerTick', () => {
    expect(dirt.breakTimeSeconds).toBeCloseTo(0.75, 5);
    expect(oakLog.breakTimeSeconds).toBeCloseTo(3, 5);
    expect(oakPlanks.breakTimeSeconds).toBeCloseTo(3, 5);
    expect(stone.breakTimeSeconds).toBeCloseTo(7.5, 5);
    expect(oakPlanks.clientTicksToFinish).toBeLessThan(ACTION_POSE_HISTORY_MAX);
    expect(oakPlanks.clientTicksToFinish + 5).toBeGreaterThan(ACTION_POSE_HISTORY_MAX);
  });
});

describe('oak planks block ID round-trip', () => {
  it('keeps OakPlanks = 22 through action and block_update JSON', () => {
    expect(BlockId.OakPlanks).toBe(22);
    expect(getBlockDefinition(22).key).toBe('oak_planks');
    const start = parseClientMessage(JSON.parse(encodeMessage({
      type: 'action',
      kind: 'block_break_finish',
      actionSeq: 2,
      commandSeq: 80,
      targetX: 1, targetY: 70, targetZ: 2,
      targetBlockId: BlockId.OakPlanks,
      faceX: 0, faceY: 0, faceZ: -1,
      hitX: 1.5, hitY: 70.5, hitZ: 2,
    })));
    expect(start).toMatchObject({ targetBlockId: 22, kind: 'block_break_finish' });
    const update = parseServerMessage(JSON.parse(encodeMessage({
      type: 'block_update',
      x: 1, y: 70, z: 2,
      blockId: BlockId.OakPlanks,
    })));
    expect(update).toMatchObject({ type: 'block_update', blockId: 22 });
    const air = parseServerMessage(JSON.parse(encodeMessage({
      type: 'block_update',
      x: 1, y: 70, z: 2,
      blockId: BlockId.Air,
    })));
    expect(air).toMatchObject({ type: 'block_update', blockId: BlockId.Air });
  });
});

describe('finish commandSeq must not reuse block_break_start pose', () => {
  it('keeps start voxel identity but uses the finish-time commandSeq', () => {
    const source = { actionSeq: 0, inputSeq: 10, selectedSlot: 0 };
    const start = captureBlockBreakStart(source, hit(BlockId.OakPlanks, 4, 70, 4));
    expect(start.commandSeq).toBe(10);
    expect(start.targetBlockId).toBe(BlockId.OakPlanks);
    source.inputSeq = 70;
    const fresh = captureBlockBreakFinish(source, hit(BlockId.Dirt, 9, 70, 9));
    const clobbered = { ...fresh, ...start };
    expect(clobbered.commandSeq).toBe(10);
    const composed = composeOnlineBreakFinish(fresh, start);
    expect(composed.commandSeq).toBe(70);
    expect(composed.actionSeq).toBe(fresh.actionSeq);
    expect(composed.targetX).toBe(4);
    expect(composed.targetZ).toBe(4);
    expect(composed.targetBlockId).toBe(BlockId.OakPlanks);
  });
});

describe('Player B block_update unlocks Player A gate (coordinate-matched only)', () => {
  it('clears Ada finish/wait/lock when Bob breaks the same oak planks cell', () => {
    const ada = gate();
    noteBreakStartSent(ada, 8, 70, 12);
    noteBreakFinishSent(ada, 8, 70, 12);
    expect(ada.miningFinishKey).toBe('8,70,12');
    expect(ada.clientWaitFinish).toBe(true);

    const other = applyAuthoritativeVoxelToMiningGate(ada, '8,70,12', 9, 70, 12);
    expect(other.miningTarget).toBe('8,70,12');
    expect(ada.miningFinishKey).toBe('8,70,12');

    const same = applyAuthoritativeVoxelToMiningGate(ada, '8,70,12', 8, 70, 12);
    expect(same).toEqual({ miningTarget: undefined, clearProgress: true });
    expect(ada.miningFinishKey).toBeUndefined();
    expect(ada.clientWaitFinish).toBe(false);
    expect(ada.miningLocked).toBe(false);
    expect(ada.pendingBlockAction).toBeUndefined();
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '3,70,3',
      miningTarget: same.miningTarget,
      finishKey: ada.miningFinishKey,
      clientWaitFinish: ada.clientWaitFinish,
    })).toEqual({ type: 'start', targetKey: '3,70,3' });
  });

  it('does not skip the mining tick while a finish is in flight just because a remote player is closer', () => {
    expect(shouldSkipMiningTickForRemote({ remoteCloser: true })).toBe(true);
    expect(shouldSkipMiningTickForRemote({ remoteCloser: true, finishKey: '8,70,12' })).toBe(false);
    const state = gate();
    noteBreakFinishSent(state, 8, 70, 12);
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '8,70,12',
      miningTarget: '8,70,12',
      finishKey: state.miningFinishKey,
      clientWaitFinish: true,
      finishWaitTicks: MAX_FINISH_WAIT_TICKS,
    })).toEqual({ type: 'abandon-start', targetKey: '8,70,12' });
  });

  it('lets the next block start after a failed oak planks finish ack', () => {
    const state = gate();
    noteBreakFinishSent(state, 8, 70, 12);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'stale',
      kind: 'block_break_finish',
      x: 8, y: 70, z: 12,
    });
    expect(state.miningFinishKey).toBeUndefined();
    expect(resolveOnlineMiningTick({
      buttonDown: true,
      targetKey: '4,70,4',
      finishKey: state.miningFinishKey,
      clientWaitFinish: state.clientWaitFinish,
    })).toEqual({ type: 'start', targetKey: '4,70,4' });
  });

  it('resends start after a mining finish reject instead of looping finish', () => {
    expect(shouldResendBreakStartAfterFinishReject('mining')).toBe(true);
    expect(shouldResendBreakStartAfterFinishReject('stale')).toBe(false);
    expect(shouldResendBreakStartAfterFinishReject('los')).toBe(false);
  });

  it('does not allow finish until the resent start is acked (server progress still 0)', () => {
    const state = gate();
    noteBreakFinishSent(state, 8, 70, 12);
    applyBreakActionResult(state, {
      ok: false,
      reason: 'mining',
      kind: 'block_break_finish',
      x: 8, y: 70, z: 12,
    });
    noteResendBreakStart(state);
    expect(state.miningFinishKey).toBeUndefined();
    expect(state.clientWaitFinish).toBe(false);
    expect(state.miningLocked).toBe(false);
    expect(state.miningStartUnacked).toBe(true);
    expect(shouldSendBreakFinish(state, 8, 70, 12)).toBe(false);
    expect(breakFinishHoldReason(state, 8, 70, 12)).toBe('awaiting-start');

    noteBreakStartSent(state, 8, 70, 12);
    expect(state.miningLocked).toBe(true);
    expect(state.miningStartUnacked).toBe(true);
    expect(shouldSendBreakFinish(state, 8, 70, 12)).toBe(false);

    applyBreakActionResult(state, {
      ok: true,
      kind: 'block_break_start',
      x: 8, y: 70, z: 12,
    });
    expect(state.miningStartUnacked).toBe(false);
    expect(state.miningLocked).toBe(true);
    expect(shouldSendBreakFinish(state, 8, 70, 12)).toBe(true);
  });
});

describe('input.mining hold encoding', () => {
  it('keeps mining:true while buttonDown, finishKey, or miningLocked — not on bare idle', () => {
    expect(shouldHoldServerMining({ buttonDown: true })).toBe(true);
    expect(shouldHoldServerMining({ buttonDown: false, finishKey: '8,70,12' })).toBe(true);
    expect(shouldHoldServerMining({ buttonDown: false, miningLocked: true })).toBe(true);
    expect(shouldHoldServerMining({ buttonDown: false })).toBe(false);
    expect(inputMiningField(true)).toEqual({ mining: true });
    expect(inputMiningField(false)).toEqual({});
    const encodedHold = parseClientMessage(JSON.parse(encodeMessage({
      type: 'input', seq: 4, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
      descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0,
      ...inputMiningField(shouldHoldServerMining({ miningLocked: true })),
    })));
    expect(encodedHold).toMatchObject({ mining: true });
    const encodedIdle = parseClientMessage(JSON.parse(encodeMessage({
      type: 'input', seq: 5, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
      descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0,
      ...inputMiningField(shouldHoldServerMining({ buttonDown: false })),
    })));
    expect(encodedIdle).not.toHaveProperty('mining');
  });

  it('treats omitted mining during an active hold as a client lifecycle error, not valid idle', () => {
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: true })).toBe(true);
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: false, miningLocked: true })).toBe(true);
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: false, finishKey: '1,2,3' })).toBe(true);
    expect(omittedMiningDuringHoldIsClientError({ buttonDown: false })).toBe(false);
  });
});
