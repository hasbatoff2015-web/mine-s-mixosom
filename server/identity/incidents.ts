import type { IdentityFinding, IdentityReport, UniqueItemLocation } from './locationScan';
import { locationKey } from './locationScan';

/** Resolved rows are kept. The log does not grow one row per repeated scan. */
export const IDENTITY_INCIDENT_LIMIT = 400;

export type IdentityCheckpoint = 'startup' | 'save' | 'recheck';

export interface IdentityIncident {
  readonly id: string;
  readonly worldId: string;
  readonly itemInstanceId: string;
  readonly itemIds: readonly string[];
  readonly category: IdentityFinding['status'];
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly seenCount: number;
  readonly locations: readonly UniqueItemLocation[];
  readonly playerIds: readonly string[];
  readonly listingIds: readonly string[];
  readonly tradeIds: readonly string[];
  readonly checkpoint: IdentityCheckpoint;
  readonly confirmed: boolean;
  readonly resolvedAt?: number;
}

interface IncidentFile {
  readonly version: 1;
  readonly incidents: IdentityIncident[];
}

/**
 * Bounded evidence for a later admin. Scanning does not delete items.
 * The same unresolved UUID updates one row.
 */
export class IdentityIncidentLog {
  private incidents: IdentityIncident[] = [];

  load(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const incidents = (raw as { incidents?: unknown }).incidents;
    if (!Array.isArray(incidents)) return;
    this.incidents = incidents.filter(isIncident).slice(-IDENTITY_INCIDENT_LIMIT);
  }

  list(): readonly IdentityIncident[] {
    return this.incidents;
  }

  serialize(): IncidentFile {
    return { version: 1, incidents: this.incidents };
  }

  /**
   * Returns true when the durable evidence changed. A repeated look at the
   * same conflict only updates the in-memory observation counters.
   */
  observe(report: IdentityReport, checkpoint: IdentityCheckpoint, now: number): boolean {
    const seen = new Set<string>();
    let durable = false;
    for (const finding of report.findings) {
      const id = incidentId(report.worldId, finding.itemInstanceId);
      seen.add(id);
      const next = incidentFromFinding(id, report.worldId, finding, checkpoint, now);
      const current = this.incidents.find((incident) => incident.id === id);
      if (!current) {
        this.incidents.push(next);
        durable = true;
        continue;
      }
      const updated: IdentityIncident = {
        ...next,
        firstSeenAt: current.firstSeenAt,
        seenCount: current.seenCount + 1,
      };
      this.incidents = this.incidents.map((incident) => incident.id === id ? updated : incident);
      if (signature(current) !== signature(updated)) durable = true;
    }
    for (const incident of this.incidents) {
      if (incident.worldId !== report.worldId || !incident.confirmed || seen.has(incident.id)) continue;
      const resolved: IdentityIncident = {
        ...incident,
        confirmed: false,
        resolvedAt: incident.resolvedAt ?? now,
        lastSeenAt: now,
        checkpoint,
      };
      this.incidents = this.incidents.map((row) => row.id === incident.id ? resolved : row);
      durable = true;
    }
    const before = this.incidents.length;
    this.incidents = trim(this.incidents);
    if (this.incidents.length !== before) durable = true;
    return durable;
  }
}

function incidentFromFinding(
  id: string,
  worldId: string,
  finding: IdentityFinding,
  checkpoint: IdentityCheckpoint,
  now: number,
): IdentityIncident {
  const playerIds = [...new Set(finding.locations.map((location) => location.playerId).filter((value): value is string => !!value))].sort();
  const listingIds = [...new Set(finding.locations.map((location) => location.listingId).filter((value): value is string => !!value))].sort();
  const tradeIds = [...new Set(finding.locations.map((location) => location.tradeId).filter((value): value is string => !!value))].sort();
  return {
    id,
    worldId,
    itemInstanceId: finding.itemInstanceId,
    itemIds: finding.itemIds,
    category: finding.status,
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    locations: finding.locations,
    playerIds,
    listingIds,
    tradeIds,
    checkpoint,
    confirmed: finding.status !== 'transitional',
  };
}

function incidentId(worldId: string, instanceId: string): string {
  return `identity:${worldId}:${instanceId}`;
}

function signature(incident: IdentityIncident): string {
  return [
    incident.category,
    incident.confirmed ? '1' : '0',
    incident.itemIds.join(','),
    incident.locations.map(locationKey).join(';'),
  ].join('#');
}

function trim(incidents: IdentityIncident[]): IdentityIncident[] {
  if (incidents.length <= IDENTITY_INCIDENT_LIMIT) return incidents;
  const resolved = incidents.filter((incident) => !incident.confirmed)
    .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  const drop = new Set<string>();
  for (const incident of resolved) {
    if (incidents.length - drop.size <= IDENTITY_INCIDENT_LIMIT) break;
    drop.add(incident.id);
  }
  const kept = incidents.filter((incident) => !drop.has(incident.id));
  if (kept.length <= IDENTITY_INCIDENT_LIMIT) return kept;
  return [...kept].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, IDENTITY_INCIDENT_LIMIT);
}

function isIncident(value: unknown): value is IdentityIncident {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<IdentityIncident>;
  return typeof row.id === 'string'
    && typeof row.worldId === 'string'
    && typeof row.itemInstanceId === 'string'
    && typeof row.confirmed === 'boolean'
    && Array.isArray(row.locations);
}
