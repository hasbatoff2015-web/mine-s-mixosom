import { describe, expect, it } from 'vitest';
import {
  POINTER_LOCK_AUTO_RETRY,
  applyPointerLockRequest,
  classifyPointerUnlock,
  shouldExitPointerLock,
  shouldIgnoreEscapeKeydown,
  shouldOpenPauseOnUnlock,
  shouldRequestPointerLock,
  shouldShowPointerLockFallback,
} from '../src/input/pointerLock';

function canCapture(lifecyclePlaying: boolean, overlayOpen: boolean): boolean {
  return lifecyclePlaying && !overlayOpen;
}

describe('pointer lock unlock reasons', () => {
  it('classifies inventory/chest release as programmatic, not focus-lost', () => {
    expect(classifyPointerUnlock({
      previouslyLocked: true,
      nowLocked: false,
      programmaticReleasePending: true,
      documentHidden: false,
      documentHasFocus: true,
    })).toBe('programmatic');
    expect(classifyPointerUnlock({
      previouslyLocked: true,
      nowLocked: false,
      programmaticReleasePending: false,
      documentHidden: true,
      documentHasFocus: false,
    })).toBe('focus-lost');
    expect(classifyPointerUnlock({
      previouslyLocked: true,
      nowLocked: false,
      programmaticReleasePending: true,
      documentHidden: true,
      documentHasFocus: false,
    })).toBe('programmatic');
  });

  it('classifies a focused in-document unlock as escape', () => {
    expect(classifyPointerUnlock({
      previouslyLocked: true,
      nowLocked: false,
      programmaticReleasePending: false,
      documentHidden: false,
      documentHasFocus: true,
    })).toBe('escape');
  });
});

describe('pointer lock after inventory close', () => {
  it('issues a resume request after programmatic inventory release into PLAYING', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => requests.push('lock'))).toBe(true);
    expect(requests).toEqual(['lock']);
    expect(shouldShowPointerLockFallback({
      playing: true,
      inventoryOpen: false,
      coarsePointer: false,
      lockedToCanvas: true,
      lastRequestFailed: false,
    })).toBe(false);
  });
});

describe('pointer lock pause resume', () => {
  it('does not capture when Esc opens pause from gameplay', () => {
    expect(shouldOpenPauseOnUnlock('escape', true, false)).toBe(true);
    expect(applyPointerLockRequest({
      canCapture: canCapture(false, true),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => undefined)).toBe(false);
  });

  it('does not call a duplicate exitPointerLock after Esc already unlocked', () => {
    expect(shouldExitPointerLock(false)).toBe(false);
    expect(shouldExitPointerLock(true)).toBe(true);
    expect(shouldIgnoreEscapeKeydown(true)).toBe(true);
    expect(shouldIgnoreEscapeKeydown(false)).toBe(false);
  });

  it('Continue after pause issues exactly one request', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => requests.push('lock'))).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('successful resume does not require the click fallback overlay', () => {
    expect(shouldShowPointerLockFallback({
      playing: true,
      inventoryOpen: false,
      coarsePointer: false,
      lockedToCanvas: true,
      lastRequestFailed: false,
    })).toBe(false);
  });

  it('failed Continue request requires the click fallback without a retry loop', () => {
    expect(POINTER_LOCK_AUTO_RETRY).toBe(false);
    expect(shouldShowPointerLockFallback({
      playing: true,
      inventoryOpen: false,
      coarsePointer: false,
      lockedToCanvas: false,
      lastRequestFailed: true,
    })).toBe(true);
  });

  it('fallback user click may issue one more request; success clears fallback', () => {
    const requests: string[] = [];
    expect(applyPointerLockRequest({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: false,
    }, () => requests.push('lock'))).toBe(true);
    expect(requests).toEqual(['lock']);
    expect(shouldShowPointerLockFallback({
      playing: true,
      inventoryOpen: false,
      coarsePointer: false,
      lockedToCanvas: true,
      lastRequestFailed: false,
    })).toBe(false);
  });

  it('does not capture resume while an inventory/chest/furnace modal is open', () => {
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, true),
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
    expect(shouldOpenPauseOnUnlock('escape', true, true)).toBe(false);
  });

  it('does not capture on a coarse/touch device or when already locked', () => {
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, false),
      coarsePointer: true,
      lockedToCanvas: false,
    })).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: canCapture(true, false),
      coarsePointer: false,
      lockedToCanvas: true,
    })).toBe(false);
  });
});
