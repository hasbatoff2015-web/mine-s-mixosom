export interface LongTaskSample {
  readonly duration: number;
  readonly startTime: number;
  readonly name: string;
}

export interface FrameSpikeSample {
  readonly frameMs: number;
  readonly tickMs: number;
  readonly generateMs: number;
  readonly lightMs: number;
  readonly meshMs: number;
  readonly renderMs: number;
  readonly otherMs: number;
  readonly lifecycle: string;
  readonly loading: boolean;
  readonly genJobs: number;
  readonly meshJobs: number;
  readonly at: number;
}

/**
 * DEV long-task + frame-spike capture. Production never constructs this
 * unless Game is in a DEV runtime.
 */
export class LongTaskMonitor {
  maxLongTaskMs = 0;
  longTaskCount = 0;
  lastLongTask?: LongTaskSample;
  maxFrameSpikeMs = 0;
  lastFrameSpike?: FrameSpikeSample;
  private observer?: PerformanceObserver;

  start(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration;
          if (duration < 50) continue;
          this.longTaskCount += 1;
          if (duration >= this.maxLongTaskMs) {
            this.maxLongTaskMs = duration;
            this.lastLongTask = {
              duration,
              startTime: entry.startTime,
              name: entry.name || 'longtask',
            };
          }
          if (duration >= 100 && typeof console !== 'undefined') {
            console.info(
              `[longtask] ${duration.toFixed(1)}ms at ${entry.startTime.toFixed(1)} name=${entry.name || 'longtask'}`,
            );
          }
        }
      });
      this.observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    } catch {
      this.observer = undefined;
    }
  }

  noteFrameSpike(sample: FrameSpikeSample): void {
    if (sample.frameMs < 100) return;
    if (sample.frameMs >= this.maxFrameSpikeMs) {
      this.maxFrameSpikeMs = sample.frameMs;
      this.lastFrameSpike = sample;
    }
    if (typeof console === 'undefined') return;
    const ranked = [
      ['mesh', sample.meshMs],
      ['gen', sample.generateMs],
      ['light', sample.lightMs],
      ['tick', sample.tickMs],
      ['render', sample.renderMs],
      ['other', sample.otherMs],
    ].sort((a, b) => Number(b[1]) - Number(a[1]));
    console.info(
      `[frameSpike] ${sample.frameMs.toFixed(1)}ms life=${sample.lifecycle} load=${sample.loading ? 'Y' : 'n'} `
      + `top=${String(ranked[0]?.[0])}=${Number(ranked[0]?.[1] ?? 0).toFixed(1)} `
      + `tick=${sample.tickMs.toFixed(1)} gen=${sample.generateMs.toFixed(1)} light=${sample.lightMs.toFixed(1)} `
      + `mesh=${sample.meshMs.toFixed(1)} render=${sample.renderMs.toFixed(1)} other=${sample.otherMs.toFixed(1)} `
      + `jobs gen=${sample.genJobs} mesh=${sample.meshJobs}`,
    );
  }

  hudLine(now = performance.now()): string {
    const task = this.lastLongTask;
    const spike = this.lastFrameSpike;
    const taskAge = task ? now - task.startTime : -1;
    return [
      `longtask max=${this.maxLongTaskMs.toFixed(0)}ms n=${this.longTaskCount}`
      + (task ? ` last=${task.duration.toFixed(0)}ms@${taskAge.toFixed(0)}ms ${task.name}` : ''),
      `frameSpike max=${this.maxFrameSpikeMs.toFixed(0)}ms`
      + (spike
        ? ` last=${spike.frameMs.toFixed(0)} mesh=${spike.meshMs.toFixed(0)} gen=${spike.generateMs.toFixed(0)} `
          + `light=${spike.lightMs.toFixed(0)} tick=${spike.tickMs.toFixed(0)} other=${spike.otherMs.toFixed(0)}`
        : ''),
    ].join('\n');
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
