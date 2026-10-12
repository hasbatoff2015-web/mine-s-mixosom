import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import {
  EconomyAccountNotFoundError,
  EconomyInsufficientError,
  EconomyLimitError,
  EconomySourceConflictError,
} from '../../server/economy/errors';
import { MegacoinService } from '../../server/economy/service';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE } from '../../server/services/economy';

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

describe.skipIf(databaseUrl === '')('postgres megacoin ledger', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;
  let database!: PostgresDatabase;
  let economy!: MegacoinService;
  let schema = '';

  async function makeSchema(): Promise<string> {
    if (!admin) throw new Error('admin client missing');
    const name = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  function open(searchPath: string): PostgresDatabase {
    const created = new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'dev',
      poolMax: 4,
      searchPath,
    });
    opened.push(created);
    return created;
  }

  function player(displayName: string): { playerId: string; displayName: string } {
    return { playerId: randomUUID(), displayName };
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    schema = await makeSchema();
    database = open(schema);
    await database.start();
    economy = new MegacoinService(database, 'dev', 'anarchy');
  }, 30_000);

  afterAll(async () => {
    for (const openedDatabase of opened.splice(0)) {
      await openedDatabase.close().catch(() => undefined);
    }
    if (!admin) return;
    try {
      for (const name of schemas) {
        await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
      }
    } finally {
      await admin.end().catch(() => undefined);
      admin = undefined;
    }
  }, 30_000);

  it('applies migration 0003 once and keeps checksum protection', async () => {
    expect(database.appliedMigrations).toEqual(['0001', '0002', '0003', '0004', '0005', '0006']);
    const again = open(schema);
    await again.start();
    expect(again.appliedMigrations).toEqual([]);
    const versions = await again.query<{ version: string; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    );
    expect(versions.rows.map((row) => `${row.version}:${row.name}`)).toEqual([
      '0001:admin_audit_and_idempotency',
      '0002:admin_audit_request_attempts',
      '0003:megacoin_ledger',
      '0004:gameplay_economy_scope',
      '0005:idempotency_request_scope',
      '0006:gameplay_settlements',
    ]);
    const fresh = await makeSchema();
    const first = open(fresh);
    await first.start();
    await first.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = '0003'`, ['ab'.repeat(32)]);
    const second = open(fresh);
    await expect(second.start()).rejects.toThrow(/checksum/);
  }, 30_000);

  it('mints the opening 100 once, with one initial ledger leg', async () => {
    const ada = player('Ada');
    const first = await economy.ensureAccount(ada);
    const second = await economy.ensureAccount(ada);
    expect(first.balance).toBe(ECONOMY_INITIAL_BALANCE);
    expect(second.balance).toBe(ECONOMY_INITIAL_BALANCE);
    expect(await economy.getBalance(ada.playerId)).toBe(100);
    const initial = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger
       WHERE deployment_id = 'dev' AND player_id = $1 AND reason = 'INITIAL' AND delta = 100`,
      [ada.playerId],
    );
    expect(initial.rows[0]?.n).toBe('1');
    const operation = await database.query<{ kind: string }>(
      `SELECT o.kind FROM economy_operations o
       JOIN economy_ledger l ON l.deployment_id = o.deployment_id AND l.operation_id = o.operation_id
       WHERE o.deployment_id = 'dev' AND l.player_id = $1 AND o.kind = 'INITIAL'`,
      [ada.playerId],
    );
    expect(operation.rows).toHaveLength(1);
    expect(await economy.reconcile(ada.playerId)).toEqual({
      playerId: ada.playerId,
      balance: 100,
      ledgerTotal: 100,
      matches: true,
    });
  }, 30_000);

  it('credits, debits, and rolls an insufficient debit back', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    const credited = await economy.credit({ ...ada, amount: 25, reason: 'BLOCK_BREAK' });
    expect(credited.replayed).toBe(false);
    expect(credited.operation.kind).toBe('SOURCE');
    expect(credited.operation.legs[0]).toMatchObject({ delta: 25, balanceBefore: 100, balanceAfter: 125 });
    expect(credited.accounts[0]?.balance).toBe(125);
    const debited = await economy.debit({ ...ada, amount: 40, reason: 'TRADER_PURCHASE' });
    expect(debited.operation.kind).toBe('SINK');
    expect(debited.accounts[0]?.balance).toBe(85);
    await expect(economy.debit({ ...ada, amount: 86, reason: 'TRADER_PURCHASE' })).rejects.toBeInstanceOf(EconomyInsufficientError);
    expect(await economy.getBalance(ada.playerId)).toBe(85);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
    const found = await economy.getOperation(credited.operation.operationId);
    expect(found?.operationId).toBe(credited.operation.operationId);
  }, 30_000);

  it('refuses a balance above the maximum and a direct overflow write', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    const raised = await economy.setBalance({ ...ada, balance: ECONOMY_MAX_BALANCE, reason: 'ADMIN_SET' });
    expect(raised.changed).toBe(true);
    expect(raised.account.balance).toBe(ECONOMY_MAX_BALANCE);
    await expect(economy.credit({ ...ada, amount: 1, reason: 'ADMIN_GIVE' })).rejects.toBeInstanceOf(EconomyLimitError);
    expect(await economy.getBalance(ada.playerId)).toBe(ECONOMY_MAX_BALANCE);
    await expect(database.query(
      'UPDATE economy_accounts SET balance = $1 WHERE player_id = $2',
      [ECONOMY_MAX_BALANCE + 1, ada.playerId],
    )).rejects.toThrow(/balance|check/i);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
  }, 30_000);

  it('transfers both legs atomically and leaves neither player changed on failure', async () => {
    const ada = player('Ada');
    const bea = player('Bea');
    await economy.ensureAccount(ada);
    const failed = economy.transfer({
      fromPlayerId: ada.playerId,
      toPlayerId: bea.playerId,
      fromDisplayName: ada.displayName,
      toDisplayName: bea.displayName,
      amount: 500,
      reason: 'PLAYER_TRANSFER',
    });
    await expect(failed).rejects.toBeInstanceOf(EconomyInsufficientError);
    expect(await economy.getBalance(ada.playerId)).toBe(100);
    expect(await economy.getAccount(bea.playerId)).toBeNull();

    await economy.ensureAccount(bea);
    const moved = await economy.transfer({
      fromPlayerId: ada.playerId,
      toPlayerId: bea.playerId,
      amount: 40,
      reason: 'PLAYER_TRANSFER',
    });
    expect(moved.replayed).toBe(false);
    expect(moved.operation.kind).toBe('TRANSFER');
    expect(moved.operation.legs).toHaveLength(2);
    expect(moved.operation.legs[0]).toMatchObject({
      playerId: ada.playerId,
      delta: -40,
      balanceBefore: 100,
      balanceAfter: 60,
      counterpartyPlayerId: bea.playerId,
    });
    expect(moved.operation.legs[1]).toMatchObject({
      playerId: bea.playerId,
      delta: 40,
      balanceBefore: 100,
      balanceAfter: 140,
      counterpartyPlayerId: ada.playerId,
    });
    expect(await economy.getBalance(ada.playerId)).toBe(60);
    expect(await economy.getBalance(bea.playerId)).toBe(140);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
    expect((await economy.reconcile(bea.playerId)).matches).toBe(true);
  }, 30_000);

  it('adjusts up and down without rewriting history, and ignores a zero-delta set', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    const up = await economy.setBalance({ ...ada, balance: 500, reason: 'ADMIN_SET' });
    expect(up.operation?.kind).toBe('ADJUSTMENT');
    expect(up.operation?.legs[0]).toMatchObject({ delta: 400, balanceBefore: 100, balanceAfter: 500 });
    const before = await economy.history({ playerId: ada.playerId, limit: 100 });
    const down = await economy.setBalance({ ...ada, balance: 100, reason: 'ADMIN_SET' });
    expect(down.operation?.legs[0]).toMatchObject({ delta: -400, balanceBefore: 500, balanceAfter: 100 });
    const same = await economy.setBalance({ ...ada, balance: 100, reason: 'ADMIN_SET' });
    expect(same).toMatchObject({ changed: false, replayed: false, operation: null, account: { balance: 100 } });
    const after = await economy.history({ playerId: ada.playerId, limit: 100 });
    expect(after.entries).toHaveLength(before.entries.length + 1);
    expect(after.entries.map((entry) => entry.entryId)).toEqual(expect.arrayContaining(before.entries.map((entry) => entry.entryId)));
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
    const source = { type: 'ADMIN', id: randomUUID() };
    const ignored = await economy.setBalance({ ...ada, balance: 100, reason: 'ADMIN_SET', source });
    expect(ignored).toMatchObject({ changed: false, replayed: false, operation: null });
    const consumed = await economy.setBalance({ ...ada, balance: 140, reason: 'ADMIN_SET', source });
    expect(consumed.changed).toBe(true);
    expect(consumed.replayed).toBe(false);
    expect(await economy.getBalance(ada.playerId)).toBe(140);
  }, 30_000);

  it('rejects update, delete, and truncate on the ledger and on operations', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    await expect(database.query('UPDATE economy_ledger SET reason = $1', ['CHANGED'])).rejects.toThrow(/append-only/);
    await expect(database.query('DELETE FROM economy_ledger WHERE player_id = $1', [ada.playerId])).rejects.toThrow(/append-only/);
    await expect(database.query('TRUNCATE TABLE economy_ledger')).rejects.toThrow(/append-only/);
    await expect(database.query('UPDATE economy_operations SET kind = $1', ['SOURCE'])).rejects.toThrow(/append-only/);
    await expect(database.query('DELETE FROM economy_operations WHERE kind = $1', ['INITIAL'])).rejects.toThrow(/append-only/);
    await expect(database.query('TRUNCATE TABLE economy_operations')).rejects.toThrow(/append-only|foreign key/i);
    await expect(database.query('TRUNCATE TABLE economy_ledger, economy_operations')).rejects.toThrow(/append-only/);
    const initial = await database.query<{ operation_id: string }>(
      `SELECT operation_id FROM economy_ledger WHERE deployment_id = 'dev' AND player_id = $1 AND reason = 'INITIAL'`,
      [ada.playerId],
    );
    await expect(database.query(
      `INSERT INTO economy_ledger (
        entry_id, deployment_id, economy_scope, operation_id, leg_index, player_id, delta, balance_before, balance_after, reason
      ) VALUES ($1::uuid, 'dev', 'anarchy', $2::uuid, 1, $3, 0, 100, 100, 'OTHER')`,
      [randomUUID(), initial.rows[0]?.operation_id, ada.playerId],
    )).rejects.toThrow(/delta|check/i);
    expect(await economy.getBalance(ada.playerId)).toBe(100);
  }, 30_000);

  it('pays a source once and rejects a conflicting reuse', async () => {
    const ada = player('Ada');
    const bea = player('Bea');
    await economy.ensureAccount(ada);
    const source = { type: 'MOB_KILL', id: randomUUID() };
    const requestId = randomUUID();
    const unusedRequest = randomUUID();
    const first = await economy.credit({
      ...ada,
      amount: 15,
      reason: 'MOB_KILL',
      source,
      requestId,
    });
    const second = await economy.credit({
      ...ada,
      amount: 15,
      reason: 'MOB_KILL',
      source,
      requestId: unusedRequest,
    });
    expect(second.replayed).toBe(true);
    expect(second.operation.operationId).toBe(first.operation.operationId);
    expect(second.operation.requestId).toBe(requestId);
    expect(await economy.getBalance(ada.playerId)).toBe(115);
    expect(await economy.listByRequestId(requestId)).toHaveLength(1);
    expect(await economy.listByRequestId(unusedRequest)).toEqual([]);
    await economy.credit({ ...ada, amount: 1, reason: 'BLOCK_BREAK', requestId, source: { type: 'BLOCK_BREAK', id: randomUUID() } });
    await economy.credit({ ...ada, amount: 1, reason: 'BLOCK_BREAK', requestId, source: { type: 'BLOCK_BREAK', id: randomUUID() } });
    expect(await economy.listByRequestId(requestId)).toHaveLength(3);
    expect(await economy.getBalance(ada.playerId)).toBe(117);

    await expect(economy.credit({
      ...ada,
      amount: 16,
      reason: 'MOB_KILL',
      source,
    })).rejects.toBeInstanceOf(EconomySourceConflictError);
    await expect(economy.credit({
      ...bea,
      amount: 15,
      reason: 'MOB_KILL',
      source,
    })).rejects.toBeInstanceOf(EconomySourceConflictError);
    await expect(economy.debit({
      ...ada,
      amount: 15,
      reason: 'MOB_KILL',
      source,
    })).rejects.toBeInstanceOf(EconomySourceConflictError);
    expect(await economy.getBalance(ada.playerId)).toBe(117);
    expect(await economy.getAccount(bea.playerId)).toBeNull();
    const replayedSet = await economy.setBalance({
      ...ada,
      balance: 200,
      reason: 'ADMIN_SET',
      source: { type: 'ADMIN', id: randomUUID() },
    });
    await economy.credit({ ...ada, amount: 5, reason: 'ADMIN_GIVE' });
    const again = await economy.setBalance({
      ...ada,
      balance: 200,
      reason: 'ADMIN_SET',
      source: { type: replayedSet.operation?.sourceType ?? 'ADMIN', id: replayedSet.operation?.sourceId ?? '' },
    });
    expect(again.replayed).toBe(true);
    expect(await economy.getBalance(ada.playerId)).toBe(205);
  }, 30_000);

  it('pages history without returning the whole ledger at once', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    for (let index = 0; index < 5; index += 1) {
      await economy.credit({ ...ada, amount: 1, reason: 'OTHER' });
    }
    const first = await economy.history({ playerId: ada.playerId, limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await economy.history({ playerId: ada.playerId, limit: 2, before: first.nextCursor! });
    const third = await economy.history({
      playerId: ada.playerId,
      limit: 2,
      before: second.nextCursor!,
    });
    const ids = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    expect(third.nextCursor).toBeNull();
    const descending = [...first.entries, ...second.entries, ...third.entries];
    const oldest = descending[descending.length - 1];
    if (!oldest) throw new Error('missing oldest ledger row');
    const forward = await economy.history({
      playerId: ada.playerId,
      limit: 10,
      after: { createdAt: oldest.createdAt, entryId: oldest.entryId },
    });
    expect(forward.entries.map((entry) => entry.entryId)).toEqual(
      descending.slice(0, -1).map((entry) => entry.entryId).reverse(),
    );
    expect(forward.nextCursor).toBeNull();
    expect(oldest.createdAt).toMatch(/\.\d{6}Z$/);
    const stored = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger WHERE deployment_id = 'dev' AND player_id = $1`,
      [ada.playerId],
    );
    expect(stored.rows[0]?.n).toBe('6');
  }, 30_000);

  it('mints 100 once when account creation races', async () => {
    const ada = player('Ada');
    const [left, right] = await Promise.all([
      economy.ensureAccount(ada),
      economy.ensureAccount(ada),
    ]);
    expect(left.balance).toBe(100);
    expect(right.balance).toBe(100);
    const count = await database.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger
       WHERE deployment_id = 'dev' AND player_id = $1`,
      [ada.playerId],
    );
    expect(count.rows[0]?.n).toBe('1');
    expect(await economy.reconcile(ada.playerId)).toMatchObject({ balance: 100, ledgerTotal: 100, matches: true });
  }, 30_000);

  it('pays one source when two credits race', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    const source = { type: 'MOB_KILL', id: randomUUID() };
    const settled = await Promise.all([
      economy.credit({ ...ada, amount: 10, reason: 'MOB_KILL', source }),
      economy.credit({ ...ada, amount: 10, reason: 'MOB_KILL', source }),
    ]);
    expect(settled.filter((result) => result.replayed)).toHaveLength(1);
    expect(await economy.getBalance(ada.playerId)).toBe(110);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
  }, 30_000);

  it('lets only one of two racing withdrawals of 80 succeed', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    const settled = await Promise.allSettled([
      economy.debit({ ...ada, amount: 80, reason: 'ADMIN_TAKE' }),
      economy.debit({ ...ada, amount: 80, reason: 'ADMIN_TAKE' }),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((result) => result.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(EconomyInsufficientError);
    expect(await economy.getBalance(ada.playerId)).toBe(20);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
  }, 30_000);

  it('keeps concurrent deposits and withdrawals consistent', async () => {
    const ada = player('Ada');
    await economy.ensureAccount(ada);
    await Promise.all([
      economy.credit({ ...ada, amount: 50, reason: 'BLOCK_BREAK' }),
      economy.debit({ ...ada, amount: 30, reason: 'TRADER' }),
    ]);
    expect(await economy.getBalance(ada.playerId)).toBe(120);
    expect(await economy.reconcile(ada.playerId)).toMatchObject({ balance: 120, ledgerTotal: 120, matches: true });
  }, 30_000);

  it('does not lose updates when two transfers share a player', async () => {
    const ada = player('Ada');
    const bea = player('Bea');
    const cam = player('Cam');
    await economy.ensureAccount(ada);
    await economy.ensureAccount(bea);
    await economy.ensureAccount(cam);
    await Promise.all([
      economy.transfer({
        fromPlayerId: ada.playerId,
        toPlayerId: bea.playerId,
        amount: 40,
        reason: 'PLAYER_TRANSFER',
      }),
      economy.transfer({
        fromPlayerId: ada.playerId,
        toPlayerId: cam.playerId,
        amount: 30,
        reason: 'TRADE',
      }),
    ]);
    expect(await economy.getBalance(ada.playerId)).toBe(30);
    expect(await economy.getBalance(bea.playerId)).toBe(140);
    expect(await economy.getBalance(cam.playerId)).toBe(130);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
  }, 30_000);

  it('runs opposite transfers without deadlocking', async () => {
    const ada = player('Ada');
    const bea = player('Bea');
    await economy.ensureAccount(ada);
    await economy.ensureAccount(bea);
    await economy.setBalance({ ...ada, balance: 500, reason: 'ADMIN_SET' });
    await economy.setBalance({ ...bea, balance: 500, reason: 'ADMIN_SET' });
    for (let round = 0; round < 8; round += 1) {
      await Promise.all([
        economy.transfer({
          fromPlayerId: ada.playerId,
          toPlayerId: bea.playerId,
          amount: 50,
          reason: 'PLAYER_TRANSFER',
        }),
        economy.transfer({
          fromPlayerId: bea.playerId,
          toPlayerId: ada.playerId,
          amount: 50,
          reason: 'PLAYER_TRANSFER',
        }),
      ]);
    }
    expect(await economy.getBalance(ada.playerId)).toBe(500);
    expect(await economy.getBalance(bea.playerId)).toBe(500);
    expect((await economy.reconcile(ada.playerId)).matches).toBe(true);
    expect((await economy.reconcile(bea.playerId)).matches).toBe(true);
  }, 30_000);

  it('does not reconcile a missing account and does not repair one', async () => {
    await expect(economy.reconcile(randomUUID())).rejects.toBeInstanceOf(EconomyAccountNotFoundError);
  });
});
