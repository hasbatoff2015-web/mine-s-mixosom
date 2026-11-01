import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DisabledDatabase } from '../../server/db/database';
import type { Database, Queryable } from '../../server/db/types';
import {
  bindVerifiedProviderIdentity,
  lookupPlayerLinks,
  lookupVerifiedProviderIdentity,
  type IdentityScope,
  type VerifiedProviderIdentity,
} from '../../server/identity/providerLinks';
import {
  INSERT_PROVIDER_LINK_SQL,
  SELECT_LINK_CONFLICT_SQL,
  SELECT_PLAYER_LINKS_SQL,
  SELECT_PROVIDER_LINK_SQL,
} from '../../server/identity/providerLinksRepository';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEV_ANARCHY: IdentityScope = { deploymentId: 'dev', serverMode: 'anarchy', worldId: 'world-a' };
const yandex = (providerUserId: string): VerifiedProviderIdentity => ({
  verified: true,
  provider: 'yandex',
  providerUserId,
});

interface Row {
  deploymentId: string;
  serverMode: string;
  worldId: string;
  providerUserId: string;
  playerId: string;
}

class UniqueViolation extends Error {
  readonly code = '23505';
  constructor(readonly constraint: string) {
    super(constraint);
    this.name = 'UniqueViolation';
  }
}

class MemoryLinks implements Database {
  readonly enabled = true;
  readonly deploymentId = 'dev';
  readonly appliedMigrations: readonly string[] = [];
  rows: Row[] = [];
  failInsert = false;
  private chain: Promise<void> = Promise.resolve();

  async start(): Promise<void> {}

  async close(): Promise<void> {}

  async query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    return readRows(this.rows, sql, params) as { rows: T[]; rowCount: number };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.chain;
    this.chain = gate;
    await previous;
    const snapshot = this.rows.map((row) => ({ ...row }));
    const tx = new MemoryTx(snapshot, () => this.failInsert);
    try {
      const result = await fn(tx);
      this.rows = tx.rows;
      return result;
    } catch (error) {
      this.rows = snapshot;
      throw error;
    } finally {
      release();
    }
  }
}

class MemoryTx implements Queryable {
  constructor(readonly rows: Row[], private readonly fail: () => boolean) {}

  async query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    if (sql === 'SAVEPOINT provider_link_insert' || sql === 'RELEASE SAVEPOINT provider_link_insert' || sql === 'ROLLBACK TO SAVEPOINT provider_link_insert') {
      return { rows: [] as T[], rowCount: 0 };
    }
    if (sql === INSERT_PROVIDER_LINK_SQL) {
      if (this.fail()) throw new Error('insert failed');
      const row = rowFrom(params);
      if (this.rows.some((item) => sameProvider(item, row))) throw new UniqueViolation('player_identity_links_provider_user');
      if (this.rows.some((item) => samePlayer(item, row))) throw new UniqueViolation('player_identity_links_player_provider');
      this.rows.push(row);
      return { rows: [] as T[], rowCount: 1 };
    }
    return readRows(this.rows, sql, params) as { rows: T[]; rowCount: number };
  }
}

function rowFrom(params: readonly unknown[] | undefined): Row {
  return {
    deploymentId: String(params?.[0]),
    serverMode: String(params?.[1]),
    worldId: String(params?.[2]),
    providerUserId: String(params?.[3]),
    playerId: String(params?.[4]),
  };
}

function sameProvider(left: Row, right: Row): boolean {
  return left.deploymentId === right.deploymentId
    && left.serverMode === right.serverMode
    && left.worldId === right.worldId
    && left.providerUserId === right.providerUserId;
}

function samePlayer(left: Row, right: Row): boolean {
  return left.deploymentId === right.deploymentId
    && left.serverMode === right.serverMode
    && left.worldId === right.worldId
    && left.playerId === right.playerId;
}

