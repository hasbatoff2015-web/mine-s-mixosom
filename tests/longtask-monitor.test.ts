import { describe, expect, it } from 'vitest';
import { LongTaskMonitor } from '../src/debug/longTaskMonitor';

describe('LongTaskMonitor', () => {
  it('records frame spikes at >=100ms with the dominant subsystem', () => {
    const monitor = new LongTaskMonitor();
    monitor.noteFrameSpike({
      frameMs: 40,
      tickMs: 1,
      generateMs: 1,
      lightMs: 1,
      meshMs: 1,
      renderMs: 1,
      otherMs: 35,
      lifecycle: 'PLAYING',
      loading: false,
      genJobs: 0,
      meshJobs: 0,
      at: 0,
    });
    expect(monitor.lastFrameSpike).toBeUndefined();
    monitor.noteFrameSpike({
      frameMs: 1697,
      tickMs: 12,
      generateMs: 20,
      lightMs: 8,
      meshMs: 40,
      renderMs: 15,
      otherMs: 1600,
      lifecycle: 'LOADING_WORLD',
      loading: true,
      genJobs: 8,
      meshJobs: 4,
      at: 10,
    });
    expect(monitor.maxFrameSpikeMs).toBe(1697);
    expect(monitor.lastFrameSpike?.otherMs).toBe(1600);
    expect(monitor.lastFrameSpike?.loading).toBe(true);
    expect(monitor.hudLine()).toContain('frameSpike max=1697');
  });
});
