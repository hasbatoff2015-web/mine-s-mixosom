import type { CommittedCraft } from '../../src/crafting/types';
import type { ItemStack } from '../../src/inventory/types';
import type { IdentityScanInput } from '../identity/locationScan';
import {
  emptyResourceCounts,
  isMonitoredResource,
  type MonitoredResourceId,
} from './monitored';

export const RESOURCE_ANOMALY_LIMIT = 200;
export const RESOURCE_RECENT_LIMIT = 100;
export const RESOURCE_SOURCE_KEY_LIMIT = 500;

/**
 * Sources this stage does not instrument.
 * An increase is evidence for investigation, not proof of cheating.
 * Explosion ore loot is not rolled on the server. A blast can still remove a
 * container from the count without a sink record. Drop despawn and lava burn
 * are decreases only. Reapplying a vanished event chest is not credited again.
 */
export const RESOURCE_KNOWN_GAPS = ['explosion-ore-drops', 'drop-despawn', 'event-chest-reapply'] as const;

export type ResourceStatus = 'balanced' | 'explained-change' | 'unexplained-increase' | 'incomplete-coverage';

export interface ResourceSourceEvent {
  readonly kind: 'mine' | 'server-grant' | 'creative-grant' | 'smelt' | 'craft' | 'sink' | 'reward';
  readonly itemId: string;
  readonly quantity: number;
  readonly at: number;
  readonly sourceId?: string;
  readonly detail?: string;
}

export interface ResourceAnomaly {
  readonly id: string;
  readonly worldId: string;
  readonly itemId: string;
  readonly observed: number;
  readonly expected: number;
  readonly unexplained: number;
  readonly status: 'unexplained-increase' | 'incomplete-coverage';
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly seenCount: number;
}

export interface ResourceItemReport {
  readonly itemId: MonitoredResourceId;
  readonly baseline: number;
  readonly current: number;
  readonly expected: number;
  readonly unexplained: number;
  readonly status: ResourceStatus;
}

export interface ResourceInspection {
  readonly worldId: string;
  readonly baselineAt: number | null;
  readonly holderCoverage: 'complete' | 'incomplete';
  readonly unresolvedSources: number;
  readonly knownGaps: readonly string[];
  readonly resources: readonly ResourceItemReport[];
  readonly recentSources: readonly ResourceSourceEvent[];
  readonly anomalies: readonly ResourceAnomaly[];
}

interface ResourceFile {
  readonly version: 1;
  readonly baseline: Record<MonitoredResourceId, number> | null;
  readonly baselineAt: number | null;
  readonly minted: Record<MonitoredResourceId, number>;
  readonly transformedIn: Record<MonitoredResourceId, number>;
  readonly transformedOut: Record<MonitoredResourceId, number>;
  readonly sunk: Record<MonitoredResourceId, number>;
  readonly sourceKeys: readonly string[];
  readonly recent: readonly ResourceSourceEvent[];
  readonly anomalies: readonly ResourceAnomaly[];
}

/**
 * Observational totals for a few stackable resources.
 * Inventory state stays authoritative. This ledger does not move items.
 */
export class ResourceLedger {
  private baseline: Record<MonitoredResourceId, number> | null = null;
  private baselineAt: number | null = null;
  private minted = emptyResourceCounts();
  private transformedIn = emptyResourceCounts();
  private transformedOut = emptyResourceCounts();
  private sunk = emptyResourceCounts();
  private sourceKeys: string[] = [];
  private readonly seenKeys = new Set<string>();
  private recent: ResourceSourceEvent[] = [];
  private anomalies: ResourceAnomaly[] = [];
  private dirty = false;