function readRows(rows: readonly Row[], sql: string, params: readonly unknown[] | undefined): { rows: unknown[]; rowCount: number } {
  const scope = {
    deploymentId: String(params?.[0]),
    serverMode: String(params?.[1]),
    worldId: String(params?.[2]),
  };
  const inScope = rows.filter((row) => row.deploymentId === scope.deploymentId && row.serverMode === scope.serverMode && row.worldId === scope.worldId);
  if (sql === SELECT_PROVIDER_LINK_SQL) {
    const found = inScope.filter((row) => row.providerUserId === String(params?.[3]));
    return { rows: found.map((row) => ({ player_id: row.playerId })), rowCount: found.length };
  }
  if (sql === SELECT_PLAYER_LINKS_SQL) {
    const found = inScope.filter((row) => row.playerId === String(params?.[3]));
    return { rows: found.map((row) => ({ provider_user_id: row.providerUserId })), rowCount: found.length };
  }
  if (sql === SELECT_LINK_CONFLICT_SQL) {
    const providerUserId = String(params?.[3]);
    const playerId = String(params?.[4]);
    const found = inScope.filter((row) => row.providerUserId === providerUserId || row.playerId === playerId);
    return {
      rows: found.map((row) => ({ player_id: row.playerId, provider_user_id: row.providerUserId })),
      rowCount: found.length,
    };
  }
  throw new Error(`unexpected sql ${sql.slice(0, 40)}`);
}

const everyone = (): boolean => true;

