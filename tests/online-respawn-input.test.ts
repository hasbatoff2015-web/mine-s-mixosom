import { describe, expect, it } from 'vitest';
import {
  playerGameplayAllowed,
  resolvePlayerMoveInput,
  worldSimulationActive,
} from '../src/core/gameplayModal';
import {
  shouldEnterBackgroundFromBlur,
  shouldEnterBackgroundFromVisibility,
  shouldResumeFromBackground,
} from '../src/core/lifecycleFocus';
import {
  lifecycleAfterOnlineRespawn,
  planOnlineRespawnInputRestore,
  recordAliveSnapshotTick,
  shouldIgnoreStaleDeadSnapshot,
  shouldRestoreGameplayAfterRespawn,
} from '../src/core/onlineRespawn';
import { shouldReleasePointerLockAfterAcquire, shouldRequestPointerLock } from '../src/input/pointerLock';
import type { MoveInput } from '../src/input/InputManager';

const live: MoveInput = {
  forward: 1,
  right: 1,
  jump: true,
  sprint: true,
  sneak: false,
  descend: true,
  flySprint: false,
};

describe('online respawn input — death path contract', () => {
  it.each([
    ['natural / mob', { dead: true, health: 0 }],
    ['/kill', { dead: true, health: 0 }],
    ['fall', { dead: true, health: 0 }],
    ['fire', { dead: true, health: 0 }],
    ['lava', { dead: true, health: 0 }],
    ['TNT / explosion', { dead: true, health: 0 }],
  ] as const)('%s dead→alive restores PLAYING tickOnline', (_label, previous) => {
    expect(shouldRestoreGameplayAfterRespawn(previous, { dead: false, health: 20 })).toBe(true);
    expect(lifecycleAfterOnlineRespawn('BACKGROUND')).toBe('PLAYING');
    expect(lifecycleAfterOnlineRespawn('DEAD')).toBe('PLAYING');
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
  });

  it('does not treat a same-tick 20 HP packet as a respawn if the client never saw death', () => {
    expect(shouldRestoreGameplayAfterRespawn(
      { dead: false, health: 20 },
      { dead: false, health: 20 },
    )).toBe(false);
  });
});

describe('online respawn input — lifecycle / pointer lock / chat / tab', () => {
  it('does not enter BACKGROUND on blur while pointer-locked in a visible tab', () => {
    expect(shouldEnterBackgroundFromBlur({
      documentHidden: false,
      documentHasFocus: false,
      pointerLocked: true,
    })).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('does not enter BACKGROUND while a respawn pointer-lock request is pending', () => {
    expect(shouldEnterBackgroundFromBlur({
      documentHidden: false,
      documentHasFocus: false,
      pointerLockRequestPending: true,
    })).toBe(false);
    expect(shouldEnterBackgroundFromBlur({
      documentHidden: false,
      documentHasFocus: false,
      suppressBackground: true,
    })).toBe(false);
  });

  it('still pauses on a real tab hide', () => {
    expect(shouldEnterBackgroundFromVisibility(true)).toBe(true);
    expect(shouldEnterBackgroundFromBlur({
      documentHidden: true,
      documentHasFocus: false,
      pointerLocked: true,
    })).toBe(true);
  });

  it('tab switch after respawn: hide pauses, visible resume + WASD', () => {
    expect(shouldEnterBackgroundFromVisibility(true)).toBe(true);
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(playerGameplayAllowed(lifecycleAfterOnlineRespawn('BACKGROUND'), false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).jump).toBe(true);
  });

  it('chat open/close after respawn restores movement immediately', () => {
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(resolvePlayerMoveInput(true, live).forward).toBe(0);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('does not focus or re-request pointer lock when already locked after respawn', () => {
    const plan = planOnlineRespawnInputRestore({
      state: 'PLAYING',
      pointerLocked: true,
      chatOpen: false,
      inventoryOpen: false,
    });
    expect(plan.lifecycle).toBe('PLAYING');
    expect(plan.focusCanvas).toBe(false);
    expect(plan.requestPointerLock).toBe(false);
    expect(plan.clearHeldKeys).toBe(false);
  });

  it('requests lock only when unlocked, and clears keys only if chat/inventory owned them', () => {
    const afterChat = planOnlineRespawnInputRestore({
      state: 'BACKGROUND',
      pointerLocked: false,
      chatOpen: true,
      inventoryOpen: false,
    });
    expect(afterChat.lifecycle).toBe('PLAYING');
    expect(afterChat.clearHeldKeys).toBe(true);
    expect(afterChat.focusCanvas).toBe(true);
    expect(afterChat.requestPointerLock).toBe(true);

    const noOverlay = planOnlineRespawnInputRestore({
      state: 'BACKGROUND',
      pointerLocked: false,
      chatOpen: false,
      inventoryOpen: false,
    });
    expect(noOverlay.clearHeldKeys).toBe(false);
  });

  it('pointer lock reacquire resumes PLAYING before deciding whether to keep the lock', () => {
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(shouldReleasePointerLockAfterAcquire(true)).toBe(false);
    expect(shouldReleasePointerLockAfterAcquire(false)).toBe(true);
    expect(shouldRequestPointerLock({
      canCapture: true,
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(true);
  });

  it('consecutive deaths keep the same PLAYING movement contract', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(shouldRestoreGameplayAfterRespawn(
        { dead: true, health: 0 },
        { dead: false, health: 20 },
      )).toBe(true);
      expect(worldSimulationActive(lifecycleAfterOnlineRespawn('BACKGROUND'))).toBe(true);
      expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    }
  });
});

describe('online respawn input — snapshot order', () => {
  it('ignores a stale dead snapshot after an alive tick', () => {
    expect(shouldIgnoreStaleDeadSnapshot({
      snapshotTick: 10,
      lastAliveTick: 12,
      dead: true,
    })).toBe(true);
    expect(shouldIgnoreStaleDeadSnapshot({
      snapshotTick: 13,
      lastAliveTick: 12,
      dead: true,
    })).toBe(false);
    expect(shouldIgnoreStaleDeadSnapshot({
      snapshotTick: 10,
      lastAliveTick: 12,
      dead: false,
    })).toBe(false);
    expect(recordAliveSnapshotTick(10, 12)).toBe(12);
  });
});
