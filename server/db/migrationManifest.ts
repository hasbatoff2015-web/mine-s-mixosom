import { createHash } from 'node:crypto';

export interface Migration {
  readonly version: string;
  readonly name: string;
  /** One SQL statement each. The runner executes them in order inside one transaction. */
  readonly statements: readonly string[];
}

/**
 * Session advisory lock shared by Anarchy, Survival, and Peaceful.
 * The two int4 keys are the big-endian bytes of "FCDB" and "MIG1".
 * Both fit in signed int32.
 */
export const MIGRATION_ADVISORY_LOCK_KEY: readonly [number, number] = [1178813506, 1296647985];

export const ADVISORY_LOCK_SQL = 'SELECT pg_advisory_lock($1, $2)';
export const ADVISORY_UNLOCK_SQL = 'SELECT pg_advisory_unlock($1, $2)';

export const SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schema_migrations_version_nonempty CHECK (length(btrim(version)) > 0),
  CONSTRAINT schema_migrations_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT schema_migrations_checksum_nonempty CHECK (length(btrim(checksum)) > 0)
)`;

export const SELECT_MIGRATIONS_SQL = 'SELECT version, name, checksum FROM schema_migrations ORDER BY version';
export const INSERT_MIGRATION_SQL = 'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)';

/**
 * Foundation tables only. Later migrations may ALTER these tables.
 * Row UPDATE/DELETE on admin_audit_log is rejected by trigger, which does not
 * block a future migration from dropping that trigger, changing columns, and
 * installing it again.
 */
const ADMIN_AUDIT_LOG_SQL = `CREATE TABLE admin_audit_log (
  event_id UUID PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NULL,
  reason TEXT NOT NULL,
  server_mode TEXT NULL,
  world_id TEXT NULL,
  success BOOLEAN NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_audit_log_deployment_id_nonempty CHECK (length(btrim(deployment_id)) > 0),
  CONSTRAINT admin_audit_log_request_scope UNIQUE (deployment_id, request_id),
  CONSTRAINT admin_audit_log_admin_id_nonempty CHECK (length(btrim(admin_id)) > 0),
  CONSTRAINT admin_audit_log_action_nonempty CHECK (length(btrim(action)) > 0),
  CONSTRAINT admin_audit_log_target_type_nonempty CHECK (length(btrim(target_type)) > 0),
  CONSTRAINT admin_audit_log_reason_nonempty CHECK (length(btrim(reason)) > 0),
  CONSTRAINT admin_audit_log_admin_id_len CHECK (char_length(admin_id) <= 128),
  CONSTRAINT admin_audit_log_action_len CHECK (char_length(action) <= 200),
  CONSTRAINT admin_audit_log_target_type_len CHECK (char_length(target_type) <= 128),
  CONSTRAINT admin_audit_log_target_id_len CHECK (target_id IS NULL OR char_length(target_id) <= 256),
  CONSTRAINT admin_audit_log_reason_len CHECK (char_length(reason) <= 4000),
  CONSTRAINT admin_audit_log_server_mode_len CHECK (server_mode IS NULL OR char_length(server_mode) <= 32),
  CONSTRAINT admin_audit_log_world_id_len CHECK (world_id IS NULL OR char_length(world_id) <= 128)
)`;

const ADMIN_AUDIT_INDEX_SQL = `CREATE INDEX admin_audit_log_deployment_created_idx
  ON admin_audit_log (deployment_id, created_at)`;

const ADMIN_AUDIT_FUNCTION_SQL = `CREATE FUNCTION admin_audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $audit$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$audit$`;

const ADMIN_AUDIT_UPDATE_TRIGGER_SQL = `CREATE TRIGGER admin_audit_log_no_update
BEFORE UPDATE ON admin_audit_log
FOR EACH ROW
EXECUTE PROCEDURE admin_audit_log_reject_mutation()`;

const ADMIN_AUDIT_DELETE_TRIGGER_SQL = `CREATE TRIGGER admin_audit_log_no_delete
BEFORE DELETE ON admin_audit_log
FOR EACH ROW
EXECUTE PROCEDURE admin_audit_log_reject_mutation()`;

const ADMIN_AUDIT_TRUNCATE_TRIGGER_SQL = `CREATE TRIGGER admin_audit_log_no_truncate
BEFORE TRUNCATE ON admin_audit_log
FOR EACH STATEMENT
EXECUTE PROCEDURE admin_audit_log_reject_mutation()`;

const IDEMPOTENCY_SQL = `CREATE TABLE idempotency_requests (
  deployment_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  operation TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  response JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ NULL,
  PRIMARY KEY (deployment_id, request_id),
  CONSTRAINT idempotency_requests_deployment_nonempty CHECK (length(btrim(deployment_id)) > 0),
  CONSTRAINT idempotency_requests_operation_nonempty CHECK (length(btrim(operation)) > 0),
  CONSTRAINT idempotency_requests_actor_nonempty CHECK (length(btrim(actor_id)) > 0),
  CONSTRAINT idempotency_requests_hash_sha256 CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_requests_state_check CHECK (state IN ('in_progress', 'committed')),
  CONSTRAINT idempotency_requests_commit_shape CHECK (
    (state = 'in_progress' AND committed_at IS NULL)
    OR (state = 'committed' AND committed_at IS NOT NULL)
  ),
  CONSTRAINT idempotency_requests_operation_len CHECK (char_length(operation) <= 200),
  CONSTRAINT idempotency_requests_actor_len CHECK (char_length(actor_id) <= 128)
)`;

/**
 * event_id stays the primary key. request_id is the logical request and may
 * appear on more than one immutable attempt (failure, then a later success).
 */
const ADMIN_AUDIT_DROP_REQUEST_UNIQUE_SQL = `ALTER TABLE admin_audit_log
  DROP CONSTRAINT admin_audit_log_request_scope`;

const ADMIN_AUDIT_REQUEST_INDEX_SQL = `CREATE INDEX admin_audit_log_request_created_idx
  ON admin_audit_log (deployment_id, request_id, created_at)`;

/**
 * Megacoins are exact integers. 999999999 is ECONOMY_MAX_BALANCE.
 * Accounts are mutable. Operations and ledger rows are append-only.
 */
const ECONOMY_ACCOUNTS_SQL = `CREATE TABLE economy_accounts (
  deployment_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  balance BIGINT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deployment_id, player_id),
  CONSTRAINT economy_accounts_deployment_nonempty CHECK (length(btrim(deployment_id)) > 0),
  CONSTRAINT economy_accounts_player_nonempty CHECK (length(btrim(player_id)) > 0),
  CONSTRAINT economy_accounts_player_len CHECK (char_length(player_id) <= 128),
  CONSTRAINT economy_accounts_display_name_nonempty CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT economy_accounts_display_name_len CHECK (char_length(display_name) <= 64),
  CONSTRAINT economy_accounts_balance_range CHECK (balance >= 0 AND balance <= 999999999)
)`;

const ECONOMY_OPERATIONS_SQL = `CREATE TABLE economy_operations (
  deployment_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT NULL,
  source_type TEXT NULL,
  source_id TEXT NULL,
  request_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deployment_id, operation_id),
  CONSTRAINT economy_operations_deployment_nonempty CHECK (length(btrim(deployment_id)) > 0),
  CONSTRAINT economy_operations_kind_check CHECK (kind IN ('INITIAL', 'SOURCE', 'TRANSFER', 'SINK', 'ADJUSTMENT')),
  CONSTRAINT economy_operations_actor_len CHECK (actor_id IS NULL OR (length(btrim(actor_id)) > 0 AND char_length(actor_id) <= 128)),
  CONSTRAINT economy_operations_source_pair CHECK (
    (source_type IS NULL AND source_id IS NULL)
    OR (source_type IS NOT NULL AND source_id IS NOT NULL)
  ),
  CONSTRAINT economy_operations_source_type_len CHECK (
    source_type IS NULL OR (length(btrim(source_type)) > 0 AND char_length(source_type) <= 64)
  ),
  CONSTRAINT economy_operations_source_id_len CHECK (
    source_id IS NULL OR (length(btrim(source_id)) > 0 AND char_length(source_id) <= 256)
  )
)`;

const ECONOMY_OPERATIONS_SOURCE_INDEX_SQL = `CREATE UNIQUE INDEX economy_operations_source_uidx
  ON economy_operations (deployment_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL`;

const ECONOMY_OPERATIONS_REQUEST_INDEX_SQL = `CREATE INDEX economy_operations_request_idx
  ON economy_operations (deployment_id, request_id)
  WHERE request_id IS NOT NULL`;

const ECONOMY_LEDGER_SQL = `CREATE TABLE economy_ledger (
  entry_id UUID PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  leg_index SMALLINT NOT NULL,
  player_id TEXT NOT NULL,
  delta BIGINT NOT NULL,
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reason TEXT NOT NULL,
  counterparty_player_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT economy_ledger_operation_fk
    FOREIGN KEY (deployment_id, operation_id)
    REFERENCES economy_operations (deployment_id, operation_id),
  CONSTRAINT economy_ledger_leg_unique UNIQUE (deployment_id, operation_id, leg_index),
  CONSTRAINT economy_ledger_deployment_nonempty CHECK (length(btrim(deployment_id)) > 0),
  CONSTRAINT economy_ledger_leg_index_nonnegative CHECK (leg_index >= 0),
  CONSTRAINT economy_ledger_delta_nonzero CHECK (delta <> 0),
  CONSTRAINT economy_ledger_before_nonnegative CHECK (balance_before >= 0),
  CONSTRAINT economy_ledger_after_range CHECK (balance_after >= 0 AND balance_after <= 999999999),
  CONSTRAINT economy_ledger_equation CHECK (balance_after = balance_before + delta),
  CONSTRAINT economy_ledger_player_nonempty CHECK (length(btrim(player_id)) > 0),
  CONSTRAINT economy_ledger_player_len CHECK (char_length(player_id) <= 128),
  CONSTRAINT economy_ledger_reason_nonempty CHECK (length(btrim(reason)) > 0),
  CONSTRAINT economy_ledger_reason_len CHECK (char_length(reason) <= 64),
  CONSTRAINT economy_ledger_counterparty_len CHECK (
    counterparty_player_id IS NULL OR (length(btrim(counterparty_player_id)) > 0 AND char_length(counterparty_player_id) <= 128)
  )
)`;

const ECONOMY_LEDGER_PLAYER_INDEX_SQL = `CREATE INDEX economy_ledger_player_created_idx
  ON economy_ledger (deployment_id, player_id, created_at DESC, entry_id DESC)`;

const ECONOMY_APPEND_ONLY_FUNCTION_SQL = `CREATE FUNCTION economy_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $econ$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$econ$`;

const ECONOMY_LEDGER_UPDATE_TRIGGER_SQL = `CREATE TRIGGER economy_ledger_no_update
BEFORE UPDATE ON economy_ledger
FOR EACH ROW
EXECUTE PROCEDURE economy_reject_mutation()`;

const ECONOMY_LEDGER_DELETE_TRIGGER_SQL = `CREATE TRIGGER economy_ledger_no_delete
BEFORE DELETE ON economy_ledger
FOR EACH ROW
EXECUTE PROCEDURE economy_reject_mutation()`;

const ECONOMY_LEDGER_TRUNCATE_TRIGGER_SQL = `CREATE TRIGGER economy_ledger_no_truncate
BEFORE TRUNCATE ON economy_ledger
FOR EACH STATEMENT
EXECUTE PROCEDURE economy_reject_mutation()`;

const ECONOMY_OPERATIONS_UPDATE_TRIGGER_SQL = `CREATE TRIGGER economy_operations_no_update
BEFORE UPDATE ON economy_operations
FOR EACH ROW
EXECUTE PROCEDURE economy_reject_mutation()`;

const ECONOMY_OPERATIONS_DELETE_TRIGGER_SQL = `CREATE TRIGGER economy_operations_no_delete
BEFORE DELETE ON economy_operations
FOR EACH ROW
EXECUTE PROCEDURE economy_reject_mutation()`;

const ECONOMY_OPERATIONS_TRUNCATE_TRIGGER_SQL = `CREATE TRIGGER economy_operations_no_truncate
BEFORE TRUNCATE ON economy_operations
FOR EACH STATEMENT
EXECUTE PROCEDURE economy_reject_mutation()`;

/**
 * Gameplay Megacoins are one wallet per server mode.
 * Rows written before this migration have no mode, so they stay in `legacy_global`.
 * Adding the column with a constant default does not rewrite rows and does not
 * fire the append-only triggers. No balance is minted or deleted.
 */
const ECONOMY_SCOPE_CHECK = `IN ('anarchy', 'survival', 'peaceful', 'legacy_global')`;

const ECONOMY_ACCOUNTS_ADD_SCOPE_SQL = `ALTER TABLE economy_accounts
  ADD COLUMN economy_scope TEXT NOT NULL DEFAULT 'legacy_global'`;

const ECONOMY_ACCOUNTS_DROP_SCOPE_DEFAULT_SQL = `ALTER TABLE economy_accounts
  ALTER COLUMN economy_scope DROP DEFAULT`;

const ECONOMY_ACCOUNTS_SCOPE_CHECK_SQL = `ALTER TABLE economy_accounts
  ADD CONSTRAINT economy_accounts_scope_check CHECK (economy_scope ${ECONOMY_SCOPE_CHECK})`;

const ECONOMY_ACCOUNTS_DROP_PKEY_SQL = `ALTER TABLE economy_accounts
  DROP CONSTRAINT economy_accounts_pkey`;

const ECONOMY_ACCOUNTS_ADD_PKEY_SQL = `ALTER TABLE economy_accounts
  ADD PRIMARY KEY (deployment_id, economy_scope, player_id)`;

const ECONOMY_OPERATIONS_ADD_SCOPE_SQL = `ALTER TABLE economy_operations
  ADD COLUMN economy_scope TEXT NOT NULL DEFAULT 'legacy_global'`;

const ECONOMY_OPERATIONS_DROP_SCOPE_DEFAULT_SQL = `ALTER TABLE economy_operations
  ALTER COLUMN economy_scope DROP DEFAULT`;

const ECONOMY_OPERATIONS_SCOPE_CHECK_SQL = `ALTER TABLE economy_operations
  ADD CONSTRAINT economy_operations_scope_check CHECK (economy_scope ${ECONOMY_SCOPE_CHECK})`;

const ECONOMY_LEDGER_DROP_OPERATION_FK_SQL = `ALTER TABLE economy_ledger
  DROP CONSTRAINT economy_ledger_operation_fk`;

const ECONOMY_OPERATIONS_DROP_PKEY_SQL = `ALTER TABLE economy_operations
  DROP CONSTRAINT economy_operations_pkey`;

const ECONOMY_OPERATIONS_ADD_PKEY_SQL = `ALTER TABLE economy_operations
  ADD PRIMARY KEY (deployment_id, economy_scope, operation_id)`;

const ECONOMY_OPERATIONS_DROP_SOURCE_INDEX_SQL = `DROP INDEX economy_operations_source_uidx`;

const ECONOMY_OPERATIONS_SOURCE_SCOPE_INDEX_SQL = `CREATE UNIQUE INDEX economy_operations_source_uidx
  ON economy_operations (deployment_id, economy_scope, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL`;

const ECONOMY_OPERATIONS_DROP_REQUEST_INDEX_SQL = `DROP INDEX economy_operations_request_idx`;

const ECONOMY_OPERATIONS_REQUEST_SCOPE_INDEX_SQL = `CREATE INDEX economy_operations_request_idx
  ON economy_operations (deployment_id, economy_scope, request_id)
  WHERE request_id IS NOT NULL`;

const ECONOMY_LEDGER_ADD_SCOPE_SQL = `ALTER TABLE economy_ledger
  ADD COLUMN economy_scope TEXT NOT NULL DEFAULT 'legacy_global'`;

const ECONOMY_LEDGER_DROP_SCOPE_DEFAULT_SQL = `ALTER TABLE economy_ledger
  ALTER COLUMN economy_scope DROP DEFAULT`;

const ECONOMY_LEDGER_SCOPE_CHECK_SQL = `ALTER TABLE economy_ledger
  ADD CONSTRAINT economy_ledger_scope_check CHECK (economy_scope ${ECONOMY_SCOPE_CHECK})`;

const ECONOMY_LEDGER_DROP_LEG_UNIQUE_SQL = `ALTER TABLE economy_ledger
  DROP CONSTRAINT economy_ledger_leg_unique`;

const ECONOMY_LEDGER_ADD_LEG_UNIQUE_SQL = `ALTER TABLE economy_ledger
  ADD CONSTRAINT economy_ledger_leg_unique UNIQUE (deployment_id, economy_scope, operation_id, leg_index)`;

const ECONOMY_LEDGER_ADD_OPERATION_FK_SQL = `ALTER TABLE economy_ledger
  ADD CONSTRAINT economy_ledger_operation_fk
  FOREIGN KEY (deployment_id, economy_scope, operation_id)
  REFERENCES economy_operations (deployment_id, economy_scope, operation_id)`;

const ECONOMY_LEDGER_DROP_PLAYER_INDEX_SQL = `DROP INDEX economy_ledger_player_created_idx`;

const ECONOMY_LEDGER_PLAYER_SCOPE_INDEX_SQL = `CREATE INDEX economy_ledger_player_created_idx
  ON economy_ledger (deployment_id, economy_scope, player_id, created_at DESC, entry_id DESC)`;

/**
 * Request idempotency is a namespace, not a gameplay wallet.
 * Rows from before this migration were deployment-global, so they stay `global`.
 * Adding the column with a constant default does not rewrite the stored response.
 */
const IDEMPOTENCY_ADD_SCOPE_SQL = `ALTER TABLE idempotency_requests
  ADD COLUMN request_scope TEXT NOT NULL DEFAULT 'global'`;

const IDEMPOTENCY_DROP_SCOPE_DEFAULT_SQL = `ALTER TABLE idempotency_requests
  ALTER COLUMN request_scope DROP DEFAULT`;

const IDEMPOTENCY_SCOPE_CHECK_SQL = `ALTER TABLE idempotency_requests
  ADD CONSTRAINT idempotency_requests_scope_check CHECK (
    length(btrim(request_scope)) > 0 AND char_length(request_scope) <= 64
  )`;

const IDEMPOTENCY_DROP_PKEY_SQL = `ALTER TABLE idempotency_requests
  DROP CONSTRAINT idempotency_requests_pkey`;

const IDEMPOTENCY_ADD_PKEY_SQL = `ALTER TABLE idempotency_requests
  ADD PRIMARY KEY (deployment_id, request_scope, request_id)`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: '0001',
    name: 'admin_audit_and_idempotency',
    statements: [
      ADMIN_AUDIT_LOG_SQL,
      ADMIN_AUDIT_INDEX_SQL,
      ADMIN_AUDIT_FUNCTION_SQL,
      ADMIN_AUDIT_UPDATE_TRIGGER_SQL,
      ADMIN_AUDIT_DELETE_TRIGGER_SQL,
      ADMIN_AUDIT_TRUNCATE_TRIGGER_SQL,
      IDEMPOTENCY_SQL,
    ],
  },
  {
    version: '0002',
    name: 'admin_audit_request_attempts',
    statements: [
      ADMIN_AUDIT_DROP_REQUEST_UNIQUE_SQL,
      ADMIN_AUDIT_REQUEST_INDEX_SQL,
    ],
  },
  {
    version: '0003',
    name: 'megacoin_ledger',
    statements: [
      ECONOMY_ACCOUNTS_SQL,
      ECONOMY_OPERATIONS_SQL,
      ECONOMY_OPERATIONS_SOURCE_INDEX_SQL,
      ECONOMY_OPERATIONS_REQUEST_INDEX_SQL,
      ECONOMY_LEDGER_SQL,
      ECONOMY_LEDGER_PLAYER_INDEX_SQL,
      ECONOMY_APPEND_ONLY_FUNCTION_SQL,
      ECONOMY_LEDGER_UPDATE_TRIGGER_SQL,
      ECONOMY_LEDGER_DELETE_TRIGGER_SQL,
      ECONOMY_LEDGER_TRUNCATE_TRIGGER_SQL,
      ECONOMY_OPERATIONS_UPDATE_TRIGGER_SQL,
      ECONOMY_OPERATIONS_DELETE_TRIGGER_SQL,
      ECONOMY_OPERATIONS_TRUNCATE_TRIGGER_SQL,
    ],
  },
  {
    version: '0004',
    name: 'gameplay_economy_scope',
    statements: [
      ECONOMY_ACCOUNTS_ADD_SCOPE_SQL,
      ECONOMY_ACCOUNTS_DROP_SCOPE_DEFAULT_SQL,
      ECONOMY_ACCOUNTS_SCOPE_CHECK_SQL,
      ECONOMY_ACCOUNTS_DROP_PKEY_SQL,
      ECONOMY_ACCOUNTS_ADD_PKEY_SQL,
      ECONOMY_OPERATIONS_ADD_SCOPE_SQL,
      ECONOMY_OPERATIONS_DROP_SCOPE_DEFAULT_SQL,
      ECONOMY_OPERATIONS_SCOPE_CHECK_SQL,
      ECONOMY_LEDGER_DROP_OPERATION_FK_SQL,
      ECONOMY_OPERATIONS_DROP_PKEY_SQL,
      ECONOMY_OPERATIONS_ADD_PKEY_SQL,
      ECONOMY_OPERATIONS_DROP_SOURCE_INDEX_SQL,
      ECONOMY_OPERATIONS_SOURCE_SCOPE_INDEX_SQL,
      ECONOMY_OPERATIONS_DROP_REQUEST_INDEX_SQL,
      ECONOMY_OPERATIONS_REQUEST_SCOPE_INDEX_SQL,
      ECONOMY_LEDGER_ADD_SCOPE_SQL,
      ECONOMY_LEDGER_DROP_SCOPE_DEFAULT_SQL,
      ECONOMY_LEDGER_SCOPE_CHECK_SQL,
      ECONOMY_LEDGER_DROP_LEG_UNIQUE_SQL,
      ECONOMY_LEDGER_ADD_LEG_UNIQUE_SQL,
      ECONOMY_LEDGER_ADD_OPERATION_FK_SQL,
      ECONOMY_LEDGER_DROP_PLAYER_INDEX_SQL,
      ECONOMY_LEDGER_PLAYER_SCOPE_INDEX_SQL,
    ],
  },
  {
    version: '0005',
    name: 'idempotency_request_scope',
    statements: [
      IDEMPOTENCY_ADD_SCOPE_SQL,
      IDEMPOTENCY_DROP_SCOPE_DEFAULT_SQL,
      IDEMPOTENCY_SCOPE_CHECK_SQL,
      IDEMPOTENCY_DROP_PKEY_SQL,
      IDEMPOTENCY_ADD_PKEY_SQL,
    ],
  },
];

export function migrationSql(migration: Migration): string {
  return migration.statements.map((statement) => statement.trim()).join('\n\n');
}

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migrationSql(migration), 'utf8').digest('hex');
}

export function assertMigrationManifest(migrations: readonly Migration[]): void {
  const versions = new Set<string>();
  const names = new Set<string>();
  let previous = '';
  for (const migration of migrations) {
    if (!/^[0-9]{4}$/.test(migration.version)) {
      throw new Error(`migration version must be four digits, got "${migration.version}"`);
    }
    if (previous && migration.version <= previous) {
      throw new Error(`migration ${migration.version} is out of order`);
    }
    previous = migration.version;
    if (versions.has(migration.version)) throw new Error(`duplicate migration version ${migration.version}`);
    versions.add(migration.version);
    if (!/^[a-z0-9_]+$/.test(migration.name)) {
      throw new Error(`migration ${migration.version} has an invalid name`);
    }
    if (names.has(migration.name)) throw new Error(`duplicate migration name ${migration.name}`);
    names.add(migration.name);
    if (migration.statements.length === 0 || migration.statements.some((statement) => statement.trim() === '')) {
      throw new Error(`migration ${migration.version} has no SQL`);
    }
  }
}

assertMigrationManifest(MIGRATIONS);
