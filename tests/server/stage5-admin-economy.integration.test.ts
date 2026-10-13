import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuditService } from '../../server/db/audit';
import { PostgresDatabase } from '../../server/db/database';
import { economyRequestScope, IdempotencyService } from '../../server/db/idempotency';
import { PostgresGameplayEconomy } from '../../server/economy/postgresAuthority';
import { MegacoinService } from '../../server/economy/service';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { KillStatistics } from '../../server/services/killStats';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name) || name === 'template0' || name === 'template1') {
    throw new Error(`refusing database "${name}"`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('stage 5 admin balance adjustment', () => {
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
      deploymentId: 'stage5-test',
      poolMax: 4,
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

  it('sets a balance once per request and keeps the audit on that commit', async () => {
    const database = open(await makeSchema());
    await database.start();
    const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'fc-stage5-eco-')));
    const megacoin = new MegacoinService(database, 'stage5-test', 'anarchy');
    const money = new PostgresGameplayEconomy(
      megacoin,
      new IdempotencyService(database, 'stage5-test', economyRequestScope('anarchy')),
      new EconomyService(store),
      new KillStatistics(store),
    );
    const audit = new AdminAuditService(database, 'stage5-test');
    const playerId = randomUUID();
    await money.preparePlayer(playerId, 'Ada');
    const requestId = randomUUID();
    const first = await money.setBalanceAudited(playerId, 500, 'ADMIN_SET', {
      requestId,
      operation: 'admin_set_balance',
      actorId: 'admin-owner',
      payload: { playerId, balance: 500, reason: 'коррекция', serverMode: 'anarchy' },
    }, async (tx) => { await audit.append({
      requestId,
      adminId: 'admin-owner',
      action: 'economy_set_balance',
      targetType: 'player',
      targetId: playerId,
      reason: 'коррекция',
      serverMode: 'anarchy',
      worldId: 'anarchy',
      success: true,
      metadata: { balance: 500 },
    }, tx);
    });
    expect(first.ok).toBe(true);
    expect(first.replayed).toBe(false);
    expect(money.getBalance(playerId)).toBe(500);

    const replay = await money.setBalanceAudited(playerId, 500, 'ADMIN_SET', {
      requestId,
      operation: 'admin_set_balance',
      actorId: 'admin-owner',
      payload: { playerId, balance: 500, reason: 'коррекция', serverMode: 'anarchy' },
    }, () => {
      throw new Error('replay must not write again');
    });
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(money.getBalance(playerId)).toBe(500);
    const rows = await audit.listByRequestId(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.adminId).toBe('admin-owner');
    expect(rows[0]?.success).toBe(true);

    const conflict = await money.setBalanceAudited(playerId, 800, 'ADMIN_SET', {
      requestId,
      operation: 'admin_set_balance',
      actorId: 'admin-owner',
      payload: { playerId, balance: 800, reason: 'другая', serverMode: 'anarchy' },
    }, async (tx) => { await audit.append({
      requestId,
      adminId: 'admin-owner',
      action: 'economy_set_balance',
      targetType: 'player',
      targetId: playerId,
      reason: 'другая',
      serverMode: 'anarchy',
      worldId: 'anarchy',
      success: true,
      metadata: { balance: 800 },
    }, tx);
    });
    expect(conflict.ok).toBe(false);
    expect(money.getBalance(playerId)).toBe(500);

    const secondId = randomUUID();
    const second = await money.setBalanceAudited(playerId, 800, 'ADMIN_SET', {
      requestId: secondId,
      operation: 'admin_set_balance',
      actorId: 'admin-colleague',
      payload: { playerId, balance: 800, reason: 'вторая правка', serverMode: 'anarchy' },
    }, async (tx) => { await audit.append({
      requestId: secondId,
      adminId: 'admin-colleague',
      action: 'economy_set_balance',
      targetType: 'player',
      targetId: playerId,
      reason: 'вторая правка',
      serverMode: 'anarchy',
      worldId: 'anarchy',
      success: true,
      metadata: { balance: 800 },
    }, tx);
    });
    expect(second.ok).toBe(true);
    expect(money.getBalance(playerId)).toBe(800);
    const history = await money.getTransactionHistory(playerId, 10);
    expect(history.some((entry) => entry.balanceAfter === 800)).toBe(true);
    const recent = await audit.listRecent(10);
    expect(recent.every((row) => row.deploymentId === 'stage5-test')).toBe(true);
    expect(JSON.stringify(recent)).not.toContain('sessionToken');
  });
});
