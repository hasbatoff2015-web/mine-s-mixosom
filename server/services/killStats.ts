import type { JsonFileStore } from './jsonStore';

interface KillFile {
  players: Array<{ playerId: string; kills: number }>;
  deaths: string[];
}

/**
 * PvP kill counts. Not currency. PostgreSQL mode stores them here so
 * `economy/balances.json` is not rewritten when a kill is recorded.
 */
export class KillStatistics {
  private readonly kills = new Map<string, number>();
  private readonly deaths = new Set<string>();
  private dirty = false;

  constructor(private readonly store: JsonFileStore) {
    this.load();
  }

  load(): void {
    const file = this.store.load<KillFile>('economy/kills', { players: [], deaths: [] });
    this.kills.clear();
    this.deaths.clear();
    for (const entry of Array.isArray(file.players) ? file.players : []) {
      if (!entry || typeof entry.playerId !== 'string') continue;
      if (!Number.isInteger(entry.kills) || entry.kills < 0) continue;
      this.kills.set(entry.playerId, entry.kills);
    }
    for (const death of Array.isArray(file.deaths) ? file.deaths : []) {
      if (typeof death === 'string' && death.length > 0) this.deaths.add(death);
    }
    this.dirty = false;
  }

  get(playerId: string): number {
    return this.kills.get(playerId) ?? 0;
  }

  record(killerId: string, victimId: string, deathId: string): { ok: boolean; kills: number; error?: string } {
    if (!killerId || killerId === victimId) return { ok: false, kills: this.get(killerId), error: 'self' };
    const key = deathId || `missing:${killerId}:${victimId}`;
    if (this.deaths.has(key)) return { ok: false, kills: this.get(killerId), error: 'duplicate' };
    this.deaths.add(key);
    if (this.deaths.size > 8_000) {
      const keep = [...this.deaths].slice(-4_000);
      this.deaths.clear();
      for (const id of keep) this.deaths.add(id);
    }
    const next = this.get(killerId) + 1;
    this.kills.set(killerId, next);
    this.dirty = true;
    this.persist();
    return { ok: true, kills: next };
  }

  persist(): void {
    if (!this.dirty) return;
    this.store.save('economy/kills', {
      players: [...this.kills.entries()].map(([playerId, kills]) => ({ playerId, kills })),
      deaths: [...this.deaths],
    });
    this.dirty = false;
  }
}
