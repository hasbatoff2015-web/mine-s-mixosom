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
  movementAfterChatClose,
  shouldBlurStaleTextField,
  shouldCaptureGameplayKey,
  stepVisualBowUseTicks,
} from '../src/input/gameplayKeys';
import {
  lifecycleAfterOnlineRespawn,
  shouldRestoreGameplayAfterRespawn,
} from '../src/core/onlineRespawn';
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

describe('online input recovery', () => {
  it('disables movement while chat is open', () => {
    const blocked = resolvePlayerMoveInput(true, live);
    expect(blocked.forward).toBe(0);
    expect(blocked.right).toBe(0);
    expect(blocked.jump).toBe(false);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(shouldCaptureGameplayKey({ typingInField: true, chatOpen: true })).toBe(false);
  });

  it('restores movement immediately when chat closes', () => {
    expect(movementAfterChatClose(live, false)).toEqual(live);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(shouldCaptureGameplayKey({ typingInField: false, chatOpen: false })).toBe(true);
  });

  it('treats window blur as a key reset, not a permanent WASD disable', () => {
    expect(shouldEnterBackgroundFromBlur({ documentHidden: false, documentHasFocus: true })).toBe(false);
    expect(shouldEnterBackgroundFromBlur({ documentHidden: false, documentHasFocus: false })).toBe(true);
    expect(shouldCaptureGameplayKey({ typingInField: false, chatOpen: false })).toBe(true);
  });

  it('resumes PLAYING on focus when the tab is visible', () => {
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: true })).toBe(false);
    expect(shouldResumeFromBackground({ state: 'PAUSED', documentHidden: false })).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('does not permanently disable movement after pointer-lock loss while the page still has focus', () => {
    expect(shouldEnterBackgroundFromBlur({ documentHidden: false, documentHasFocus: true })).toBe(false);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).forward).toBe(1);
  });

  it('pauses only when the document is actually hidden (tab switch), then resumes', () => {
    expect(shouldEnterBackgroundFromVisibility(true)).toBe(true);
    expect(shouldEnterBackgroundFromVisibility(false)).toBe(false);
    expect(shouldResumeFromBackground({ state: 'BACKGROUND', documentHidden: false })).toBe(true);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
  });

  it('keeps chat typing exclusive while open and does not leak that into gameplay keys', () => {
    expect(shouldCaptureGameplayKey({ typingInField: true, chatOpen: true })).toBe(false);
    expect(shouldBlurStaleTextField({ typingInField: true, chatOpen: false })).toBe(true);
    expect(shouldCaptureGameplayKey({ typingInField: true, chatOpen: false })).toBe(true);
  });

  it('accepts WASD after chat closes even if a text field is still focused', () => {
    expect(shouldBlurStaleTextField({ typingInField: true, chatOpen: false })).toBe(true);
    expect(shouldCaptureGameplayKey({ typingInField: true, chatOpen: false })).toBe(true);
    expect(movementAfterChatClose(live, false).forward).toBe(1);
  });

  it('keeps WASD available after respawn with the same contract as a fresh join', () => {
    expect(shouldRestoreGameplayAfterRespawn(
      { dead: true, health: 0 },
      { dead: false, health: 20 },
    )).toBe(true);
    expect(lifecycleAfterOnlineRespawn('BACKGROUND')).toBe('PLAYING');
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
    expect(resolvePlayerMoveInput(false, live).jump).toBe(true);
    expect(resolvePlayerMoveInput(false, live).sneak).toBe(false);
  });
});