  load(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const file = raw as Partial<ResourceFile>;
    if (file.baseline && typeof file.baseline === 'object') {
      this.baseline = { ...emptyResourceCounts(), ...file.baseline };
      this.baselineAt = typeof file.baselineAt === 'number' ? file.baselineAt : 0;
    }
    this.minted = { ...emptyResourceCounts(), ...(file.minted ?? {}) };
    this.transformedIn = { ...emptyResourceCounts(), ...(file.transformedIn ?? {}) };
    this.transformedOut = { ...emptyResourceCounts(), ...(file.transformedOut ?? {}) };
    this.sunk = { ...emptyResourceCounts(), ...(file.sunk ?? {}) };
    const sourceKeys = Array.isArray(file.sourceKeys) ? file.sourceKeys.filter((key) => typeof key === 'string') : [];
    const recent = Array.isArray(file.recent) ? file.recent.filter(isSourceEvent) : [];
    const anomalies = Array.isArray(file.anomalies) ? file.anomalies.filter(isAnomaly) : [];
    this.sourceKeys = sourceKeys.slice(-RESOURCE_SOURCE_KEY_LIMIT);
    this.seenKeys.clear();
    for (const key of this.sourceKeys) this.seenKeys.add(key);
    this.recent = recent.slice(-RESOURCE_RECENT_LIMIT);
    this.anomalies = anomalies.slice(-RESOURCE_ANOMALY_LIMIT);
    this.dirty = sourceKeys.length > this.sourceKeys.length
      || recent.length > this.recent.length
      || anomalies.length > this.anomalies.length;
  }

