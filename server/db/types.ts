/**
 * Transaction-scoped and pool-level query surface.
 * Callers pass parameters. SQL text in services is a static statement, not a
 * concatenation of admin or player input.
 */
export interface DbQueryResult<T = Record<string, unknown>> {
  readonly rows: T[];
  readonly rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>>;
}

/**
 * PostgreSQL is optional infrastructure. World snapshots never go through this.
 * `transaction` must run the callback on one connection between BEGIN and COMMIT.
 */
export interface Database extends Queryable {
  readonly enabled: boolean;
  readonly deploymentId: string | null;
  readonly appliedMigrations: readonly string[];
  start(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
