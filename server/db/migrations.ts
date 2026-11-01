import type { Queryable } from './types';
import {
  ADVISORY_LOCK_SQL,
  ADVISORY_UNLOCK_SQL,
  INSERT_MIGRATION_SQL,
  MIGRATION_ADVISORY_LOCK_KEY,
  SCHEMA_MIGRATIONS_SQL,
  SELECT_MIGRATIONS_SQL,
  assertMigrationManifest,
  migrationChecksum,
  type Migration,
} from './migrationManifest';

interface AppliedMigrationRow {
  version: string;
  name: string;
  checksum: string;
}

/**
 * Serialize schema changes across processes with one session advisory lock.
 * Each pending migration and its schema_migrations insert share one transaction.
 * An edited migration whose checksum no longer matches the applied row aborts
 * startup. Applied history is never deleted or rebuilt here.
 */
export async function runMigrations(
  client: Queryable,
  migrations: readonly Migration[],
): Promise<{ applied: string[] }> {
  assertMigrationManifest(migrations);
  await client.query(ADVISORY_LOCK_SQL, MIGRATION_ADVISORY_LOCK_KEY);
  let failure: unknown;
  try {
    await client.query(SCHEMA_MIGRATIONS_SQL);
    const existing = await client.query<AppliedMigrationRow>(SELECT_MIGRATIONS_SQL);
    const byVersion = new Map<string, AppliedMigrationRow>();
    for (const row of existing.rows) {
      if (byVersion.has(row.version)) {
        throw new Error(`schema_migrations has duplicate version ${row.version}`);
      }
      byVersion.set(row.version, row);
    }
    const known = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const row of existing.rows) {
      const migration = known.get(row.version);
      if (!migration) {
        throw new Error(
          `database has applied migration ${row.version} (${row.name}) that this server build does not contain`,
        );
      }
      if (row.checksum !== migrationChecksum(migration)) {
        throw new Error(`migration ${row.version} checksum mismatch`);
      }
      if (row.name !== migration.name) {
        throw new Error(`migration ${row.version} name mismatch`);
      }
    }

    let missingEarlier = false;
    const pending: Migration[] = [];
    for (const migration of migrations) {
      if (byVersion.has(migration.version)) {
        if (missingEarlier) {
          throw new Error(`migration ${migration.version} is applied but an earlier migration is not`);
        }
      } else {
        missingEarlier = true;
        pending.push(migration);
      }
    }

    const applied: string[] = [];
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query(INSERT_MIGRATION_SQL, [
          migration.version,
          migration.name,
          migrationChecksum(migration),
        ]);
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          const original = error instanceof Error ? error.message : String(error);
          const rollbackText = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          throw new Error(`migration ${migration.version} failed (${original}) and rollback failed (${rollbackText})`);
        }
        throw error;
      }
    }
    return { applied };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await client.query(ADVISORY_UNLOCK_SQL, MIGRATION_ADVISORY_LOCK_KEY);
    } catch (unlockError) {
      if (!failure) throw unlockError;
    }
  }
}