  serialize(): ResourceFile {
    return {
      version: 1,
      baseline: this.baseline ? { ...this.baseline } : null,
      baselineAt: this.baselineAt,
      minted: { ...this.minted },
      transformedIn: { ...this.transformedIn },
      transformedOut: { ...this.transformedOut },
      sunk: { ...this.sunk },
      sourceKeys: [...this.sourceKeys],
      recent: [...this.recent],
      anomalies: [...this.anomalies],
    };
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markPersisted(): void {
    this.dirty = false;
  }

  private signature(): string {
    return JSON.stringify({
      baseline: this.baseline,
      minted: this.minted,
      transformedIn: this.transformedIn,
      transformedOut: this.transformedOut,
      sunk: this.sunk,
      anomalies: this.anomalies.map((row) => [row.id, row.unexplained, row.status, row.expected, row.observed]),
    });
  }

  noteMine(itemId: string, quantity: number, sourceId: string): void {
    if (!isMonitoredResource(itemId) || quantity <= 0) return;
    const key = `mine:${sourceId}:${itemId}`;
    if (this.seenKeys.has(key)) return;
    this.rememberKey(key);
    this.minted[itemId] += quantity;
    this.pushRecent({ kind: 'mine', itemId, quantity, at: Date.now(), sourceId });
    this.dirty = true;
  }

  noteGrant(itemId: string, quantity: number): void {
    if (!isMonitoredResource(itemId) || quantity <= 0) return;
    this.minted[itemId] += quantity;
    this.pushRecent({ kind: 'server-grant', itemId, quantity, at: Date.now() });
    this.dirty = true;
  }

  noteCreative(previous: ItemStack | null, next: ItemStack | null): void {
    if (previous && isMonitoredResource(previous.itemId)) {
      this.sunk[previous.itemId] += previous.count;
      this.pushRecent({ kind: 'sink', itemId: previous.itemId, quantity: previous.count, at: Date.now(), detail: 'creative-replace' });
      this.dirty = true;
    }
    if (next && isMonitoredResource(next.itemId)) {
      this.minted[next.itemId] += next.count;
      this.pushRecent({ kind: 'creative-grant', itemId: next.itemId, quantity: next.count, at: Date.now() });
      this.dirty = true;
    }
  }

  noteCraft(commit: CommittedCraft): void {
    if (commit.completed <= 0) return;
    for (const row of commit.consumed) {
      if (!isMonitoredResource(row.itemId) || row.count <= 0) continue;
      this.transformedIn[row.itemId] += row.count;
      this.pushRecent({ kind: 'craft', itemId: row.itemId, quantity: row.count, at: Date.now(), detail: `in:${commit.recipeId}` });
      this.dirty = true;
    }
    if (isMonitoredResource(commit.producedItemId) && commit.producedCount > 0) {
      this.transformedOut[commit.producedItemId] += commit.producedCount;
      this.pushRecent({ kind: 'craft', itemId: commit.producedItemId, quantity: commit.producedCount, at: Date.now(), detail: `out:${commit.recipeId}` });
      this.dirty = true;
    }
  }

  noteSmelt(inputItemId: string, outputItemId: string, outputCount: number): void {
    if (outputCount <= 0) return;
    if (isMonitoredResource(inputItemId)) {
      this.transformedIn[inputItemId] += 1;
      this.pushRecent({ kind: 'smelt', itemId: inputItemId, quantity: 1, at: Date.now(), detail: `in:${outputItemId}` });
      this.dirty = true;
    }
    if (isMonitoredResource(outputItemId)) {
      this.transformedOut[outputItemId] += outputCount;
      this.pushRecent({ kind: 'smelt', itemId: outputItemId, quantity: outputCount, at: Date.now(), detail: `out:${inputItemId}` });
      this.dirty = true;
    }
  }

  /** Boss loot, event-chest fill, and a detached block drop. A sourceId credits once. */
  noteReward(itemId: string, quantity: number, sourceId?: string): void {
    if (!isMonitoredResource(itemId) || quantity <= 0) return;
    if (sourceId) {
      const key = `reward:${sourceId}:${itemId}`;
      if (this.seenKeys.has(key)) return;
      this.rememberKey(key);
    }
    this.minted[itemId] += quantity;
    this.pushRecent({ kind: 'reward', itemId, quantity, at: Date.now(), ...(sourceId ? { sourceId } : {}) });
    this.dirty = true;
  }

  noteSink(itemId: string, quantity: number, detail: string, sourceId?: string): void {
    if (!isMonitoredResource(itemId) || quantity <= 0) return;
    if (sourceId) {
      const key = `sink:${sourceId}:${itemId}`;
      if (this.seenKeys.has(key)) return;
      this.rememberKey(key);
    }
    this.sunk[itemId] += quantity;
    this.pushRecent({ kind: 'sink', itemId, quantity, at: Date.now(), detail, ...(sourceId ? { sourceId } : {}) });
    this.dirty = true;
  }

  /**
   * Compare the live quantity snapshot with the baseline and recorded changes.
   * The first call with no saved baseline records the snapshot and does not accuse it.
   */
  observe(worldId: string, current: Record<MonitoredResourceId, number>, unresolvedSources: number, now: number): boolean {
    const before = this.signature();
    if (!this.baseline) {
      this.baseline = { ...current };
      this.baselineAt = now;
      return this.signature() !== before;
    }
    const incomplete = unresolvedSources > 0;
    for (const itemId of Object.keys(this.baseline) as MonitoredResourceId[]) {
      const expected = this.expected(itemId);
      const unexplained = Math.max(0, current[itemId] - expected);
      const id = `resource:${worldId}:${itemId}`;
      if (unexplained <= 0) {
        this.anomalies = this.anomalies.filter((row) => row.id !== id);
        continue;
      }
      const status = incomplete ? 'incomplete-coverage' as const : 'unexplained-increase' as const;
      const existing = this.anomalies.find((row) => row.id === id);
      const next: ResourceAnomaly = {
        id,
        worldId,
        itemId,
        observed: current[itemId],
        expected,
        unexplained,
        status,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        seenCount: (existing?.seenCount ?? 0) + 1,
      };
      this.anomalies = this.anomalies.filter((row) => row.id !== id).concat(next);
    }
    this.anomalies = this.anomalies.slice(-RESOURCE_ANOMALY_LIMIT);
    return this.signature() !== before;
  }

  inspect(
    worldId: string,
    current: Record<MonitoredResourceId, number>,
    unresolvedSources: number,
  ): ResourceInspection {
    const baseline = this.baseline ?? emptyResourceCounts();
    const incomplete = unresolvedSources > 0 || !this.baseline;
    const resources = (Object.keys(baseline) as MonitoredResourceId[]).map((itemId) => {
      const expected = this.baseline ? this.expected(itemId) : current[itemId];
      const unexplained = this.baseline ? Math.max(0, current[itemId] - expected) : 0;
      let status: ResourceStatus = 'balanced';
      if (!this.baseline) status = 'balanced';
      else if (unexplained > 0 && incomplete) status = 'incomplete-coverage';
      else if (unexplained > 0) status = 'unexplained-increase';
      else if (current[itemId] !== baseline[itemId] || this.minted[itemId] > 0 || this.transformedOut[itemId] > 0 || this.transformedIn[itemId] > 0 || this.sunk[itemId] > 0) {
        status = 'explained-change';
      }
      return { itemId, baseline: baseline[itemId], current: current[itemId], expected, unexplained, status };
    });
    return {
      worldId,
      baselineAt: this.baselineAt,
      holderCoverage: unresolvedSources > 0 ? 'incomplete' : 'complete',
      unresolvedSources,
      knownGaps: RESOURCE_KNOWN_GAPS,
      resources,
      recentSources: [...this.recent],
      anomalies: [...this.anomalies],
    };
  }

  private expected(itemId: MonitoredResourceId): number {
    const baseline = this.baseline?.[itemId] ?? 0;
    return baseline + this.minted[itemId] + this.transformedOut[itemId] - this.transformedIn[itemId] - this.sunk[itemId];
  }

  private rememberKey(key: string): void {
    this.seenKeys.add(key);
    this.sourceKeys.push(key);
    if (this.sourceKeys.length > RESOURCE_SOURCE_KEY_LIMIT) {
      const dropped = this.sourceKeys.splice(0, this.sourceKeys.length - RESOURCE_SOURCE_KEY_LIMIT);
      for (const old of dropped) this.seenKeys.delete(old);
    }
  }

  private pushRecent(event: ResourceSourceEvent): void {
    this.recent.push(event);
    if (this.recent.length > RESOURCE_RECENT_LIMIT) this.recent.splice(0, this.recent.length - RESOURCE_RECENT_LIMIT);
  }
}

export function countMonitoredResources(input: IdentityScanInput): Record<MonitoredResourceId, number> {
  const counts = emptyResourceCounts();
  const add = (stack: ItemStack | null | undefined): void => {
    if (!stack || !isMonitoredResource(stack.itemId) || !Number.isInteger(stack.count) || stack.count <= 0) return;
    counts[stack.itemId] += stack.count;
  };
  for (const player of input.players) {
    for (const stack of player.inventory) add(stack);
    for (const stack of Object.values(player.armor)) add(stack);
    add(player.offhand);
    add(player.cursor);
    for (const stack of player.craft) add(stack);
    for (const stack of player.portal) add(stack);
    for (const stack of player.heldReturns) add(stack);
  }
  for (const chest of input.chests) for (const stack of chest.slots) add(stack);
  for (const furnace of input.furnaces) for (const stack of furnace.slots) add(stack);
  for (const drop of input.drops) add(drop.stack);
  for (const listing of input.auctions) add(listing.item);
  for (const offer of input.trades) add(offer.stack);
  for (const window of input.buyerWindows) add(window.stack);
  for (const pending of input.buyerReturns) add(pending.stack);
  return counts;
}

function isSourceEvent(value: unknown): value is ResourceSourceEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ResourceSourceEvent>;
  return typeof row.kind === 'string' && typeof row.itemId === 'string' && typeof row.quantity === 'number';
}

function isAnomaly(value: unknown): value is ResourceAnomaly {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ResourceAnomaly>;
  return typeof row.id === 'string' && typeof row.itemId === 'string' && typeof row.unexplained === 'number';
}
