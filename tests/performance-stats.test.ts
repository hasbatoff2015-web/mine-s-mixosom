import { describe, expect, it } from 'vitest';
import { RollingTimingWindow } from '../src/core/PerformanceStats';

describe('rolling performance telemetry', () => {
  it('keeps a bounded rolling window and reports average, p95 and spike', () => {
    const window = new RollingTimingWindow(4);
    for (const sample of [1, 2, 3, 4, 20]) window.add(sample);
    const stats = window.snapshot();
    expect(stats.samples).toBe(4);
    expect(stats.averageMs).toBe(7.25);
    expect(stats.p95Ms).toBe(20);
    expect(stats.p99Ms).toBe(20);
    expect(stats.maximumMs).toBe(20);
  });
});
