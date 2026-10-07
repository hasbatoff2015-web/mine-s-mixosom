/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import { InputManager, type InputCallbacks } from '../src/input/InputManager';
import type { PointerUnlockReason } from '../src/input/pointerLock';
import { localInteractionAim, type LocalAim } from '../src/player/localAim';
import { PlayerController } from '../src/player/PlayerController';
import { applyDuelStartLook } from '../src/net/duelStartLook';
import { predictedMoveFromInput } from '../src/net/localPlayerPrediction';
import { parseServerMessage } from '../shared/protocol';

const idle = {
  forward: 0,
  right: 0,
  jump: false,
  sneak: false,
  sprint: false,
};

describe('duel start look on the client', () => {
  it('applies the packet to input, the local player, and the next command, then still turns', () => {
    expect(gameSource).toContain("case 'player_look'");
    expect(gameSource).toContain('applyDuelStartLook');
    expect(gameSource).toContain('clearCachedAim');

    const parsed = parseServerMessage({
      type: 'player_look',
      reason: 'duel_start',
      yaw: -1.15,
      pitch: 0.22,
    });
    if (!('type' in parsed) || parsed.type !== 'player_look') throw new Error('look packet rejected');

    installCoarsePointer();
    document.body.innerHTML = '<div id="app"></div>';
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const input = new InputManager(canvas, callbacks());
    input.yaw = 1.7;
    input.pitch = -0.45;
    const player = new PlayerController({ position: [4, 70, 8], yaw: 0.4, pitch: -0.2 });

    const lookZone = document.querySelector<HTMLElement>('#touch-look-zone');
    expect(lookZone).toBeTruthy();
    lookZone!.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 40, clientY: 40, bubbles: true }));
    lookZone!.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 40, clientY: 40, bubbles: true }));
    expect(input.interactionLook()).toEqual({ yaw: 2.4, pitch: -0.8 });

    let lastLocalAim: LocalAim | undefined = localInteractionAim(player, input.interactionLook() ?? input);
    expect(lastLocalAim.yaw).toBeCloseTo(2.4, 5);
    applyDuelStartLook({
      input,
      player,
      clearCachedAim: () => { lastLocalAim = undefined; },
    }, parsed.yaw, parsed.pitch);

    expect(input.yaw).toBe(parsed.yaw);
    expect(input.pitch).toBe(parsed.pitch);
    expect(input.interactionLook()).toBeNull();
    expect(player.yaw).toBe(parsed.yaw);
    expect(player.pitch).toBe(parsed.pitch);
    expect(lastLocalAim).toBeUndefined();

    const sampled = lastLocalAim ?? localInteractionAim(player, input.interactionLook() ?? input);
    expect(sampled.yaw).toBe(parsed.yaw);
    expect(sampled.pitch).toBe(parsed.pitch);

    const next = predictedMoveFromInput(1, idle, { yaw: input.yaw, pitch: input.pitch }, true);
    expect(next.yaw).toBe(parsed.yaw);
    expect(next.pitch).toBe(parsed.pitch);

    const snapped = input.yaw;
    input.applyLookDelta(80, -12);
    expect(input.yaw).not.toBeCloseTo(snapped, 5);
    expect(input.pitch).not.toBeCloseTo(parsed.pitch, 5);
    const turned = predictedMoveFromInput(2, idle, { yaw: input.yaw, pitch: input.pitch }, true);
    expect(turned.yaw).toBe(input.yaw);
    expect(turned.pitch).toBe(input.pitch);
    expect(turned.yaw).not.toBe(parsed.yaw);

    const beforeSwipe = input.yaw;
    lookZone!.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 10, clientY: 10, bubbles: true }));
    lookZone!.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 48, clientY: 10, bubbles: true }));
    lookZone!.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 90, clientY: 16, bubbles: true }));
    expect(input.yaw).not.toBeCloseTo(beforeSwipe, 5);
  });
});

function installCoarsePointer(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
}

function callbacks(): InputCallbacks {
  return {
    canCapture: () => true,
    toggleInventory: () => {},
    togglePause: () => {},
    openChat: () => {},
    dropItem: () => {},
    selectHotbar: () => {},
    classifyWorldTouch: () => ({ intent: 'mine', yaw: 2.4, pitch: -0.8 }),
    onPointerLockAcquired: () => {},
    onPointerLockReleased: (_reason: PointerUnlockReason) => {},
    onPointerLockRequestFailed: () => {},
  };
}
