/**
 * A rewarded break is paid only after a world save that started after the
 * break was queued. Several breaks share one save. A failed save pays nothing
 * and keeps the batch for a later successful save. A crash before that save
 * pays nothing: delivery is at-most-once.
 */
export class BlockRewardBarrier<T> {
  private pending: T[] = [];
  private inflight = false;
  private scheduled = false;

  constructor(
    private readonly save: () => Promise<boolean>,
    private readonly pay: (item: T) => Promise<void>,
  ) {}

  submit(item: T): void {
    this.pending.push(item);
    if (this.scheduled || this.inflight) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.pump();
    });
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private async pump(): Promise<void> {
    if (this.inflight || this.pending.length === 0) return;
    this.inflight = true;
    const batch = this.pending;
    this.pending = [];
    let ok = false;
    try {
      ok = await this.save();
    } catch {
      ok = false;
    }
    if (!ok) {
      this.pending = batch.concat(this.pending);
      this.inflight = false;
      return;
    }
    for (const item of batch) {
      try {
        await this.pay(item);
      } catch {
        // The save already captured the break. A later identical source id
        // will not pay twice. A lost credit here is the accepted at-most-once window.
      }
    }
    this.inflight = false;
    if (this.pending.length > 0) void this.pump();
  }
}
