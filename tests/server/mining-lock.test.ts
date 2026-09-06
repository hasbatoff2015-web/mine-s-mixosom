import { describe, expect, it } from 'vitest';
import { clearMiningLock, shouldKeepMiningLock, survivalFinishLockReject } from '../../server/miningLock';

describe('shouldKeepMiningLock', () => {
  it('holds while the applied command has mining:true', () => {
    expect(shouldKeepMiningLock({
      mining: true,
      appliedCommandSeq: 20,
      miningStartCommandSeq: 9,
    })).toBe(true);
  });

  it('does not treat pre-START idle seq as mouse-up', () => {
    expect(shouldKeepMiningLock({
      appliedCommandSeq: 8,
      miningStartCommandSeq: 9,
    })).toBe(true);
  });

  it('clears on omitted mining with seq >= START (real mouse-up)', () => {
    expect(shouldKeepMiningLock({
      appliedCommandSeq: 9,
      miningStartCommandSeq: 9,
    })).toBe(false);
    expect(shouldKeepMiningLock({
      appliedCommandSeq: 12,
      miningStartCommandSeq: 9,
    })).toBe(false);
  });

  it('clears when there is no START seq (legacy omitted-mining wipe)', () => {
    expect(shouldKeepMiningLock({ appliedCommandSeq: 3 })).toBe(false);
  });

  it('clearMiningLock drops target, progress, and start seq together', () => {
    const player = {
      miningTarget: { x: 1, y: 2, z: 3 },
      miningProgress: 0.5,
      miningStartCommandSeq: 9,
    };
    clearMiningLock(player);
    expect(player.miningTarget).toBeUndefined();
    expect(player.miningProgress).toBe(0);
    expect(player.miningStartCommandSeq).toBeUndefined();
  });
});

describe('survivalFinishLockReject', () => {
  it('is mining when the lock is missing or on another cell', () => {
    expect(survivalFinishLockReject({ miningProgress: 0.4 }, 1, 2, 3)).toBe('mining');
    expect(survivalFinishLockReject({
      miningTarget: { x: 9, y: 2, z: 3 },
      miningProgress: 0.4,
    }, 1, 2, 3)).toBe('mining');
  });

  it('is in_progress when START locked the cell but no tick has advanced yet', () => {
    expect(survivalFinishLockReject({
      miningTarget: { x: 1, y: 2, z: 3 },
      miningProgress: 0,
    }, 1, 2, 3)).toBe('in_progress');
  });

  it('allows finish once any server progress exists', () => {
    expect(survivalFinishLockReject({
      miningTarget: { x: 1, y: 2, z: 3 },
      miningProgress: 0.067,
    }, 1, 2, 3)).toBeUndefined();
  });
});
