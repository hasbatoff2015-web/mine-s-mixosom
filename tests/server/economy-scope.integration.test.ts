import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import { MIGRATIONS, migrationChecksum } from '../../server/db/migrationManifest';
import { runMigrations } from '../../server/db/migrations';
import type { Queryable } from '../../server/db/types';
import { applyLegacyBalanceImport } from '../../server/economy/legacyImport';
import { MegacoinService } from '../../server/economy/service';
import { ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name)) throw new Error(`refusing database "${name}"`);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('gameplay economy scope', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;

  async function makeSchema(): Promise<string> {
    if (!admin) throw new Error('admin client missing');
    const name = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  function open(searchPath: string, deploymentId = 'test'): PostgresDatabase {
    const database = new PostgresDatabase({
      url: databaseUrl,
      deploymentId,
      poolMax: 2,
      searchPath,
    });
    opened.push(database);
    return database;
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
  }, 30_000);

  afterAll(async () => {
    for (const database of opened.splice(0)) await database.close().catch(() => undefined);
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
      admin = undefined;
    }
  }, 30_000);

  it('keeps anarchy, survival, and peaceful wallets independent', async () => {
    const schema = await makeSchema();
    const database = open(schema);
    await database.start();
    const playerId = 'PLAYER-A';
    const anarchy = new MegacoinService(database, 'test', 'anarchy');
    const survival = new MegacoinService(database, 'test', 'survival');
    const peaceful = new MegacoinService(database, 'test', 'peaceful');
    expect((await anarchy.ensureAccount({ playerId, displayName: 'Ada' })).balance).toBe(100);
    expect((await survival.ensureAccount({ playerId, displayName: 'Ada' })).balance).toBe(100);
    expect((await peaceful.ensureAccount({ playerId, displayName: 'Ada' })).balance).toBe(100);
    await anarchy.credit({ playerId, amount: 50, reason: 'BLOCK_BREAK', source: { type: 'BLOCK_BREAK', id: randomUUID() } });
    expect((await anarchy.getAccount(playerId))?.balance).toBe(150);
    expect((await survival.getAccount(playerId))?.balance).toBe(100);
    expect((await peaceful.getAccount(playerId))?.balance).toBe(100);
    await survival.credit({ playerId, amount: 25, reason: 'BLOCK_BREAK', source: { type: 'BLOCK_BREAK', id: randomUUID() } });
    expect((await anarchy.getAccount(playerId))?.balance).toBe(150);
    expect((await survival.getAccount(playerId))?.balance).toBe(125);
    expect((await peaceful.getAccount(playerId))?.balance).toBe(100);
    const source = randomUUID();
    await anarchy.credit({ playerId, amount: 1, reason: 'MOB_KILL', source: { type: 'MOB_KILL', id: source } });
    await survival.credit({ playerId, amount: 1, reason: 'MOB_KILL', source: { type: 'MOB_KILL', id: source } });
    const replay = await anarchy.credit({ playerId, amount: 1, reason: 'MOB_KILL', source: { type: 'MOB_KILL', id: source } });
    expect(replay.replayed).toBe(true);
    expect((await anarchy.getAccount(playerId))?.balance).toBe(151);
    expect((await survival.getAccount(playerId))?.balance).toBe(126);
    await anarchy.ensureAccount({ playerId, displayName: 'AnarchyAda' });
    expect((await survival.getAccount(playerId))?.displayName).toBe('Ada');
    expect((await anarchy.history({ playerId, limit: 20 })).entries.every((entry) => entry.playerId === playerId)).toBe(true);
    expect((await anarchy.listTop(10)).some((row) => row.playerId === playerId && row.balance === 151)).toBe(true);
    expect((await survival.listTop(10)).some((row) => row.playerId === playerId && row.balance === 126)).toBe(true);
    expect((await peaceful.listTop(10)).some((row) => row.playerId === playerId && row.balance === 100)).toBe(true);
    expect((await anarchy.reconcile(playerId)).matches).toBe(true);
    expect((await survival.reconcile(playerId)).matches).toBe(true);
    expect((await peaceful.reconcile(playerId)).matches).toBe(true);
    const rows = await database.query<{ economy_scope: string }>(
      `SELECT DISTINCT economy_scope FROM economy_operations ORDER BY economy_scope`,
    );
    expect(rows.rows.map((row) => row.economy_scope)).toEqual(['anarchy', 'peaceful', 'survival']);
  }, 30_000);

  it('imports one scope and leaves the others empty', async () => {
    const schema = await makeSchema();
    const database = open(schema);
    await database.start();
    const playerId = randomUUID();
    const batch = randomUUID();
    const anarchy = new MegacoinService(database, 'test', 'anarchy');
    const survival = new MegacoinService(database, 'test', 'survival');
    const accounts = [{ playerId, displayName: 'Imp', balance: 500 }];
    await applyLegacyBalanceImport(anarchy, accounts, batch);
    await applyLegacyBalanceImport(anarchy, accounts, batch);
    expect((await anarchy.getAccount(playerId))?.balance).toBe(500);
    expect(await survival.getAccount(playerId)).toBeNull();
    await survival.ensureAccount({ playerId, displayName: 'Imp' });
    expect((await survival.getAccount(playerId))?.balance).toBe(ECONOMY_INITIAL_BALANCE);
  }, 30_000);

  it('upgrades a 0003 database into legacy_global without changing totals', async () => {
    const schema = await makeSchema();
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`SET search_path TO ${quoteIdent(schema)}`);
      const queryable: Queryable = {
        query: async (sql, params) => {
          const result = await client.query(sql, params ? [...params] : undefined);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
      };
      const historical = MIGRATIONS.filter((migration) => migration.version <= '0003');
      const first = await runMigrations(queryable, historical);
      expect(first.applied).toEqual(['0001', '0002', '0003']);
      const checksums = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      expect(checksums.rows.map((row) => row.checksum)).toEqual(historical.map((migration) => migrationChecksum(migration)));
      const playerId = 'legacy-player';
      const operationId = randomUUID();
      const entryId = randomUUID();
      await client.query(
        `INSERT INTO economy_accounts (deployment_id, player_id, balance, display_name)
         VALUES ('test', $1, 100, 'Legacy')`,
        [playerId],
      );
      await client.query(
        `INSERT INTO economy_operations (deployment_id, operation_id, kind, metadata)
         VALUES ('test', $1::uuid, 'INITIAL', '{}'::jsonb)`,
        [operationId],
      );
      await client.query(
        `INSERT INTO economy_ledger (
           entry_id, deployment_id, operation_id, leg_index, player_id,
           delta, balance_before, balance_after, reason
         ) VALUES ($1::uuid, 'test', $2::uuid, 0, $3, 100, 0, 100, 'INITIAL')`,
        [entryId, operationId, playerId],
      );
      const second = await runMigrations(queryable, MIGRATIONS);
      expect(second.applied).toEqual(['0004']);
      const after = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      expect(after.rows.map((row) => row.version)).toEqual(['0001', '0002', '0003', '0004']);
      expect(after.rows.filter((row) => row.version <= '0003').map((row) => row.checksum)).toEqual(
        checksums.rows.map((row) => row.checksum),
      );
      const account = await client.query<{ balance: string; economy_scope: string }>(
        'SELECT balance::text AS balance, economy_scope FROM economy_accounts WHERE player_id = $1',
        [playerId],
      );
      expect(account.rows).toEqual([{ balance: '100', economy_scope: 'legacy_global' }]);
      const ledger = await client.query<{ total: string; economy_scope: string }>(
        `SELECT COALESCE(SUM(delta), 0)::text AS total, economy_scope
         FROM economy_ledger WHERE player_id = $1 GROUP BY economy_scope`,
        [playerId],
      );
      expect(ledger.rows).toEqual([{ total: '100', economy_scope: 'legacy_global' }]);
      const operation = await client.query<{ economy_scope: string }>(
        'SELECT economy_scope FROM economy_operations WHERE operation_id = $1::uuid',
        [operationId],
      );
      expect(operation.rows[0]?.economy_scope).toBe('legacy_global');
      await expect(client.query(`UPDATE economy_ledger SET reason = 'MUTATED'`)).rejects.toThrow(/append-only/);
      await expect(client.query(`DELETE FROM economy_operations`)).rejects.toThrow(/append-only/);
    } finally {
      await client.end().catch(() => undefined);
    }
    const database = open(schema);
    await database.start();
    expect(database.appliedMigrations).toEqual([]);
    const anarchy = new MegacoinService(database, 'test', 'anarchy');
    expect(await anarchy.getAccount('legacy-player')).toBeNull();
    expect((await anarchy.ensureAccount({ playerId: 'legacy-player', displayName: 'Legacy' })).balance).toBe(100);
    const visible = await database.query<{ economy_scope: string; balance: string }>(
      `SELECT economy_scope, balance::text AS balance
       FROM economy_accounts WHERE player_id = 'legacy-player' ORDER BY economy_scope`,
    );
    expect(visible.rows).toEqual([
      { economy_scope: 'anarchy', balance: '100' },
      { economy_scope: 'legacy_global', balance: '100' },
    ]);
  }, 30_000);
});
