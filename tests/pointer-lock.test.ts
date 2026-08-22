import { describe, expect, it } from 'vitest';
import { applyPointerLockRequest, shouldRequestPointerLock } from '../src/input/pointerLock';

/** Mirrors Game canCapture: PLAYING and no inventory/pause overlay. */
function canCapture(lifecyclePlaying: boolean, overlayOpen: boolean): boolean {
  return lifecyclePlaying && !overlayOpen;
}

describe('pointer lock after inventory close', () => {
  it('captures after inventory close into PLAYING, not while the modal is open', () => {
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, true),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => undefined)).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(true);
  });
});

describe('pointer lock pause resume', () => {
  it('does not capture when Esc opens pause from gameplay', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(false, true),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => requests.push('lock'))).toBe(false);
    expect(requests).toEqual([]);
  });

  it('captures when Continue resumes pause into PLAYING', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => requests.push('lock'))).toBe(true);
    expect(requests).toEqual(['lock']);
  });

  it('does not capture resume while an inventory/chest/furnace modal is open', () => {
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, true),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
  });

  it('does not capture on a coarse/touch device', () => {
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, false),
      coarsePointer: true,
      lockedToCanvas: false,
    })).toBe(false);
  });

  it('does not request again when already locked to the canvas', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: true,
    }, () => requests.push('lock'))).toBe(false);
    expect(requests).toEqual([]);
  });
});
