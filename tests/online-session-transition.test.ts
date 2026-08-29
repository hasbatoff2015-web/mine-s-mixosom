import { describe, expect, it } from 'vitest';
import {
  playerGameplayAllowed,
  resolvePlayerMoveInput,
  worldSimulationActive,
} from '../src/core/gameplayModal';
import {
  shouldEnterBackgroundFromBlur,
  shouldResumeFromBackground,
} from '../src/core/lifecycleFocus';
import {
  inputSeqAfterNewClientSession,
  inputSeqAfterReconnect,
  isLiveSocketGeneration,
  lifecycleAfterWorldSessionEnter,
  sessionEnterAllowsTickOnline,
  shouldAcceptInputSequence,
  shouldHandleOnlineClientEvent,
} from '../src/core/onlineSession';
import {
  lifecycleAfterOnlineRespawn,
  shouldRestoreGameplayAfterRespawn,
} from '../src/core/onlineRespawn';
import type { MoveInput } from '../src/input/InputManager';

const live: MoveInput = {
  forward: 1,
  right: 0,
  jump: false,
  sprint: false,
  sneak: false,
  descend: false,
  flySprint: false,
};

describe('online session transition input', () => {
  it('fresh Anarchy starts seq at 0 against a reconnect-reset server seq', () => {
    const clientSeq = inputSeqAfterNewClientSession();
    const serverSeq = inputSeqAfterReconnect();
    expect(clientSeq).toBe(0);
    expect(shouldAcceptInputSequence(serverSeq, clientSeq + 1)).toBe(true);
    expect(sessionEnterAllowsTickOnline('MENU', false)).toBe(true);
    expect(worldSimulationActive(lifecycleAfterWorldSessionEnter('LOADING_WORLD'))).toBe(true);
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
  });

  it('Anarchy → menu → Anarchy accepts a new client seq 1 after resume', () => {
    let lastSeq = 40;
    expect(shouldAcceptInputSequence(lastSeq, 1)).toBe(false);
    lastSeq = inputSeqAfterReconnect();
    expect(shouldAcceptInputSequence(lastSeq, inputSeqAfterNewClientSession() + 1)).toBe(true);
    expect(lifecycleAfterWorldSessionEnter('MENU')).toBe('PLAYING');
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
  });

  it('Singleplayer → menu → Anarchy still enters PLAYING with tickOnline', () => {
    expect(lifecycleAfterWorldSessionEnter('PLAYING')).toBe('PLAYING');
    expect(lifecycleAfterWorldSessionEnter('BACKGROUND')).toBe('PLAYING');
    expect(sessionEnterAllowsTickOnline('BACKGROUND', false)).toBe(true);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('Anarchy → Singleplayer → Anarchy does not keep the previous lastInputSeq', () => {
    const leftover = 180;
    expect(shouldAcceptInputSequence(leftover, 1)).toBe(false);
    expect(shouldAcceptInputSequence(inputSeqAfterReconnect(), 1)).toBe(true);
    expect(sessionEnterAllowsTickOnline(lifecycleAfterWorldSessionEnter('PAUSED'), false)).toBe(true);
  });

  it('multiple transitions keep the same PLAYING movement contract', () => {
    const states = ['MENU', 'LOADING_WORLD', 'BACKGROUND', 'DEAD', 'PAUSED'] as const;
    for (const state of states) {
      expect(lifecycleAfterWorldSessionEnter(state)).toBe('PLAYING');
      expect(sessionEnterAllowsTickOnline(state, false)).toBe(true);
    }
  });

  it('chat after transition: overlay blocks, close restores WASD', () => {
    expect(playerGameplayAllowed(lifecycleAfterWorldSessionEnter('MENU'), true)).toBe(false);
    expect(resolvePlayerMoveInput(true, live).forward).toBe(0);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
  });

  it('pointer lock after transition keeps tickOnline while the tab is visible', () => {
    expect(shouldEnterBackgroundFromBlur({
      documentHidden: false,
      documentHasFocus: false,
      pointerLocked: true,
    })).toBe(false);
    expect(sessionEnterAllowsTickOnline('PLAYING', false)).toBe(true);
  });

  it('tab switch after transition pauses then resumes movement', () => {
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(sessionEnterAllowsTickOnline(lifecycleAfterWorldSessionEnter('BACKGROUND'), false)).toBe(true);
  });

  it('disconnect/reconnect Anarchy uses a new live socket generation and client identity', () => {
    const first = { id: 'ws-a' };
    const second = { id: 'ws-b' };
    expect(shouldHandleOnlineClientEvent(first, first)).toBe(true);
    expect(shouldHandleOnlineClientEvent(second, first)).toBe(false);
    expect(shouldHandleOnlineClientEvent(undefined, first)).toBe(false);
    expect(isLiveSocketGeneration(2, 1)).toBe(false);
    expect(isLiveSocketGeneration(2, 2)).toBe(true);
  });

  it('does not stack duplicate clients: only the active AnarchyClient is current', () => {
    const active = { n: 1 };
    const stale = { n: 0 };
    expect(shouldHandleOnlineClientEvent(active, stale)).toBe(false);
    expect(shouldHandleOnlineClientEvent(active, active)).toBe(true);
  });

  it('keeps PR #19 death→respawn PLAYING contract intact', () => {
    expect(shouldRestoreGameplayAfterRespawn(
      { dead: true, health: 0 },
      { dead: false, health: 20 },
    )).toBe(true);
    expect(lifecycleAfterOnlineRespawn('BACKGROUND')).toBe('PLAYING');
    expect(sessionEnterAllowsTickOnline('PLAYING', false)).toBe(true);
  });
});
