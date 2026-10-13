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
 * UUID bans for this world process. A new session token creates a new
 * player id, so this is not an account ban. Nicknames are not keys.
 */
export class AdminBanList {
  private bans: AdminBanRecord[] = [];

  load(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const rows = (raw as { bans?: unknown }).bans;
    if (!Array.isArray(rows)) return;
    this.bans = rows.filter(isBan).slice(-500);
  }

  serialize(): BanFile {
    return { version: 1, bans: this.bans };
  }

  has(playerId: string): boolean {
    return this.bans.some((ban) => ban.playerId === playerId);
  }

  list(): readonly AdminBanRecord[] {
    return this.bans;
  }

  add(record: AdminBanRecord): void {
    this.bans = this.bans.filter((ban) => ban.playerId !== record.playerId).concat(record);
  }

  remove(playerId: string): boolean {
    const next = this.bans.filter((ban) => ban.playerId !== playerId);
    const removed = next.length !== this.bans.length;
    this.bans = next;
    return removed;
  }
}

function isBan(value: unknown): value is AdminBanRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AdminBanRecord>;
  return typeof row.playerId === 'string'
    && row.playerId.length > 0
    && typeof row.reason === 'string'
    && typeof row.adminId === 'string'
    && typeof row.at === 'number';
}
