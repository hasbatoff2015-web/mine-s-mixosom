/** No smoothing or ordinary-delta clamp. Only an extreme, isolated sample is
 * quarantined until the next event; sustained fast motion restores its full sum.
 */
export class PointerMotionFilter {
  private readonly history: number[] = [];
  private cursor = 0;
  private sum = 0;
  private candidate?: { x: number; y: number; magnitude: number };
  discardedInvalid = 0;
  discardedSpikes = 0;

  reset(): void {
    this.history.length = 0;
    this.cursor = 0;
    this.sum = 0;
    this.candidate = undefined;
  }

  get average(): number { return this.history.length ? this.sum / this.history.length : 0; }
  get median(): number {
    const values = [...this.history].sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)]! : 0;
  }

  accept(x: number, y: number): readonly [number, number] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(Math.hypot(x, y))) {
      this.discardedInvalid++;
      return [0, 0];
    }
    const magnitude = Math.hypot(x, y);
    if (this.candidate) {
      const pending = this.candidate;
      this.candidate = undefined;
      if (magnitude >= pending.magnitude * 0.5 && magnitude <= pending.magnitude * 2) {
        this.record(pending.magnitude);
        this.record(magnitude);
        return [pending.x + x, pending.y + y];
      }
      this.discardedSpikes++;
    }
    if (this.history.length >= 4 && magnitude > 800 && magnitude > Math.max(1, this.average) * 12) {
      this.candidate = { x, y, magnitude };
      return [0, 0];
    }
    this.record(magnitude);
    return [x, y];
  }

  private record(magnitude: number): void {
    if (this.history.length === 16) {
      this.sum -= this.history[this.cursor]!;
      this.history[this.cursor] = magnitude;
      this.cursor = (this.cursor + 1) % 16;
    } else this.history.push(magnitude);
    this.sum += magnitude;
  }
}
