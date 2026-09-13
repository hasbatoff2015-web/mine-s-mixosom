/** Viewer-private, ephemeral combat marks. Never serialize or broadcast this store. */
export class VhMarks {
  private readonly marks = new Map<string, Map<string, number>>();

  mark(viewerId: string, targetId: string, nowTick: number): void {
    if (viewerId === targetId) return;
    let targets = this.marks.get(viewerId);
    if (!targets) {
      targets = new Map();
      this.marks.set(viewerId, targets);
    }
    targets.set(targetId, nowTick + 200);
  }

  forViewer(viewerId: string, nowTick: number): string[] {
    const targets = this.marks.get(viewerId);
    if (!targets) return [];
    for (const [targetId, expiry] of targets) if (expiry <= nowTick) targets.delete(targetId);
    if (targets.size === 0) this.marks.delete(viewerId);
    return [...targets.keys()];
  }

  clearTarget(targetId: string): void {
    for (const [viewerId, targets] of this.marks) {
      targets.delete(targetId);
      if (targets.size === 0) this.marks.delete(viewerId);
    }
  }

  clearPlayer(playerId: string): void {
    this.marks.delete(playerId);
    this.clearTarget(playerId);
  }

  clear(): void { this.marks.clear(); }
}
