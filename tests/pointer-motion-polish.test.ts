import { describe, expect, it, vi } from 'vitest';
import { PointerMotionFilter } from '../src/input/pointerMotion';
import { PointerLockAttempt, classifyPointerUnlock } from '../src/input/pointerLock';

describe('conservative pointer motion', () => {
  it('passes ordinary movement exactly, without smoothing/clamping', () => {
    const filter = new PointerMotionFilter();
    for (const sample of [[2, 1], [-20, 4], [250, -80], [0, 0], [-140, -90]]) {
      expect(filter.accept(sample[0]!, sample[1]!)).toEqual(sample);
    }
  });
  it('rejects non-finite input without contaminating the history', () => {
    const filter = new PointerMotionFilter();
    for (const value of [NaN, Infinity, -Infinity]) expect(filter.accept(value, 1)).toEqual([0, 0]);
    expect(filter.discardedInvalid).toBe(3);
    expect(filter.accept(3, 4)).toEqual([3, 4]);
    expect(filter.average).toBe(5);
  });
  it('drops only an isolated extreme outlier, keeping adjacent normal samples', () => {
    const filter = new PointerMotionFilter();
    for (let i = 0; i < 16; i++) filter.accept(5, 0);
    expect(filter.accept(3500, -2400)).toEqual([0, 0]);
    expect(filter.accept(6, 2)).toEqual([6, 2]);
    expect(filter.discardedSpikes).toBe(1);
    expect(filter.average).toBeLessThan(10);
  });
  it('preserves the exact total of sustained fast/high-DPI movement', () => {
    const filter = new PointerMotionFilter();
    for (let i = 0; i < 16; i++) filter.accept(5, 0);
    let total = 0;
    for (let i = 0; i < 20; i++) total += filter.accept(1400, 0)[0];
    expect(total).toBe(28000);
    expect(filter.discardedSpikes).toBe(0);
  });
  it('never compares a fresh lock/blur/visibility session with old deltas', () => {
    const filter = new PointerMotionFilter();
    for (let i = 0; i < 16; i++) filter.accept(1, 0);
    filter.accept(5000, 0);
    filter.reset();
    expect(filter.accept(-1800, 100)).toEqual([-1800, 100]);
    expect(filter.discardedSpikes).toBe(0);
  });
  it('keeps a bounded 16-sample history', () => {
    const filter = new PointerMotionFilter();
    for (let i = 0; i < 10000; i++) filter.accept(i % 32, 0);
    expect((filter as any).history).toHaveLength(16);
    expect(Number.isFinite(filter.median)).toBe(true);
  });
});

describe('raw pointer lock: exactly one fallback, no retry loop', () => {
  it('falls back on NotSupportedError and deduplicates event + promise rejection', async () => {
    const failed = vi.fn();
    const request = vi.fn().mockRejectedValueOnce({ name: 'NotSupportedError' }).mockResolvedValueOnce(undefined);
    const attempt = new PointerLockAttempt(request, failed);
    attempt.start(); attempt.handleErrorEvent();
    await Promise.resolve(); await Promise.resolve();
    expect(request.mock.calls).toEqual([[{ unadjustedMovement: true }], [undefined]]);
    expect(attempt.fallbackUsed).toBe(true);
    expect(failed).not.toHaveBeenCalled();
    attempt.finish(); attempt.handleErrorEvent();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['NotAllowedError', 'SecurityError'])('does not retry %s', async (name) => {
    const failed = vi.fn(), request = vi.fn().mockRejectedValue({ name });
    const attempt = new PointerLockAttempt(request, failed);
    attempt.start(); await Promise.resolve(); attempt.handleErrorEvent();
    expect(request).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
  });
  it('supports void-return legacy success without a second request', () => {
    const request = vi.fn(), failed = vi.fn();
    const attempt = new PointerLockAttempt(request, failed);
    attempt.start(); attempt.finish();
    expect(request).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });
  it('supports an old options TypeError, stops after the plain request fails', () => {
    const failed = vi.fn();
    const request = vi.fn().mockImplementationOnce(() => { throw new TypeError(); })
      .mockImplementationOnce(() => { throw new Error(); });
    const attempt = new PointerLockAttempt(request, failed);
    attempt.start(); attempt.handleErrorEvent();
    expect(request).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledOnce();
  });
  it('a pending request cannot reacquire after inventory/blur cancels it', async () => {
    const request = vi.fn().mockRejectedValue({ name: 'NotSupportedError' }), failed = vi.fn();
    const attempt = new PointerLockAttempt(request, failed);
    attempt.start(); attempt.finish(); await Promise.resolve();
    expect(request).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });
  it('reports unknown focused unlock honestly instead of inferring Escape', () => {
    expect(classifyPointerUnlock({ previouslyLocked: true, nowLocked: false,
      programmaticReleasePending: false, documentHidden: false, documentHasFocus: true })).toBe('unknown');
  });
});