describe('provider identity links', () => {
  it('LINK-1 creates a scoped link', async () => {
    const db = new MemoryLinks();
    const result = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    expect(result).toEqual({ status: 'linked' });
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'))).toEqual({ status: 'found', playerId: A });
    expect(db.rows).toHaveLength(1);
  });

  it('LINK-2 repeats the same link once', async () => {
    const db = new MemoryLinks();
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    const again = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    expect(again).toEqual({ status: 'already_linked' });
    expect(db.rows).toHaveLength(1);
  });

  it('LINK-3 refuses to move a provider account onto another uuid', async () => {
    const db = new MemoryLinks();
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    const conflict = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), B, everyone);
    expect(conflict).toEqual({ status: 'provider_conflict' });
    expect(db.rows).toEqual([expect.objectContaining({ providerUserId: 'Y1', playerId: A })]);
  });

  it('LINK-4 refuses to replace the provider account on a player', async () => {
    const db = new MemoryLinks();
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    const conflict = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y2'), A, everyone);
    expect(conflict).toEqual({ status: 'player_conflict' });
    expect(db.rows[0]?.providerUserId).toBe('Y1');
  });

  it('LINK-5 keeps one row when the same link is saved twice at once', async () => {
    const db = new MemoryLinks();
    const [left, right] = await Promise.all([
      bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone),
      bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone),
    ]);
    expect([left.status, right.status].sort()).toEqual(['already_linked', 'linked']);
    expect(db.rows).toHaveLength(1);
  });

  it('LINK-6 lets only one uuid bind a contested provider account', async () => {
    const db = new MemoryLinks();
    const [left, right] = await Promise.all([
      bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone),
      bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), B, everyone),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual(['linked', 'provider_conflict']);
    expect(db.rows).toHaveLength(1);
  });

  it('LINK-7 rejects a prod scope on a dev database', async () => {
    const db = new MemoryLinks();
    const prod = { ...DEV_ANARCHY, deploymentId: 'prod' };
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    const rejected = await bindVerifiedProviderIdentity(db, prod, yandex('Y1'), B, everyone);
    expect(rejected).toEqual({ status: 'identity_scope_mismatch' });
    expect(await lookupVerifiedProviderIdentity(db, prod, yandex('Y1'))).toEqual({ status: 'identity_scope_mismatch' });
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'))).toEqual({ status: 'found', playerId: A });
    expect(db.rows).toHaveLength(1);
  });

  it('LINK-8 keeps anarchy and survival apart', async () => {
    const db = new MemoryLinks();
    const survival = { ...DEV_ANARCHY, serverMode: 'survival' };
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    await bindVerifiedProviderIdentity(db, survival, yandex('Y1'), B, everyone);
    expect(await lookupVerifiedProviderIdentity(db, survival, yandex('Y1'))).toEqual({ status: 'found', playerId: B });
    expect((await lookupPlayerLinks(db, DEV_ANARCHY, A)).status).toBe('found');
    expect((await lookupPlayerLinks(db, survival, A)).status).toBe('absent');
  });

  it('LINK-9 keeps two worlds apart', async () => {
    const db = new MemoryLinks();
    const other = { ...DEV_ANARCHY, worldId: 'world-b' };
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    await bindVerifiedProviderIdentity(db, other, yandex('Y1'), B, everyone);
    expect(await lookupVerifiedProviderIdentity(db, other, yandex('Y1'))).toEqual({ status: 'found', playerId: B });
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'))).toEqual({ status: 'found', playerId: A });
  });

  it('LINK-10 does not treat a shared nickname as one player', async () => {
    const db = new MemoryLinks();
    const named = new Map([[A, 'Steve'], [B, 'Steve']]);
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, () => true);
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y2'), B, () => true);
    expect(named.get(A)).toBe(named.get(B));
    expect(db.rows.map((row) => row.playerId).sort()).toEqual([A, B]);
  });

  it('LINK-11 rejects an invalid player id without writing', async () => {
    const db = new MemoryLinks();
    let seen = 0;
    const result = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), 'steve', () => {
      seen += 1;
      return true;
    });
    expect(result).toEqual({ status: 'invalid_player' });
    expect(seen).toBe(0);
    expect(db.rows).toHaveLength(0);
  });

  it('LINK-12 rejects an unverified client claim and has no socket entry', async () => {
    const db = new MemoryLinks();
    const claim = { provider: 'yandex', providerUserId: 'Y1', playerId: B };
    const result = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, claim, A, everyone);
    expect(result).toEqual({ status: 'unverified' });
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, claim)).toEqual({ status: 'unverified' });
    expect(db.rows).toHaveLength(0);
    const server = readFileSync(resolve('server/AnarchyServer.ts'), 'utf8');
    const protocol = readFileSync(resolve('shared/protocol.ts'), 'utf8');
    expect(server).not.toContain('bindVerifiedProviderIdentity');
    expect(server).not.toContain('player_identity_links');
    expect(protocol).not.toContain('providerUserId');
  });

  it('LINK-13 does not rewrite the player record it points at', async () => {
    const db = new MemoryLinks();
    const player = { id: A, inventory: ['diamond'], op: true, balance: 40 };
    const before = structuredClone(player);
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, (id) => id === player.id);
    expect(player).toEqual(before);
    expect(db.rows[0]?.playerId).toBe(A);
  });

  it('LINK-14 reports unavailable when PostgreSQL is disabled', async () => {
    const db = new DisabledDatabase();
    await db.start();
    const result = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    expect(result).toEqual({ status: 'unavailable' });
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'))).toEqual({ status: 'unavailable' });
  });

  it('LINK-15 is visible to a later lookup on the same store', async () => {
    const db = new MemoryLinks();
    await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone);
    expect(await lookupVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'))).toEqual({ status: 'found', playerId: A });
  });

  it('LINK-16 rolls back when the insert fails', async () => {
    const db = new MemoryLinks();
    db.failInsert = true;
    await expect(bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, everyone)).rejects.toThrow(/insert failed/);
    expect(db.rows).toHaveLength(0);
  });

  it('rejects a player id that is not in this world', async () => {
    const db = new MemoryLinks();
    const result = await bindVerifiedProviderIdentity(db, DEV_ANARCHY, yandex('Y1'), A, () => false);
    expect(result).toEqual({ status: 'unknown_player' });
    expect(db.rows).toHaveLength(0);
  });
});
