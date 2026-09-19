import { describe, expect, it } from 'vitest';
import {
  FRAME_SPIKE_CAPTURE_MS,
  LongTaskMonitor,
} from '../src/debug/longTaskMonitor';

function sample(frameMs: number, extra: Partial<Parameters<LongTaskMonitor['noteFrameSpike']>[0]> = {}) {
  return {
    frameMs,
    tickMs: 1,
    generateMs: 1,
    lightMs: 1,
    meshMs: 1,
    renderMs: 1,
    otherMs: Math.max(0, frameMs - 5),
    lifecycle: 'PLAYING',
    loading: false,
    genJobs: 0,
    meshJobs: 0,
    at: extra.at ?? 0,
    ...extra,
  };
}

describe('LongTaskMonitor', () => {
  it('captures visible stutters from 33ms without treating them as the historical max alias', () => {
    const monitor = new LongTaskMonitor();
    monitor.noteFrameSpike(sample(20));
    expect(monitor.latestFrameSpike).toBeUndefined();
    expect(FRAME_SPIKE_CAPTURE_MS).toBe(33);

    monitor.noteFrameSpike(sample(40, { meshMs: 30, at: 10 }));
    expect(monitor.latestFrameSpike?.frameMs).toBe(40);
    expect(monitor.maxFrameSpikeMs).toBe(40);

    monitor.noteFrameSpike(sample(1697, {
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
      at: 20,
    }));
    expect(monitor.maxFrameSpikeMs).toBe(1697);
    expect(monitor.maxFrameSpike?.otherMs).toBe(1600);
    expect(monitor.latestFrameSpike?.loading).toBe(true);
    expect(monitor.hudLine(100)).toContain('frameSpike latest=1697ms');
    expect(monitor.hudLine(100)).toContain('max=1697ms');
  });

  it('keeps hidden-tab / resume samples out of the gameplay spike baseline', () => {
    const monitor = new LongTaskMonitor();
    monitor.noteFrameSpike(sample(80, { meshMs: 50, at: 5 }));
    monitor.noteFrameSpike(sample(900, { background: true, otherMs: 890, at: 6 }));
    expect(monitor.latestFrameSpike?.frameMs).toBe(80);
    expect(monitor.maxFrameSpikeMs).toBe(80);
    expect(monitor.maxBackgroundFrameSpikeMs).toBe(900);
    expect(monitor.hudLine()).toContain('bgMax=900ms');
  });

  it('tracks latest longtask separately from the historical max', () => {
    const monitor = new LongTaskMonitor();
    monitor.noteLongTask({ duration: 1923, startTime: 10, name: 'longtask', background: false });
    monitor.noteLongTask({ duration: 80, startTime: 500, name: 'longtask', background: false });
    expect(monitor.latestLongTask?.duration).toBe(80);
    expect(monitor.maxLongTaskMs).toBe(1923);
    expect(monitor.hudLine(600)).toContain('longtask latest=80ms');
    expect(monitor.hudLine(600)).toContain('max=1923ms');
  });
});
