import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { PostgresDatabase } from '../../server/db/database';
import { loadServerConfig } from '../../server/config';
import { EconomyLimitError, EconomySourceConflictError } from '../../server/economy/errors';
import { moscowDateKey } from '../../server/economy/moscowCalendar';
import { MegacoinService } from '../../server/economy/service';
import { isPromise } from '../../server/economy/currencyPort';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE } from '../../server/services/economy';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { bindNamedOperatorFixture } from './helpers/operatorFixture';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FC_TEST_DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('FC_TEST_DATABASE_URL must use the postgres or postgresql scheme');
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name) || name === 'template0' || name === 'template1') {
    throw new Error(`refusing FC_TEST_DATABASE_URL database "${name || '(none)'}"`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function chatLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; text?: string; lines?: string[] };
    if (record.type === 'chat' && record.text) lines.push(record.text);
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
  }
  return lines;
}

describe.skipIf(databaseUrl === '')('postgres daily reward', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;
  let database!: PostgresDatabase;
  let dev!: MegacoinService;
  let schemaName = '';

  function open(searchPath: string, deploymentId: string): PostgresDatabase {
    const created = new PostgresDatabase({
      url: databaseUrl,
      deploymentId,
      poolMax: 4,
      searchPath,
    });
    opened.push(created);
    return created;
  }

  async function makeSchema(): Promise<string> {
    if (!admin) throw new Error('admin client missing');
    const name = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  async function rewardRows(service: MegacoinService, playerId: string, claimDate?: string): Promise<Array<{
    delta: string;
    balance: string;
    metadata: { claimDate?: string; streakDay?: number };
    sourceId: string;
  }>> {
    const source = claimDate ? `${playerId}:${claimDate}` : null;
    const rows = await database.query<{
      delta: string;
      balance: string;
      metadata: { claimDate?: string; streakDay?: number };
      source_id: string;
    }>(
      `SELECT l.delta::text AS delta, a.balance::text AS balance, o.metadata, o.source_id
       FROM economy_operations o
       JOIN economy_ledger l
         ON l.deployment_id = o.deployment_id
        AND l.economy_scope = o.economy_scope
        AND l.operation_id = o.operation_id
       JOIN economy_accounts a
         ON a.deployment_id = o.deployment_id
        AND a.economy_scope = o.economy_scope
        AND a.player_id = l.player_id
       WHERE o.deployment_id = $1
         AND o.economy_scope = $2
         AND o.source_type = 'DAILY_REWARD'
         AND l.player_id = $3
         AND ($4::text IS NULL OR o.source_id = $4)
       ORDER BY o.source_id`,
      [service.deploymentId, service.economyScope, playerId, source],
    );
    return rows.rows.map((row) => ({
      delta: row.delta,
      balance: row.balance,
      metadata: row.metadata,
      sourceId: row.source_id,
    }));
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    schemaName = await makeSchema();
    database = open(schemaName, 'dev');
    await database.start();
    dev = new MegacoinService(database, 'dev', 'anarchy');
  }, 30_000);

  afterAll(async () => {
    for (const openedDatabase of opened.splice(0)) {
      await openedDatabase.close().catch(() => undefined);
    }
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
      admin = undefined;
    }
  }, 30_000);

  async function claim(service: MegacoinService, playerId: string, claimDate: string, series: readonly number[]) {
    return service.claimDailyReward({ playerId, claimDate, series, displayName: 'Ada' });
  }

  it('pays the first join once and ignores repeats, including parallel calls', async () => {
    const playerId = randomUUID();
    const first = await claim(dev, playerId, '2026-11-10', [50, 75]);
    expect(first).toMatchObject({ outcome: 'claimed', amount: 50, streakDay: 1, balance: ECONOMY_INITIAL_BALANCE + 50 });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const again = await claim(dev, playerId, '2026-11-10', [999]);
      expect(again.outcome).toBe('already_claimed');
      expect(again.amount).toBe(50);
      expect(again.streakDay).toBe(1);
    }
    const other = randomUUID();
    const raced = await Promise.all(Array.from({ length: 12 }, () => claim(dev, other, '2026-11-10', [40])));
    expect(raced.filter((result) => result.outcome === 'claimed')).toHaveLength(1);
    expect(raced.every((result) => result.amount === 40)).toBe(true);
    expect(await dev.getBalance(other)).toBe(ECONOMY_INITIAL_BALANCE + 40);
    const rows = await rewardRows(dev, other, '2026-11-10');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: '40', balance: String(ECONOMY_INITIAL_BALANCE + 40) });
  }, 30_000);

  it('keeps one posted amount when concurrent claims disagree', async () => {
    const playerId = randomUUID();
    const [left, right] = await Promise.all([
      claim(dev, playerId, '2026-11-10', [111]),
      claim(dev, playerId, '2026-11-10', [222]),
    ]);
    const amount = left.outcome === 'claimed' ? left.amount : right.amount;
    expect(amount === 111 || amount === 222).toBe(true);
    expect(left.amount).toBe(amount);
    expect(right.amount).toBe(amount);
    const rows = await rewardRows(dev, playerId, '2026-11-10');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBe(String(amount));
    expect(await dev.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + Number(amount));
  }, 30_000);

  it('advances, resets, and caps a streak, and keeps a posted amount after the series changes', async () => {
    const playerId = randomUUID();
    const series = [50, 75, 100];
    const day1 = await claim(dev, playerId, '2026-11-01', series);
    const day2 = await claim(dev, playerId, '2026-11-02', [50, 123, 100]);
    const replay = await claim(dev, playerId, '2026-11-02', [50, 999, 100]);
    expect(day1).toMatchObject({ outcome: 'claimed', amount: 50, streakDay: 1 });
    expect(day2).toMatchObject({ outcome: 'claimed', amount: 123, streakDay: 2 });
    expect(replay).toMatchObject({ outcome: 'already_claimed', amount: 123, streakDay: 2 });
    expect((await rewardRows(dev, playerId)).map((row) => row.delta)).toEqual(['50', '123']);

    const skipped = randomUUID();
    await claim(dev, skipped, '2026-11-01', [50, 500]);
    const reset = await claim(dev, skipped, '2026-11-03', [50, 500]);
    expect(reset).toMatchObject({ outcome: 'claimed', amount: 50, streakDay: 1, streakRestarted: false });

    const capped = randomUUID();
    const paid: number[] = [];
    for (let day = 1; day <= 5; day += 1) {
      const result = await claim(dev, capped, `2026-11-${String(day).padStart(2, '0')}`, [10, 20]);
      expect(result.streakDay).toBe(day);
      paid.push(result.amount ?? 0);
    }
    expect(paid).toEqual([10, 20, 20, 20, 20]);
  }, 30_000);

  it('follows the Moscow civil calendar across midnight, months, years, and leap day', async () => {
    const before = moscowDateKey(new Date('2026-11-09T20:59:59.000Z'));
    const after = moscowDateKey(new Date('2026-11-09T21:00:00.000Z'));
    expect(before).toBe('2026-11-09');
    expect(after).toBe('2026-11-10');
    const playerId = randomUUID();
    const first = await claim(dev, playerId, before, [15, 25]);
    const second = await claim(dev, playerId, after, [15, 25]);
    expect(first.streakDay).toBe(1);
    expect(second).toMatchObject({ outcome: 'claimed', amount: 25, streakDay: 2 });

    const month = randomUUID();
    expect((await claim(dev, month, '2026-03-31', [5, 6])).streakDay).toBe(1);
    expect((await claim(dev, month, '2026-04-01', [5, 6])).streakDay).toBe(2);
    const year = randomUUID();
    expect((await claim(dev, year, '2025-12-31', [5, 6])).streakDay).toBe(1);
    expect((await claim(dev, year, '2026-01-01', [5, 6])).streakDay).toBe(2);
    const leap = randomUUID();
    expect((await claim(dev, leap, '2024-02-28', [5, 6, 7])).streakDay).toBe(1);
    expect((await claim(dev, leap, '2024-02-29', [5, 6, 7])).streakDay).toBe(2);
    expect((await claim(dev, leap, '2024-03-01', [5, 6, 7])).streakDay).toBe(3);
    const common = randomUUID();
    await claim(dev, common, '2026-02-28', [5, 9]);
    expect((await claim(dev, common, '2026-03-01', [5, 9])).streakDay).toBe(2);
  }, 30_000);

  it('isolates one player across modes and deployments and survives a new service', async () => {
    const playerId = randomUUID();
    const survival = new MegacoinService(database, 'dev', 'survival');
    const peaceful = new MegacoinService(database, 'dev', 'peaceful');
    await claim(dev, playerId, '2026-11-10', [50]);
    await claim(survival, playerId, '2026-11-10', [60]);
    await claim(peaceful, playerId, '2026-11-10', [70]);
    expect(await dev.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + 50);
    expect(await survival.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + 60);
    expect(await peaceful.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + 70);
    const scopes = await database.query<{ economy_scope: string; delta: string }>(
      `SELECT o.economy_scope, l.delta::text AS delta
       FROM economy_operations o
       JOIN economy_ledger l
         ON l.deployment_id = o.deployment_id
        AND l.economy_scope = o.economy_scope
        AND l.operation_id = o.operation_id
       WHERE o.deployment_id = 'dev' AND o.source_type = 'DAILY_REWARD' AND o.source_id = $1
       ORDER BY o.economy_scope`,
      [`${playerId}:2026-11-10`],
    );
    expect(scopes.rows).toEqual([
      { economy_scope: 'anarchy', delta: '50' },
      { economy_scope: 'peaceful', delta: '70' },
      { economy_scope: 'survival', delta: '60' },
    ]);

    const prodDatabase = open(schemaName, 'prod');
    await prodDatabase.start();
    const prod = new MegacoinService(prodDatabase, 'prod', 'anarchy');
    const prodPaid = await claim(prod, playerId, '2026-11-10', [80]);
    expect(prodPaid).toMatchObject({ outcome: 'claimed', amount: 80 });
    expect(await dev.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + 50);
    const devRows = await rewardRows(dev, playerId, '2026-11-10');
    expect(devRows).toHaveLength(1);
    expect(devRows[0]?.delta).toBe('50');

    const restarted = new MegacoinService(database, 'dev', 'anarchy');
    const again = await claim(restarted, playerId, '2026-11-10', [500]);
    expect(again.outcome).toBe('already_claimed');
    expect(again.amount).toBe(50);
    expect(await rewardRows(dev, playerId, '2026-11-10')).toHaveLength(1);
  }, 30_000);

  it('rolls the day back when the balance cap would be exceeded and allows the same day later', async () => {
    const playerId = randomUUID();
    await dev.ensureAccount({ playerId, displayName: 'Ada' });
    await dev.setBalance({ playerId, balance: ECONOMY_MAX_BALANCE, reason: 'ADMIN_SET' });
    await expect(claim(dev, playerId, '2026-11-10', [50])).rejects.toBeInstanceOf(EconomyLimitError);
    expect(await rewardRows(dev, playerId, '2026-11-10')).toEqual([]);
    expect(await dev.getBalance(playerId)).toBe(ECONOMY_MAX_BALANCE);
    await dev.setBalance({ playerId, balance: ECONOMY_MAX_BALANCE - 50, reason: 'ADMIN_SET' });
    const paid = await claim(dev, playerId, '2026-11-10', [50]);
    expect(paid).toMatchObject({ outcome: 'claimed', amount: 50, balance: ECONOMY_MAX_BALANCE });
    expect(await rewardRows(dev, playerId, '2026-11-10')).toHaveLength(1);
  }, 30_000);

  it('restarts at day 1 when yesterday metadata is damaged and does not repay a damaged today', async () => {
    const playerId = randomUUID();
    await dev.ensureAccount({ playerId, displayName: 'Ada' });
    await database.query(
      `INSERT INTO economy_operations (
         deployment_id, economy_scope, operation_id, kind, source_type, source_id, metadata
       ) VALUES ('dev', 'anarchy', $1::uuid, 'SOURCE', 'DAILY_REWARD', $2, '{}'::jsonb)`,
      [randomUUID(), `${playerId}:2026-11-09`],
    );
    const restarted = await claim(dev, playerId, '2026-11-10', [50, 400]);
    expect(restarted).toMatchObject({ outcome: 'claimed', amount: 50, streakDay: 1, streakRestarted: true });

    const today = randomUUID();
    await dev.ensureAccount({ playerId: today, displayName: 'Bea' });
    const before = await dev.getBalance(today);
    await database.query(
      `INSERT INTO economy_operations (
         deployment_id, economy_scope, operation_id, kind, source_type, source_id, metadata
       ) VALUES ('dev', 'anarchy', $1::uuid, 'SOURCE', 'DAILY_REWARD', $2, '{}'::jsonb)`,
      [randomUUID(), `${today}:2026-11-10`],
    );
    const blocked = await claim(dev, today, '2026-11-10', [80]);
    expect(blocked.outcome).toBe('already_claimed');
    expect(blocked.amount).toBeNull();
    expect(await dev.getBalance(today)).toBe(before);
    const legs = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger l
       JOIN economy_operations o
         ON o.deployment_id = l.deployment_id
        AND o.economy_scope = l.economy_scope
        AND o.operation_id = l.operation_id
       WHERE o.source_id = $1 AND o.source_type = 'DAILY_REWARD'`,
      [`${today}:2026-11-10`],
    );
    expect(legs.rows[0]?.n).toBe('0');
  }, 30_000);

  it('still rejects a conflicting ordinary source when the amount differs', async () => {
    const playerId = randomUUID();
    await dev.ensureAccount({ playerId, displayName: 'Ada' });
    await dev.credit({
      playerId,
      amount: 10,
      reason: 'ADMIN_GIVE',
      source: { type: 'ADMIN_GIVE', id: `once-${playerId}` },
    });
    await expect(dev.credit({
      playerId,
      amount: 11,
      reason: 'ADMIN_GIVE',
      source: { type: 'ADMIN_GIVE', id: `once-${playerId}` },
    })).rejects.toBeInstanceOf(EconomySourceConflictError);
    expect(await dev.getBalance(playerId)).toBe(ECONOMY_INITIAL_BALANCE + 10);
  }, 30_000);

  it('does not fall back when the database is closed', async () => {
    const schema = await makeSchema();
    const closed = open(schema, 'dev');
    await closed.start();
    const economy = new MegacoinService(closed, 'dev', 'anarchy');
    const playerId = randomUUID();
    await economy.ensureAccount({ playerId, displayName: 'Ada' });
    await closed.close();
    await expect(claim(economy, playerId, '2026-11-10', [50])).rejects.toThrow();
    const reopened = open(schema, 'dev');
    await reopened.start();
    const rows = await reopened.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_operations
       WHERE deployment_id = 'dev' AND source_type = 'DAILY_REWARD' AND source_id = $1`,
      [`${playerId}:2026-11-10`],
    );
    expect(rows.rows[0]?.n).toBe('0');
  }, 30_000);

  it('pays on player join through WorldInstance and not again after reconnect or restart', async () => {
    const schema = await makeSchema();
    const dir = await mkdtemp(join(tmpdir(), 'fc-daily-world-'));
    const config = {
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'anarchy',
        SERVER_MODE: 'anarchy',
        WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_DATABASE_URL: databaseUrl,
        FC_DEPLOYMENT_ID: 'test',
        FC_ECONOMY_BACKEND: 'postgres',
      }, process.cwd()),
      dataDir: dir,
      port: 0,
      chunkViewRadius: 1,
      persistIntervalMs: 60_000,
      pluginDir: join(dir, 'no-plugins'),
      loadExamplePlugin: false,
      loadBuiltinPlugins: true,
      operators: ['Op'],
    };
    const firstDb = open(schema, 'test');
    const first = new WorldInstance(config, { database: firstDb });
    await first.initialize();
    await first.loadPlugins();
    await first.plugins.enableAll();
    const opSink = new MemorySink();
    const opJoin = first.join({ sink: opSink, name: 'Op' });
    const opResult = isPromise(opJoin) ? await opJoin : opJoin;
    if ('error' in opResult) throw new Error(opResult.error);
    bindNamedOperatorFixture(first, opResult.player);
    first.handleChat(opResult.player, '/dailyreward set 1 50');
    first.handleChat(opResult.player, '/dailyreward set 2 80');
    first.handleChat(opResult.player, '/dailyreward enable');
    await first.money.idle?.();
    const adaSink = new MemorySink();
    const adaJoin = first.join({ sink: adaSink, name: 'Ada' });
    const ada = isPromise(adaJoin) ? await adaJoin : adaJoin;
    if ('error' in ada) throw new Error(ada.error);
    await first.money.idle?.();
    expect(first.money.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 50);
    expect(chatLines(adaSink).some((line) => line === '🎁 Награда за ежедневный вход: +50 Мегакоинов.')).toBe(true);
    const token = ada.player.sessionToken;
    const againSink = new MemorySink();
    const againJoin = first.join({ sink: againSink, name: 'Ada', sessionToken: token });
    const again = isPromise(againJoin) ? await againJoin : againJoin;
    if ('error' in again) throw new Error(again.error);
    await first.money.idle?.();
    expect(again.player.id).toBe(ada.player.id);
    expect(first.money.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 50);
    expect(chatLines(againSink).some((line) => line.includes('Награда за ежедневный вход'))).toBe(false);
    await first.stop();

    const secondDb = open(schema, 'test');
    const second = new WorldInstance(config, { database: secondDb });
    await second.initialize();
    await second.loadPlugins();
    await second.plugins.enableAll();
    const restartedSink = new MemorySink();
    const restartedJoin = second.join({ sink: restartedSink, name: 'Ada', sessionToken: token });
    const restarted = isPromise(restartedJoin) ? await restartedJoin : restartedJoin;
    if ('error' in restarted) throw new Error(restarted.error);
    await second.money.idle?.();
    expect(restarted.player.id).toBe(ada.player.id);
    expect(second.money.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 50);
    expect(chatLines(restartedSink).some((line) => line.includes('Награда за ежедневный вход'))).toBe(false);
    const claimDate = moscowDateKey(new Date());
    const rows = await secondDb.query<{ n: string; delta: string }>(
      `SELECT count(*)::text AS n, max(l.delta)::text AS delta
       FROM economy_operations o
       JOIN economy_ledger l
         ON l.deployment_id = o.deployment_id
        AND l.economy_scope = o.economy_scope
        AND l.operation_id = o.operation_id
       WHERE o.deployment_id = 'test'
         AND o.economy_scope = 'anarchy'
         AND o.source_type = 'DAILY_REWARD'
         AND o.source_id = $1`,
      [`${ada.player.id}:${claimDate}`],
    );
    expect(rows.rows[0]?.n).toBe('1');
    expect(rows.rows[0]?.delta).toBe('50');
    await second.stop();
    await rm(dir, { recursive: true, force: true });
  }, 60_000);
});
