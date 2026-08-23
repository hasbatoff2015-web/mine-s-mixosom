import { describe, expect, it } from 'vitest';
import { classifySpike, DevProfiler, isChunkOverlayQueryEnabled, isPerfQueryEnabled, readPerfScenario } from '../src/core/devProfiler';
import { adaptiveJobBudgetMs } from '../src/world/worldJobs';

describe('DEV profiler helpers', () => {
  it('reads ?perf=1 without treating other flags as enabled', () => {
    expect(isPerfQueryEnabled('?perf=1')).toBe(true);
    expect(isPerfQueryEnabled('?perf=true')).toBe(true);
    expect(isPerfQueryEnabled('?qaMob=cow')).toBe(false);
    expect(readPerfScenario('?perf=1&perfScenario=CREATIVE_BREAK_STRESS')).toBe('CREATIVE_BREAK_STRESS');
    expect(isChunkOverlayQueryEnabled('?perf=1&chunks=1')).toBe(true);
    expect(isChunkOverlayQueryEnabled('?perf=1')).toBe(false);
    expect(isChunkOverlayQueryEnabled('?chunks=1')).toBe(true);
  });

  it('attributes a spike to the largest cost bucket', () => {
    expect(classifySpike({
      frameMs: 47.3,
      tickMs: 2,
      generateMs: 0,
      lightMs: 8,
      meshMs: 31,
      entityMs: 1,
      renderMs: 5,
      otherMs: 0.3,
    })).toBe('mesh');
  });

  it('shrinks the world-job budget when the frame is already expensive', () => {
    expect(adaptiveJobBudgetMs(12, 16.67, 5)).toBeLessThan(adaptiveJobBudgetMs(4, 16.67, 5));
    expect(adaptiveJobBudgetMs(16, 16.67, 5)).toBe(0);
  });

  it('stores a last-spike timestamp so HUD age is not confused with the current frame', () => {
    const profiler = new DevProfiler(true);
    profiler.addFrame({
      frameMs: 39.5,
      tickMs: 1,
      generateMs: 0,
      lightMs: 2,
      meshMs: 30,
      entityMs: 0,
      renderMs: 4,
      otherMs: 0.5,
    }, 0.016);
    const snapshot = profiler.snapshot({
      generateJobs: 0,
      meshJobs: 0,
      waitingMesh: 370,
      waitingGenerate: 0,
      lightingJobs: 100,
      dirtyChunks: 0,
      blockMutations: 0,
      mobCount: 0,
      entityUpdateMs: 0,
    });
    expect(snapshot?.lastSpike?.frameMs).toBe(39.5);
    expect(snapshot?.lastSpike?.category).toBe('mesh');
    expect(snapshot?.lastSpikeAtMs).toBeGreaterThan(0);
  });
});
