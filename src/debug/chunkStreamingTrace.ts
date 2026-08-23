/**
 * Bounded DEV-only timestamps and event history for nearby chunks.
 * Inactive unless the caller constructs/uses it (Game only does so with ?perf=1).
 */

import {
  TRACE_EVENT_LIMIT,
  chunkKey,
  parseChunkKey,
  type ChunkTimestamps,
  type ChunkTraceEvent,
} from './chunkStreamingInspector';

export interface ChunkTraceRecord extends ChunkTimestamps {
  events: ChunkTraceEvent[];
}

const MAX_RECORDS = 384;

export class ChunkStreamingTrace {
  private readonly records = new Map<string, ChunkTraceRecord>();
  private originMs = 0;

  reset(now: number): void {
    this.records.clear();
    this.originMs = now;
  }

  get origin(): number {
    return this.originMs;
  }

  get size(): number {
    return this.records.size;
  }

  record(cx: number, cz: number): ChunkTraceRecord {
    const key = chunkKey(cx, cz);
    let entry = this.records.get(key);
    if (!entry) {
      entry = { events: [] };
      this.records.set(key, entry);
    }
    return entry;
  }

  get(cx: number, cz: number): ChunkTraceRecord | undefined {
    return this.records.get(chunkKey(cx, cz));
  }

  timestamps(cx: number, cz: number): ChunkTimestamps {
    const entry = this.get(cx, cz);
    if (!entry) return {};
    const { events: _events, ...timestamps } = entry;
    return timestamps;
  }

  mark(kind: ChunkTraceEvent['kind'], cx: number, cz: number, now: number): void {
    if (this.originMs === 0) this.originMs = now;
    const entry = this.record(cx, cz);
    const stamp = (field: keyof ChunkTimestamps, once = true): void => {
      if (!once || entry[field] === undefined) entry[field] = now;
    };
    switch (kind) {
      case 'requested':
        stamp('requestedAt');
        break;
      case 'generationStarted':
        stamp('generationStartedAt');
        break;
      case 'generated':
        stamp('generatedAt');
        break;
      case 'lightQueued':
        break;
      case 'lightStarted':
        stamp('lightingStartedAt');
        break;
      case 'lightYielded':
        break;
      case 'lit':
        stamp('litAt');
        break;
      case 'meshQueued':
        stamp('meshQueuedAt');
        break;
      case 'meshStarted':
        stamp('meshStartedAt', false);
        break;
      case 'meshed':
        stamp('meshedAt', false);
        break;
      case 'visible':
        stamp('visibleAt');
        break;
      default:
        break;
    }
    const last = entry.events[entry.events.length - 1];
    if (last && last.kind === kind && now - last.t < 2) return;
    entry.events.push({ t: now, kind });
    if (entry.events.length > TRACE_EVENT_LIMIT) {
      entry.events.splice(0, entry.events.length - TRACE_EVENT_LIMIT);
    }
  }

  /** Drop far records so history stays bounded. Never drop the freeze target. */
  evictFar(originCx: number, originCz: number, keepRadius: number, keepKeys: ReadonlySet<string>): void {
    if (this.records.size <= MAX_RECORDS) return;
    for (const key of [...this.records.keys()]) {
      if (this.records.size <= MAX_RECORDS) return;
      if (keepKeys.has(key)) continue;
      const { cx, cz } = parseChunkKey(key);
      const dist = Math.max(Math.abs(cx - originCx), Math.abs(cz - originCz));
      if (dist > keepRadius) this.records.delete(key);
    }
    if (this.records.size <= MAX_RECORDS) return;
    for (const key of [...this.records.keys()]) {
      if (this.records.size <= MAX_RECORDS) return;
      if (!keepKeys.has(key)) this.records.delete(key);
    }
  }
}
