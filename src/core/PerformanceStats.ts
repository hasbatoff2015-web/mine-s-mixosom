export interface TimingSnapshot {
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly samples: number;
}

/** Allocation-free rolling timing window for frame/tick telemetry. */
export class RollingTimingWindow {
  private readonly values: Float32Array;
  private cursor = 0;
  private count = 0;

  constructor(capacity: number) {
    this.values = new Float32Array(Math.max(1, Math.floor(capacity)));
  }

  add(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  snapshot(): TimingSnapshot {
    if (this.count === 0) return { averageMs: 0, p95Ms: 0, maximumMs: 0, samples: 0 };
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    let total = 0;
    for (let index = 0; index < this.count; index += 1) total += this.values[index]!;
    return {
      averageMs: total / this.count,
      p95Ms: sorted[Math.max(0, Math.ceil(this.count * 0.95) - 1)] ?? 0,
      maximumMs: sorted[this.count - 1] ?? 0,
      samples: this.count,
    };
  }
}
