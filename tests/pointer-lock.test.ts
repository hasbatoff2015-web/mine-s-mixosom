import { describe, expect, it } from 'vitest';
import { applyPointerLockRequest, shouldRequestPointerLock } from '../src/input/pointerLock';

describe('pointer lock after inventory close', () => {
  it('captures only after gameplay is resumable, not while a menu holds the cursor', () => {
    expect(shouldRequestPointerLock({
      canCapture: false,
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: true,
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(true);
    expect(shouldRequestPointerLock({
      canCapture: true,
      coarsePointer: true,
      lockedToCanvas: false,
    })).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: true,
      coarsePointer: false,
      lockedToCanvas: true,
    })).toBe(false);
  });

  it('follows PLAYING + inventory closed → capture; open inventory / pause stay released', () => {
    const canCapture = (lifecyclePlaying: boolean, inventoryOpen: boolean) => (
      lifecyclePlaying && !inventoryOpen
    );
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, true),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(true);
    expect(shouldRequestPointerLock({
      canCapture: canCapture(false, false),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
  });

  it('requests the canvas pointer lock API only on the resume transition', () => {
    const requests: string[] = [];
    const request = () => requests.push('lock');
    expect(applyPointerLockRequest({
      canCapture: false,
      coarsePointer: false,
      lockedToCanvas: false,
    }, request)).toBe(false);
    expect(applyPointerLockRequest({
      canCapture: true,
      coarsePointer: false,
      lockedToCanvas: true,
    }, request)).toBe(false);
    expect(applyPointerLockRequest({
      canCapture: true,
      coarsePointer: false,
      lockedToCanvas: false,
    }, request)).toBe(true);
    expect(requests).toEqual(['lock']);
  });
});
