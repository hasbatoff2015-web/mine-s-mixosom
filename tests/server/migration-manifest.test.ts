import { describe, expect, it } from 'vitest';
import {
  ADVISORY_LOCK_SQL,
  ADVISORY_UNLOCK_SQL,
  INSERT_MIGRATION_SQL,
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATIONS,
  SCHEMA_MIGRATIONS_SQL,
  SELECT_MIGRATIONS_SQL,
  assertMigrationManifest,
  migrationChecksum,
  migrationSql,
  type Migration,
} from '../../server/db/migrationManifest';
import { runMigrations } from '../../server/db/migrations';
import type { DbQueryResult, Queryable } from '../../server/db/types';
import { ECONOMY_MAX_BALANCE } from '../../server/services/economy';

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
}

interface SharedMigrationState {
  locked: boolean;
  waiters: Array<() => void>;
  rows: AppliedRow[];
  statements: string[];
  failOn: string | null;
}

function sharedState(): SharedMigrationState {
  return { locked: false, waiters: [], rows: [], statements: [], failOn: null };
}

/**
 * The lock flag is set before the first await so two runners started together
 * cannot both pass the unlocked check.
 */
class MigrationDb implements Queryable {
  holding = false;

  constructor(readonly shared: SharedMigrationState) {}

