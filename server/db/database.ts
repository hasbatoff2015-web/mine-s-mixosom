import type { Pool, PoolClient } from 'pg';
import {
  DB_POOL_MAX_LIMIT,
  DB_POOL_MIN,
  type ServerConfig,
  databaseLogLabel,
} from '../config';
import { serverLog } from '../log';
import { DatabaseClosedError, DatabaseDisabledError, DatabaseNotReadyError } from './errors';
import { MIGRATIONS } from './migrationManifest';
import { runMigrations } from './migrations';
import { preserveOrSanitize, sanitizeDatabaseError } from './redact';
import type { Database, DbQueryResult, Queryable } from './types';

export type { Database, Queryable };

const SEARCH_PATH = /^[a-z_][a-z0-9_]*$/;
const CONNECT_TIMEOUT_MS = 10_000;

/** PostgreSQL stores application_name in NAMEDATALEN-1 bytes. Deployment ids can be longer. */
export function databaseApplicationName(deploymentId: string): string {
  return `frontier-cubes:${deploymentId}`.slice(0, 63);
}

export interface PostgresDatabaseOptions {
  readonly url: string;
  readonly deploymentId: string;
  readonly poolMax: number;
  /**
   * Test isolation only. Production uses the database in the connection URL.
   * The value is a validated identifier, never taken from a player or admin.
   */
  readonly searchPath?: string;
}

type PgPoolConstructor = typeof Pool;

async function loadPool(): Promise<PgPoolConstructor> {
  const loaded = await import('pg');
  const ctor = loaded.Pool ?? loaded.default?.Pool;
  if (!ctor) throw new Error('pg did not export Pool');
  return ctor;
}

function mapResult<T>(result: { rows?: T[]; rowCount?: number | null }): DbQueryResult<T> {
  if (Array.isArray(result)) return { rows: [], rowCount: 0 };
  return {
    rows: result.rows ?? [],
    rowCount: result.rowCount ?? 0,
  };
}

function asQueryable(client: PoolClient): Queryable {
  return {
    async query<T>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>> {
      const result = await client.query(sql, params ? [...params] : undefined);
      return mapResult<T>(result);
    },
  };
}

/** No sockets and no pg import. Gameplay keeps today's filesystem persistence. */
export class DisabledDatabase implements Database {
  readonly enabled = false;
  readonly deploymentId = null;
  readonly appliedMigrations: readonly string[] = [];
  private closed = false;
  private announced = false;

  async start(): Promise<void> {
    if (this.closed) throw new DatabaseClosedError();
    if (!this.announced) {
      this.announced = true;
      serverLog(databaseLogLabel({ enabled: false }));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async query(): Promise<never> {
    throw new DatabaseDisabledError();
  }

  async transaction(): Promise<never> {
    throw new DatabaseDisabledError();
  }
}

export class PostgresDatabase implements Database {
  readonly enabled = true;
  readonly deploymentId: string;
  private readonly url: string;
  private readonly poolMax: number;
  private readonly searchPath?: string;
  private pool?: Pool;
  private applied: readonly string[] = [];
  private state: 'idle' | 'starting' | 'ready' | 'closed' = 'idle';

  constructor(options: PostgresDatabaseOptions) {
    if (options.deploymentId.trim() === '') throw new Error('FC_DEPLOYMENT_ID is required.');
    if (!Number.isInteger(options.poolMax) || options.poolMax < DB_POOL_MIN || options.poolMax > DB_POOL_MAX_LIMIT) {
      throw new Error('database pool max is outside the allowed range');
    }
    if (options.searchPath !== undefined && !SEARCH_PATH.test(options.searchPath)) {
      throw new Error('invalid database search_path');
    }
    this.url = options.url;
    this.deploymentId = options.deploymentId.trim();
    this.poolMax = options.poolMax;
    this.searchPath = options.searchPath;
  }

  get appliedMigrations(): readonly string[] {
    return this.applied;
  }

  async start(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'closed') throw new DatabaseClosedError();
    this.state = 'starting';
    let pool: Pool | undefined;
    try {
      const PoolCtor = await loadPool();
      pool = new PoolCtor({
        connectionString: this.url,
        max: this.poolMax,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        application_name: databaseApplicationName(this.deploymentId),
      });
      this.pool = pool;
      pool.on('error', (error: Error) => {
        const safe = sanitizeDatabaseError(error, this.url);
        serverLog(`database pool error: ${safe.message}`, 'error');
      });
      const client = await pool.connect();
      try {
        await this.prepare(client);
        const result = await runMigrations(asQueryable(client), MIGRATIONS);
        this.applied = result.applied;
      } finally {
        client.release();
      }
      this.state = 'ready';
      serverLog(
        `database: ready deployment=${this.deploymentId} poolMax=${this.poolMax} applied=${this.applied.join(',') || 'none'}`,
      );
    } catch (error) {
      this.pool = undefined;
      this.state = 'closed';
      await pool?.end().catch(() => undefined);
      throw sanitizeDatabaseError(error, this.url);
    }
  }

  async close(): Promise<void> {
    if (this.state === 'idle') {
      this.state = 'closed';
      return;
    }
    if (this.state === 'closed') return;
    const pool = this.pool;
    this.pool = undefined;
    this.state = 'closed';
    if (!pool) return;
    try {
      await pool.end();
    } catch (error) {
      throw sanitizeDatabaseError(error, this.url);
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>> {
    const pool = this.requirePool();
    const client = await this.connect(pool);
    try {
      await this.prepare(client);
      const result = await client.query(sql, params ? [...params] : undefined);
      return mapResult<T>(result);
    } catch (error) {
      throw preserveOrSanitize(error, this.url);
    } finally {
      client.release();
    }
  }

  /**
   * One pooled client, one BEGIN/COMMIT. The callback must use `tx` for every
   * statement that belongs to the operation. A later pool query would be a
   * different connection and would not see uncommitted rows.
   */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const pool = this.requirePool();
    const client = await this.connect(pool);
    try {
      await this.prepare(client);
      const tx = asQueryable(client);
      await tx.query('BEGIN');
      try {
        const result = await fn(tx);
        await tx.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await tx.query('ROLLBACK');
        } catch (rollbackError) {
          const original = sanitizeDatabaseError(error, this.url).message;
          const rollbackText = sanitizeDatabaseError(rollbackError, this.url).message;
          throw new Error(`rollback failed (${rollbackText}) after ${original}`);
        }
        throw preserveOrSanitize(error, this.url);
      }
    } catch (error) {
      throw preserveOrSanitize(error, this.url);
    } finally {
      client.release();
    }
  }

  private async connect(pool: Pool): Promise<PoolClient> {
    try {
      return await pool.connect();
    } catch (error) {
      throw preserveOrSanitize(error, this.url);
    }
  }

  private requirePool(): Pool {
    if (this.state === 'closed') throw new DatabaseClosedError();
    if (!this.pool || this.state !== 'ready') throw new DatabaseNotReadyError();
    return this.pool;
  }

  private async prepare(client: PoolClient): Promise<void> {
    if (!this.searchPath) return;
    await client.query(`SET search_path TO "${this.searchPath}"`);
  }
}

export function createDatabase(config: ServerConfig): Database {
  if (!config.database.enabled) return new DisabledDatabase();
  return new PostgresDatabase({
    url: config.database.url,
    deploymentId: config.database.deploymentId,
    poolMax: config.database.poolMax,
  });
}
