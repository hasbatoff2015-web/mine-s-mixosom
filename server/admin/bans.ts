import { canonicalPlayerId, isPlayerId } from '../services/permissionSubject';

export interface AdminBanRecord {
  readonly playerId: string;
  readonly reason: string;
  readonly adminId: string;
  readonly at: number;
}

interface BanFile {
  readonly version: 1;
  readonly bans: AdminBanRecord[];
}

/**
 * Active bans for this world process, keyed by canonical playerId.
 * A new session token creates a new player id, so this is not an account ban.
 * Nicknames are not keys. Every valid active row is kept.
 */
export class AdminBanList {
  private bans = new Map<string, AdminBanRecord>();

  load(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const rows = (raw as { bans?: unknown }).bans;
    if (!Array.isArray(rows)) return;
    const next = new Map<string, AdminBanRecord>();
    for (const row of rows) {
      const record = normalizeBan(row);
      if (!record) continue;
      next.set(record.playerId, record);
    }
    this.bans = next;
  }

  serialize(): BanFile {
    return { version: 1, bans: [...this.bans.values()] };
  }

  has(playerId: string): boolean {
    const id = canonicalKey(playerId);
    return id !== undefined && this.bans.has(id);
  }

  get(playerId: string): AdminBanRecord | undefined {
    const id = canonicalKey(playerId);
    return id === undefined ? undefined : this.bans.get(id);
  }

  list(): readonly AdminBanRecord[] {
    return [...this.bans.values()];
  }

  get size(): number {
    return this.bans.size;
  }

  add(record: AdminBanRecord): void {
    const normalized = normalizeBan(record);
    if (!normalized) return;
    this.bans.set(normalized.playerId, normalized);
  }

  remove(playerId: string): boolean {
    const id = canonicalKey(playerId);
    if (id === undefined) return false;
    return this.bans.delete(id);
  }
}

function canonicalKey(playerId: string): string | undefined {
  if (!isPlayerId(playerId)) return undefined;
  return canonicalPlayerId(playerId);
}

function normalizeBan(value: unknown): AdminBanRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<AdminBanRecord>;
  if (typeof row.playerId !== 'string' || !isPlayerId(row.playerId)) return undefined;
  if (typeof row.reason !== 'string' || typeof row.adminId !== 'string' || typeof row.at !== 'number') return undefined;
  return {
    playerId: canonicalPlayerId(row.playerId),
    reason: row.reason,
    adminId: row.adminId,
    at: row.at,
  };
}
