import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAN_CREATE_COST } from '../../shared/clans';
import { PostgresDatabase } from '../../server/db/database';
import { economyRequestScope, GLOBAL_REQUEST_SCOPE, IdempotencyService } from '../../server/db/idempotency';
import { MIGRATIONS, migrationChecksum } from '../../server/db/migrationManifest';
import { runMigrations } from '../../server/db/migrations';
import type { Queryable } from '../../server/db/types';
import { PostgresGameplayEconomy } from '../../server/economy/postgresAuthority';
import { MegacoinService } from '../../server/economy/service';
import { ClanService } from '../../server/services/clan';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { KillStatistics } from '../../server/services/killStats';

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

describe.skipIf(databaseUrl === '')('idempotency request scope', () => {
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

  function open(searchPath: string): PostgresDatabase {
    const database = new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'test',
      poolMax: 2,
      searchPath,
    });
    opened.push(database);
    return database;
  }

  function economy(database: PostgresDatabase, mode: 'anarchy' | 'survival' | 'peaceful') {
    const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'fc-scope-')));
    const megacoin = new MegacoinService(database, 'test', mode);
    const money = new PostgresGameplayEconomy(
      megacoin,
      new IdempotencyService(database, 'test', economyRequestScope(mode)),
      new EconomyService(store),
      new KillStatistics(store),
    );
    return { store, megacoin, money };
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

  it('treats the same request UUID as independent in anarchy and survival', async () => {
    const database = open(await makeSchema());
    await database.start();
    expect(database.appliedMigrations).toContain('0005');
    const playerId = 'PLAYER-A';
    const anarchy = economy(database, 'anarchy');
    const survival = economy(database, 'survival');
    await anarchy.money.preparePlayer(playerId, 'Ada');
    await survival.money.preparePlayer(playerId, 'Ada');
    const requestId = randomUUID();
    const request = {
      requestId,
      operation: 'economy.admin_give',
      actorId: playerId,
      payload: { playerId, amount: 10 },
    };
    const paidAnarchy = await anarchy.money.deposit(playerId, 10, 'ADMIN_GIVE', undefined, undefined, request);
    const paidSurvival = await survival.money.deposit(playerId, 10, 'ADMIN_GIVE', undefined, undefined, request);
    expect(paidAnarchy.ok).toBe(true);
    expect(paidSurvival.ok).toBe(true);
    expect((await anarchy.megacoin.getAccount(playerId))?.balance).toBe(110);
    expect((await survival.megacoin.getAccount(playerId))?.balance).toBe(110);
    expect(anarchy.money.getBalance(playerId)).toBe(110);
    expect(survival.money.getBalance(playerId)).toBe(110);
    const replayAnarchy = await anarchy.money.deposit(playerId, 10, 'ADMIN_GIVE', undefined, undefined, request);
    const replaySurvival = await survival.money.deposit(playerId, 10, 'ADMIN_GIVE', undefined, undefined, request);
    expect(replayAnarchy.ok).toBe(true);
    expect(replaySurvival.ok).toBe(true);
    expect((await anarchy.megacoin.getAccount(playerId))?.balance).toBe(110);
    expect((await survival.megacoin.getAccount(playerId))?.balance).toBe(110);
    expect(anarchy.money.getBalance(playerId)).toBe(110);
    expect(survival.money.getBalance(playerId)).toBe(110);

    const global = new IdempotencyService(database, 'test', GLOBAL_REQUEST_SCOPE);
    const adminRequest = {
      deploymentId: 'test',
      requestId,
      operation: 'economy.admin_give',
      actorId: playerId,
      payload: { playerId, amount: 10 },
    };
    const adminRun = await global.execute(adminRequest, async () => ({ side: 'global' }));
    expect(adminRun).toEqual({ side: 'global' });
    const economyReplay = await anarchy.money.deposit(playerId, 10, 'ADMIN_GIVE', undefined, undefined, request);
    expect(economyReplay.ok).toBe(true);
    expect((await anarchy.megacoin.getAccount(playerId))?.balance).toBe(110);
    await expect(global.execute({
      ...adminRequest,
      payload: { playerId, amount: 11 },
    }, async () => ({ side: 'other' }))).rejects.toMatchObject({ mismatch: 'payload' });
  }, 30_000);

  it('does not create a survival clan from an anarchy request replay', async () => {
    const database = open(await makeSchema());
    await database.start();
    const playerId = 'PLAYER-A';
    const anarchy = economy(database, 'anarchy');
    const survival = economy(database, 'survival');
    await anarchy.money.preparePlayer(playerId, 'Ada');
    await survival.money.preparePlayer(playerId, 'Ada');
    await anarchy.money.deposit(playerId, 20_000, 'ADMIN_GIVE');
    await survival.money.deposit(playerId, 20_000, 'ADMIN_GIVE');
    const request = {
      requestId: randomUUID(),
      operation: 'economy.clan_create',
      actorId: playerId,
      payload: { name: 'North', icon: 'crown' },
    };
    const anarchyClans = new ClanService(anarchy.store, anarchy.money);
    const survivalClans = new ClanService(survival.store, survival.money);
    const createdAnarchy = await anarchyClans.createClan(playerId, 'North', 'crown', request);
    expect(createdAnarchy.ok).toBe(true);
    expect((await anarchy.megacoin.getAccount(playerId))?.balance).toBe(100 + 20_000 - CLAN_CREATE_COST);
    const createdSurvival = await survivalClans.createClan(playerId, 'North', 'crown', request);
    expect(createdSurvival.ok).toBe(true);
    expect(survivalClans.playerClan(playerId)?.name).toBe('North');
    const survivalAfterFee = 100 + 20_000 - CLAN_CREATE_COST;
    expect((await survival.megacoin.getAccount(playerId))?.balance).toBe(survivalAfterFee);
    expect(survival.money.getBalance(playerId)).toBe(survivalAfterFee);
    await survival.money.deposit(playerId, 25, 'ADMIN_GIVE');
    const replay = await survival.money.withdraw(playerId, CLAN_CREATE_COST, 'CLAN_CREATE', undefined, request);
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect((await survival.megacoin.getAccount(playerId))?.balance).toBe(survivalAfterFee + 25);
    expect(survival.money.getBalance(playerId)).toBe(survivalAfterFee + 25);
  }, 30_000);

  it('keeps a committed transfer success without a later account read and does not rewind cache', async () => {
    const database = open(await makeSchema());
    await database.start();
    const anarchy = economy(database, 'anarchy');
    const payer = randomUUID();
    const payee = randomUUID();
    await anarchy.money.preparePlayer(payer, 'Payer');
    await anarchy.money.preparePlayer(payee, 'Payee');
    await anarchy.money.deposit(payer, 400, 'ADMIN_GIVE');
    expect(anarchy.money.getBalance(payer)).toBe(500);
    expect(anarchy.money.getBalance(payee)).toBe(100);
    const requestX = {
      requestId: randomUUID(),
      operation: 'economy.player_transfer',
      actorId: payer,
      payload: { to: payee, amount: 100 },
    };
    const requestY = {
      requestId: randomUUID(),
      operation: 'economy.player_transfer',
      actorId: payer,
      payload: { to: payee, amount: 50 },
    };
    let accountReads = 0;
    anarchy.megacoin.getAccount = async () => {
      accountReads += 1;
      throw new Error('post-commit read failed');
    };
    const first = await anarchy.money.transfer(payer, payee, 100, 'PLAYER_TRANSFER', requestX);
    expect(first.ok).toBe(true);
    expect(first.error).toBeUndefined();
    expect(accountReads).toBe(0);
    expect(anarchy.money.getBalance(payer)).toBe(400);
    expect(anarchy.money.getBalance(payee)).toBe(200);
    const second = await anarchy.money.transfer(payer, payee, 50, 'PLAYER_TRANSFER', requestY);
    expect(second.ok).toBe(true);
    expect(accountReads).toBe(0);
    expect(anarchy.money.getBalance(payer)).toBe(350);
    expect(anarchy.money.getBalance(payee)).toBe(250);
    const replay = await anarchy.money.transfer(payer, payee, 100, 'PLAYER_TRANSFER', requestX);
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(accountReads).toBe(0);
    expect(anarchy.money.getBalance(payer)).toBe(350);
    expect(anarchy.money.getBalance(payee)).toBe(250);
    const balances = await database.query<{ player_id: string; balance: string }>(
      `SELECT player_id, balance::text AS balance
       FROM economy_accounts
       WHERE deployment_id = 'test' AND economy_scope = 'anarchy' AND player_id = ANY($1::text[])
       ORDER BY player_id`,
      [[payer, payee]],
    );
    const byId = new Map(balances.rows.map((row) => [row.player_id, Number(row.balance)]));
    expect(byId.get(payer)).toBe(350);
    expect(byId.get(payee)).toBe(250);
    const legs = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger
       WHERE deployment_id = 'test' AND economy_scope = 'anarchy' AND reason = 'PLAYER_TRANSFER'`,
    );
    expect(legs.rows[0]?.n).toBe('4');

    await database.close();
    const before = anarchy.money.getBalance(payer);
    const failed = await anarchy.money.transfer(payer, payee, 10, 'PLAYER_TRANSFER', {
      requestId: randomUUID(),
      operation: 'economy.player_transfer',
      actorId: payer,
      payload: { to: payee, amount: 10 },
    });
    expect(failed.ok).toBe(false);
    expect(anarchy.money.getBalance(payer)).toBe(before);
    expect(anarchy.money.getBalance(payee)).toBe(250);
  }, 30_000);

  it('upgrades a 0004 idempotency row to global without changing its response', async () => {
    const schema = await makeSchema();
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const requestId = randomUUID();
    const hash = 'ab'.repeat(32);
    try {
      await client.query(`SET search_path TO ${quoteIdent(schema)}`);
      const queryable: Queryable = {
        query: async (sql, params) => {
          const result = await client.query(sql, params ? [...params] : undefined);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
      };
      const through0004 = MIGRATIONS.filter((migration) => migration.version <= '0004');
      const first = await runMigrations(queryable, through0004);
      expect(first.applied).toEqual(['0001', '0002', '0003', '0004']);
      const checksums = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      await client.query(
        `INSERT INTO idempotency_requests (
           deployment_id, request_id, operation, actor_id, payload_hash, state, response, committed_at
         ) VALUES ('test', $1::uuid, 'grant', 'admin-1', $2, 'committed', '{"ok":true}'::jsonb, NOW())`,
        [requestId, hash],
      );
      const second = await runMigrations(queryable, MIGRATIONS);
      expect(second.applied).toEqual(['0005', '0006']);
      const after = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      expect(after.rows.map((row) => row.version)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006']);
      expect(after.rows.filter((row) => row.version <= '0004').map((row) => row.checksum)).toEqual(
        checksums.rows.map((row) => row.checksum),
      );
      expect(checksums.rows.map((row) => row.checksum)).toEqual(through0004.map((migration) => migrationChecksum(migration)));
      const row = await client.query<{ request_scope: string; response: { ok: boolean } }>(
        'SELECT request_scope, response FROM idempotency_requests WHERE request_id = $1::uuid',
        [requestId],
      );
      expect(row.rows).toEqual([{ request_scope: 'global', response: { ok: true } }]);
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 30_000);
});
