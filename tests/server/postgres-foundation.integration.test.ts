import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuditService } from '../../server/db/audit';
import { hashPayload } from '../../server/db/canonicalJson';
import { PostgresDatabase } from '../../server/db/database';
import { IdempotencyPendingError } from '../../server/db/errors';
import { IdempotencyService } from '../../server/db/idempotency';
import { registerIdempotencyCases } from './helpers/idempotencyCases';

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

describe.skipIf(databaseUrl === '')('postgres foundation integration', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;
  let main!: PostgresDatabase;
  let schema = '';

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
      deploymentId: 'dev',
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
    schema = await makeSchema();
    main = open(schema);
    await main.start();
  }, 30_000);

  afterAll(async () => {
    for (const database of opened.splice(0)) {
      await database.close().catch(() => undefined);
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

  it('bootstraps once and a second startup does not reapply', async () => {
    expect(main.appliedMigrations).toEqual(['0001', '0002', '0003', '0004', '0005']);
    const again = open(schema);
    await again.start();
    expect(again.appliedMigrations).toEqual([]);
    const count = await again.query<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    expect(count.rows[0]?.n).toBe('5');
    const tables = await again.query<{ accounts: string | null; operations: string | null; ledger: string | null }>(
      `SELECT to_regclass('economy_accounts')::text AS accounts,
              to_regclass('economy_operations')::text AS operations,
              to_regclass('economy_ledger')::text AS ledger`,
    );
    expect(tables.rows[0]?.accounts).toMatch(/economy_accounts$/);
    expect(tables.rows[0]?.operations).toMatch(/economy_operations$/);
    expect(tables.rows[0]?.ledger).toMatch(/economy_ledger$/);
  }, 30_000);

  it('serializes two migration runners', async () => {
    const name = await makeSchema();
    const left = open(name);
    const right = open(name);
    await Promise.all([left.start(), right.start()]);
    expect([...left.appliedMigrations, ...right.appliedMigrations].sort()).toEqual(['0001', '0002', '0003', '0004', '0005']);
    const count = await left.query<{ n: string }>('SELECT count(*)::text AS n FROM schema_migrations');
    expect(count.rows[0]?.n).toBe('5');
  }, 30_000);

  it('rejects an edited applied checksum', async () => {
    const name = await makeSchema();
    const first = open(name);
    await first.start();
    await first.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = '0001'`, ['ab'.repeat(32)]);
    const second = open(name);
    await expect(second.start()).rejects.toThrow(/checksum/);
  }, 30_000);

  it('inserts audit rows and rejects update, delete, and truncate', async () => {
    const audit = new AdminAuditService(main, 'dev');
    const requestId = randomUUID();
    const evil = `'); DROP TABLE admin_audit_log; --`;
    const row = await audit.append({
      requestId,
      adminId: evil,
      action: 'note',
      targetType: 'player',
      targetId: 'alice',
      reason: 'stored literally',
      success: true,
      metadata: { ok: true },
    });
    expect(row.adminId).toBe(evil);
    const found = await main.query<{ name: string | null }>('SELECT to_regclass($1)::text AS name', ['admin_audit_log']);
    expect(found.rows[0]?.name).toBeTruthy();
    await expect(main.query('UPDATE admin_audit_log SET reason = $1', ['changed'])).rejects.toThrow(/append-only/);
    await expect(main.query('DELETE FROM admin_audit_log WHERE request_id = $1::uuid', [requestId])).rejects.toThrow(/append-only/);
    await expect(main.query('TRUNCATE TABLE admin_audit_log')).rejects.toThrow(/append-only/);
    const still = await audit.getLatestByRequestId(requestId);
    expect(still?.reason).toBe('stored literally');
    expect(still?.adminId).toBe(evil);
  }, 30_000);

  it('keeps two immutable audit attempts for one request id', async () => {
    const audit = new AdminAuditService(main, 'dev');
    const requestId = randomUUID();
    const first = await audit.append({
      requestId,
      adminId: 'admin-owner',
      action: 'note',
      targetType: 'player',
      reason: 'first attempt failed',
      success: false,
    });
    const second = await audit.append({
      requestId,
      adminId: 'admin-owner',
      action: 'note',
      targetType: 'player',
      reason: 'retry succeeded',
      success: true,
    });
    expect(first.eventId).not.toBe(second.eventId);
    const history = await audit.listByRequestId(requestId);
    expect(history.map((row) => row.success)).toEqual([false, true]);
    await expect(main.query('UPDATE admin_audit_log SET reason = $1', ['changed'])).rejects.toThrow(/append-only/);
    await expect(main.query('DELETE FROM admin_audit_log WHERE request_id = $1::uuid', [requestId])).rejects.toThrow(/append-only/);
    await expect(main.query('TRUNCATE TABLE admin_audit_log')).rejects.toThrow(/append-only/);
  }, 30_000);

  it('does not run the callback for a visible in-progress row', async () => {
    const requestId = randomUUID();
    await main.query(
      `INSERT INTO idempotency_requests (
        deployment_id, request_scope, request_id, operation, actor_id, payload_hash, state
      ) VALUES ($1, 'global', $2::uuid, 'grant', 'admin-1', $3, 'in_progress')`,
      ['dev', requestId, hashPayload({ amount: 1 })],
    );
    const service = new IdempotencyService(main, 'dev');
    let calls = 0;
    await expect(service.execute({
      deploymentId: 'dev',
      requestId,
      operation: 'grant',
      actorId: 'admin-1',
      payload: { amount: 1 },
    }, async () => {
      calls += 1;
      return { ok: true };
    })).rejects.toBeInstanceOf(IdempotencyPendingError);
    expect(calls).toBe(0);
  }, 30_000);

  registerIdempotencyCases(() => {
    if (!main) throw new Error('integration database was not started');
    return main;
  }, { manageLifecycle: false });
});
