export interface LongTaskSample {
  readonly duration: number;
  readonly startTime: number;
  readonly name: string;
  readonly background: boolean;
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
  readonly background?: boolean;
}

/** Capture gameplay stutters that are already visible (~1.5–2 frames). */
export const FRAME_SPIKE_CAPTURE_MS = 33;
/** Console noise stays on severe hitches only. */
export const FRAME_SPIKE_LOG_MS = 100;
export const LONG_TASK_CAPTURE_MS = 50;
export const LONG_TASK_LOG_MS = 100;

/**
 * DEV long-task + frame-spike capture. Production never constructs this
 * unless Game is in a DEV runtime.
 */
export class LongTaskMonitor {
  maxLongTaskMs = 0;
  longTaskCount = 0;
  latestLongTask?: LongTaskSample;
  maxLongTask?: LongTaskSample;
  maxFrameSpikeMs = 0;
  latestFrameSpike?: FrameSpikeSample;
  maxFrameSpike?: FrameSpikeSample;
  maxBackgroundFrameSpikeMs = 0;
  latestBackgroundFrameSpike?: FrameSpikeSample;
  /** @deprecated use latestLongTask; kept as an alias of the historical max sample. */
  get lastLongTask(): LongTaskSample | undefined {
    return this.maxLongTask;
  }
  /** @deprecated use latestFrameSpike / maxFrameSpike. */
  get lastFrameSpike(): FrameSpikeSample | undefined {
    return this.maxFrameSpike;
  }
  private observer?: PerformanceObserver;

  start(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.noteLongTask({
            duration: entry.duration,
            startTime: entry.startTime,
            name: entry.name || 'longtask',
            background: isDocumentHidden(),
          });
        }
      });
      this.observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    } catch {
      this.observer = undefined;
    }
  }

  noteLongTask(sample: LongTaskSample): void {
    if (sample.duration < LONG_TASK_CAPTURE_MS) return;
    this.longTaskCount += 1;
    if (!sample.background) {
      this.latestLongTask = sample;
      if (sample.duration >= this.maxLongTaskMs) {
        this.maxLongTaskMs = sample.duration;
        this.maxLongTask = sample;
      }
    }
    if (sample.duration >= LONG_TASK_LOG_MS && typeof console !== 'undefined') {
      console.info(
        `[longtask] ${sample.duration.toFixed(1)}ms at ${sample.startTime.toFixed(1)} name=${sample.name}`
        + (sample.background ? ' bg=1' : ''),
      );
    }
  }

  noteFrameSpike(sample: FrameSpikeSample): void {
    if (sample.frameMs < FRAME_SPIKE_CAPTURE_MS) return;
    if (sample.background) {
      this.latestBackgroundFrameSpike = sample;
      if (sample.frameMs >= this.maxBackgroundFrameSpikeMs) this.maxBackgroundFrameSpikeMs = sample.frameMs;
    } else {
      this.latestFrameSpike = sample;
      if (sample.frameMs >= this.maxFrameSpikeMs) {
        this.maxFrameSpikeMs = sample.frameMs;
        this.maxFrameSpike = sample;
      }
    }
    if (sample.frameMs < FRAME_SPIKE_LOG_MS || typeof console === 'undefined') return;
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
      + `bg=${sample.background ? 'Y' : 'n'} `
      + `top=${String(ranked[0]?.[0])}=${Number(ranked[0]?.[1] ?? 0).toFixed(1)} `
      + `tick=${sample.tickMs.toFixed(1)} gen=${sample.generateMs.toFixed(1)} light=${sample.lightMs.toFixed(1)} `
      + `mesh=${sample.meshMs.toFixed(1)} render=${sample.renderMs.toFixed(1)} other=${sample.otherMs.toFixed(1)} `
      + `jobs gen=${sample.genJobs} mesh=${sample.meshJobs}`,
    );
  }

  hudLine(now = performance.now()): string {
    const latestTask = this.latestLongTask;
    const maxTask = this.maxLongTask;
    const latestSpike = this.latestFrameSpike;
    const maxSpike = this.maxFrameSpike;
    const latestAge = latestTask ? now - latestTask.startTime : -1;
    const maxAge = maxTask ? now - maxTask.startTime : -1;
    const spikeAge = latestSpike ? now - latestSpike.at : -1;
    return [
      `longtask latest=${latestTask ? `${latestTask.duration.toFixed(0)}ms@${latestAge.toFixed(0)}ms` : '—'} `
      + `max=${this.maxLongTaskMs.toFixed(0)}ms`
      + (maxTask ? `@${maxAge.toFixed(0)}ms` : '')
      + ` n=${this.longTaskCount}`,
      `frameSpike latest=${latestSpike ? `${latestSpike.frameMs.toFixed(0)}ms@${spikeAge.toFixed(0)}ms` : '0ms'} `
      + `max=${this.maxFrameSpikeMs.toFixed(0)}ms`
      + (maxSpike
        ? ` mesh=${maxSpike.meshMs.toFixed(0)} gen=${maxSpike.generateMs.toFixed(0)} `
          + `light=${maxSpike.lightMs.toFixed(0)} tick=${maxSpike.tickMs.toFixed(0)} other=${maxSpike.otherMs.toFixed(0)}`
        : '')
      + (this.maxBackgroundFrameSpikeMs > 0 ? ` bgMax=${this.maxBackgroundFrameSpikeMs.toFixed(0)}ms` : ''),
    ].join('\n');
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden === true || document.visibilityState === 'hidden';
}