  async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>> {
    if (sql === ADVISORY_LOCK_SQL) {
      expect(params?.[0]).toBe(MIGRATION_ADVISORY_LOCK_KEY[0]);
      expect(params?.[1]).toBe(MIGRATION_ADVISORY_LOCK_KEY[1]);
      while (this.shared.locked) {
        await new Promise<void>((resolve) => {
          this.shared.waiters.push(resolve);
        });
      }
      this.shared.locked = true;
      this.holding = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql === ADVISORY_UNLOCK_SQL) {
      if (!this.holding) throw new Error('advisory unlock without the lock');
      this.holding = false;
      this.shared.locked = false;
      const waiters = this.shared.waiters.splice(0);
      for (const wake of waiters) wake();
      return { rows: [], rowCount: 1 };
    }
    if (sql === SCHEMA_MIGRATIONS_SQL) return { rows: [], rowCount: 0 };
    if (sql === SELECT_MIGRATIONS_SQL) {
      const rows = this.view().rows.map((row) => ({ ...row }));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (sql === INSERT_MIGRATION_SQL) {
      const row = {
        version: String(params?.[0]),
        name: String(params?.[1]),
        checksum: String(params?.[2]),
      };
      const target = this.view();
      if (target.rows.some((existing) => existing.version === row.version)) {
        throw new Error(`duplicate key value violates unique constraint schema_migrations ${row.version}`);
      }
      target.rows.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'BEGIN') {
      if (this.tx) throw new Error('nested begin');
      this.tx = {
        rows: this.shared.rows.map((row) => ({ ...row })),
        statements: [...this.shared.statements],
      };
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'COMMIT') {
      if (!this.tx) throw new Error('commit without begin');
      this.shared.rows = this.tx.rows;
      this.shared.statements = this.tx.statements;
      this.tx = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'ROLLBACK') {
      this.tx = null;
      return { rows: [], rowCount: 0 };
    }
    if (this.shared.failOn !== null && sql === this.shared.failOn) {
      throw new Error(`statement failed: ${sql}`);
    }
    this.view().statements.push(sql);
    return { rows: [], rowCount: 0 };
  }

  private tx: { rows: AppliedRow[]; statements: string[] } | null = null;

  private view(): { rows: AppliedRow[]; statements: string[] } {
    return this.tx ?? this.shared;
  }
}

const SAMPLE: readonly Migration[] = [
  { version: '0001', name: 'first_step', statements: ['CREATE ALPHA'] },
  { version: '0002', name: 'second_step', statements: ['CREATE BETA'] },
];

describe('migration manifest', () => {
  it('is ordered, unique, and checksum-stable', () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);
    expect(new Set(MIGRATIONS.map((migration) => migration.version)).size).toBe(MIGRATIONS.length);
    expect(new Set(MIGRATIONS.map((migration) => migration.name)).size).toBe(MIGRATIONS.length);
    const checksum = migrationChecksum(MIGRATIONS[0]!);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migrationChecksum(MIGRATIONS[0]!)).toBe(checksum);
    const edited: Migration = {
      ...MIGRATIONS[0]!,
      statements: [...MIGRATIONS[0]!.statements, 'SELECT 1'],
    };
    expect(migrationChecksum(edited)).not.toBe(checksum);
    const sql = MIGRATIONS.map((migration) => migrationSql(migration)).join('\n');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).toContain('player_identity_links');
    expect(sql).toContain('admin_audit_log is append-only');
    const pinned: Record<string, string> = {
      '0001': '60333f77a224e45b9d80a8a61baa220cba14455a842ad846942928707174d79f',
      '0002': '7d75214ba98188cd1b85434fa59f32da0cb61c0f198c43e198b4a92c62048b85',
      '0003': 'ce6452e90627ea4a99d396d5288bafb0b80b83ef04cb4512f6229579a48a2072',
      '0004': 'f419bd007d20ee33767faa7abf8788bd04fa4b18b7d553c860243a3f743b7387',
      '0005': '3541cf3e9f5e02a0af930b7d5e50a13d15ba21e5eeb7eb662fdeed104f10fae2',
      '0006': '84c308e8bd9281790dac2ab2826380f23d694d7778ede7e2ea0189b3323a5fda',
      '0007': '6e3784843a8afc01388e54974c20628f1b4c1cdae0668cd904075904af510a99',
    };
    for (const migration of MIGRATIONS) {
      if (migration.version > '0007') continue;
      expect(migrationChecksum(migration), migration.version).toBe(pinned[migration.version]);
    }
    expect(sql).toContain('idempotency_requests');
    expect(sql).toContain('economy_accounts');
    expect(sql).toContain('economy_operations');
    expect(sql).toContain('economy_ledger');
    expect(sql).toContain('is append-only');
    expect(sql).toContain(String(ECONOMY_MAX_BALANCE));
    expect(sql).not.toMatch(/\b(float|real|double precision)\b/i);
    for (const key of MIGRATION_ADVISORY_LOCK_KEY) {
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThan(0);
      expect(key).toBeLessThanOrEqual(2_147_483_647);
    }
    expect(MIGRATION_ADVISORY_LOCK_KEY).toEqual([1178813506, 1296647985]);
    expect(() => assertMigrationManifest([
      { version: '0002', name: 'later', statements: ['SELECT 1'] },
      { version: '0001', name: 'earlier', statements: ['SELECT 1'] },
    ])).toThrow(/out of order/);
  });

  it('applies pending migrations in order and skips them on the next run', async () => {
    const shared = sharedState();
    const first = await runMigrations(new MigrationDb(shared), SAMPLE);
    expect(first.applied).toEqual(['0001', '0002']);
    expect(shared.statements).toEqual(['CREATE ALPHA', 'CREATE BETA']);
    expect(shared.rows.map((row) => row.checksum)).toEqual(SAMPLE.map((migration) => migrationChecksum(migration)));
    const second = await runMigrations(new MigrationDb(shared), SAMPLE);
    expect(second.applied).toEqual([]);
    expect(shared.statements).toEqual(['CREATE ALPHA', 'CREATE BETA']);
    expect(shared.locked).toBe(false);
  });

  it('rejects an edited checksum, a renamed migration, an unknown version, and a gap', async () => {
    const checksum = sharedState();
    checksum.rows.push({
      version: '0001',
      name: 'first_step',
      checksum: 'ab'.repeat(32),
    });
    await expect(runMigrations(new MigrationDb(checksum), SAMPLE)).rejects.toThrow(/checksum mismatch/);
    expect(checksum.statements).toEqual([]);
    expect(checksum.rows).toHaveLength(1);
    expect(checksum.locked).toBe(false);

    const renamed = sharedState();
    renamed.rows.push({
      version: '0001',
      name: 'renamed',
      checksum: migrationChecksum(SAMPLE[0]!),
    });
    await expect(runMigrations(new MigrationDb(renamed), SAMPLE)).rejects.toThrow(/name mismatch/);

    const unknown = sharedState();
    unknown.rows.push({ version: '0099', name: 'future', checksum: 'cd'.repeat(32) });
    await expect(runMigrations(new MigrationDb(unknown), SAMPLE)).rejects.toThrow(/does not contain/);

    const gap = sharedState();
    gap.rows.push({
      version: '0002',
      name: 'second_step',
      checksum: migrationChecksum(SAMPLE[1]!),
    });
    await expect(runMigrations(new MigrationDb(gap), SAMPLE)).rejects.toThrow(/earlier migration is not/);
    expect(gap.statements).toEqual([]);
    expect(gap.locked).toBe(false);
  });

  it('rolls a failed migration back and retries only the pending one', async () => {
    const shared = sharedState();
    shared.failOn = 'CREATE BETA';
    await expect(runMigrations(new MigrationDb(shared), SAMPLE)).rejects.toThrow(/CREATE BETA/);
    expect(shared.rows.map((row) => row.version)).toEqual(['0001']);
    expect(shared.statements).toEqual(['CREATE ALPHA']);
    expect(shared.locked).toBe(false);
    shared.failOn = null;
    const retried = await runMigrations(new MigrationDb(shared), SAMPLE);
    expect(retried.applied).toEqual(['0002']);
    expect(shared.statements).toEqual(['CREATE ALPHA', 'CREATE BETA']);
  });

  it('lets two runners apply each statement once', async () => {
    const shared = sharedState();
    const migrations: readonly Migration[] = [
      { version: '0001', name: 'only_once', statements: ['CREATE ONCE'] },
    ];
    const [left, right] = await Promise.all([
      runMigrations(new MigrationDb(shared), migrations),
      runMigrations(new MigrationDb(shared), migrations),
    ]);
    expect(shared.statements).toEqual(['CREATE ONCE']);
    expect(shared.rows).toHaveLength(1);
    expect([...left.applied, ...right.applied].sort()).toEqual(['0001']);
    expect(shared.locked).toBe(false);
  });

  it('records the foundation statements and their checksum', async () => {
    const shared = sharedState();
    const result = await runMigrations(new MigrationDb(shared), MIGRATIONS);
    expect(result.applied).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008']);
    expect(shared.statements).toEqual(MIGRATIONS.flatMap((migration) => [...migration.statements]));
    expect(shared.rows.map((row) => row.checksum)).toEqual(MIGRATIONS.map((migration) => migrationChecksum(migration)));
    expect(shared.statements.join('\n')).toContain('DROP CONSTRAINT admin_audit_log_request_scope');
    expect(shared.statements.join('\n')).not.toMatch(/DROP\s+TABLE/i);
  });
});
