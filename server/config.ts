import { parseAdminAuthHashes, type AdminCredential } from './admin/credentials';
import { ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';
import {
  DEFAULT_CHUNK_VIEW_RADIUS,
  DEFAULT_MAX_PLAYERS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_NAME,
  DEFAULT_SERVER_PORT,
  DEFAULT_TICK_RATE,
  DEFAULT_WORLD_ID,
} from '../shared/config';

export const SERVER_MODES = ['anarchy', 'survival', 'peaceful'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];

const DEFAULT_SERVER_NAMES: Record<ServerMode, string> = {
  anarchy: DEFAULT_SERVER_NAME,
  survival: 'Frontier Cubes Survival',
  peaceful: 'Frontier Cubes Peaceful',
};

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly serverMode: ServerMode;
  readonly worldId: string;
  readonly worldSeed: string;
  readonly dataDir: string;
  readonly tickRate: number;
  readonly chunkViewRadius: number;
  readonly maxPlayers: number;
  readonly serverName: string;
  readonly persistIntervalMs: number;
  readonly pluginDir: string;
  readonly operators: readonly string[];
  /** When true, register `server/plugin-examples/hello.ts` without copying it into pluginDir. */
  readonly loadExamplePlugin: boolean;
  /** Core plugins (permissions, TPA, home, …). Default on for every server mode. */
  readonly loadBuiltinPlugins: boolean;
  /**
   * Optional PostgreSQL for audit and idempotency.
   * Voxel world snapshots stay on the filesystem either way.
   */
  readonly database: DatabaseConfig;
  /**
   * `legacy_json` keeps the synchronous JSON wallet.
   * `postgres` makes PostgreSQL the only currency authority.
   * It is not a fallback when a query fails.
   */
  readonly economy: EconomyBackendConfig;
  /** Exactly two equal admin ids, or disabled when FC_ADMIN_IDS is blank. */
  readonly adminIdentity: AdminIdentityConfig;
  /**
   * Private loopback admin HTTP. Disabled when FC_ADMIN_PORT is blank.
   * The public gameplay listener never serves these routes.
   */
  readonly adminHttp: AdminHttpConfig;
}

export type EconomyBackendConfig =
  | { readonly backend: 'legacy_json' }
  | { readonly backend: 'postgres' };

/**
 * Missing or blank stays on the JSON wallet so existing processes keep working.
 * `postgres` requires FC_DATABASE_URL. A failed database does not fall back.
 */
export function loadEconomyBackendConfig(env: NodeJS.ProcessEnv, database: DatabaseConfig): EconomyBackendConfig {
  const raw = env.FC_ECONOMY_BACKEND;
  if (raw === undefined || raw.trim() === '' || raw.trim() === 'legacy_json') return { backend: 'legacy_json' };
  if (raw.trim() !== 'postgres') {
    throw new Error('FC_ECONOMY_BACKEND must be legacy_json or postgres.');
  }
  if (!database.enabled) {
    throw new Error('FC_ECONOMY_BACKEND=postgres requires FC_DATABASE_URL and FC_DEPLOYMENT_ID.');
  }
  return { backend: 'postgres' };
}

/** One process default. Three game servers can run on one machine. */
export const DB_POOL_DEFAULT = 4;
export const DB_POOL_MIN = 1;
export const DB_POOL_MAX_LIMIT = 8;

const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ADMIN_ID = DEPLOYMENT_ID;

export type AdminIdentityConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly ids: readonly [string, string] };

export type AdminHttpConfig =
  | { readonly enabled: false }
  | {
    readonly enabled: true;
    readonly port: number;
    readonly credentials: readonly [AdminCredential, AdminCredential];
  };

/**
 * No port means no admin listener. A port requires both admin ids and two
 * unique SHA-256 credential digests. The listener still binds 127.0.0.1 only.
 */
export function loadAdminHttpConfig(env: NodeJS.ProcessEnv, identity: AdminIdentityConfig): AdminHttpConfig {
  const rawPort = env.FC_ADMIN_PORT;
  if (rawPort === undefined || rawPort.trim() === '') return { enabled: false };
  if (!identity.enabled) {
    throw new Error('FC_ADMIN_PORT requires FC_ADMIN_IDS with exactly two different ids.');
  }
  const portText = rawPort.trim();
  if (!/^[0-9]+$/.test(portText)) throw new Error('FC_ADMIN_PORT must be an integer from 1 to 65535.');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FC_ADMIN_PORT must be an integer from 1 to 65535.');
  }
  const rawHashes = env.FC_ADMIN_AUTH_HASHES;
  if (rawHashes === undefined || rawHashes.trim() === '') {
    throw new Error('FC_ADMIN_PORT requires FC_ADMIN_AUTH_HASHES for both admin ids.');
  }
  return {
    enabled: true,
    port,
    credentials: parseAdminAuthHashes(rawHashes.trim(), identity.ids),
  };
}

/**
 * Blank disables admin writes. A present value must be exactly two distinct ids.
 * These ids are not passwords and they are not game-operator names.
 */
export function loadAdminIdentityConfig(env: NodeJS.ProcessEnv): AdminIdentityConfig {
  const raw = env.FC_ADMIN_IDS;
  if (raw === undefined || raw.trim() === '') return { enabled: false };
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !ADMIN_ID.test(part))) {
    throw new Error('FC_ADMIN_IDS must be exactly two ids: letters, digits, ".", "_" or "-", 1-64 characters, comma-separated.');
  }
  if (parts[0] === parts[1]) throw new Error('FC_ADMIN_IDS must be two different ids.');
  return { enabled: true, ids: [parts[0]!, parts[1]!] };
}

export type DatabaseConfig =
  | { readonly enabled: false }
  | {
    readonly enabled: true;
    readonly url: string;
    readonly deploymentId: string;
    readonly poolMax: number;
  };

/**
 * Missing URL disables PostgreSQL with no connection attempt.
 * A present URL without a deployment id is rejected. Dev and prod are never inferred.
 */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const rawUrl = env.FC_DATABASE_URL;
  if (rawUrl === undefined || rawUrl.trim() === '') return { enabled: false };
  const url = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('FC_DATABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('FC_DATABASE_URL must use the postgres: or postgresql: scheme.');
  }
  const deploymentId = (env.FC_DEPLOYMENT_ID ?? '').trim();
  if (!deploymentId) throw new Error('FC_DEPLOYMENT_ID is required when FC_DATABASE_URL is set.');
  if (!DEPLOYMENT_ID.test(deploymentId)) {
    throw new Error('FC_DEPLOYMENT_ID must be 1-64 characters: letters, digits, ".", "_" or "-".');
  }
  return {
    enabled: true,
    url,
    deploymentId,
    poolMax: integerEnv(env, 'FC_DB_POOL_MAX', DB_POOL_DEFAULT, DB_POOL_MIN, DB_POOL_MAX_LIMIT),
  };
}

/** Log-safe description. Never includes the URL, username, or password. */
export function databaseLogLabel(database: DatabaseConfig): string {
  if (!database.enabled) return 'database: disabled';
  return `database: enabled deployment=${database.deploymentId} poolMax=${database.poolMax}`;
}

/**
 * Blank or missing mode stays Anarchy so `npm run dev:server` is unchanged.
 * Any other unknown value is rejected so a typo cannot silently enable PvP and explosions.
 */
export function parseServerMode(raw: string | undefined): ServerMode {
  if (raw === undefined || raw.trim() === '') return 'anarchy';
  const value = raw.trim().toLowerCase();
  if (value === 'anarchy' || value === 'survival' || value === 'peaceful') return value;
  throw new Error(`Invalid SERVER_MODE "${raw}". Expected anarchy, survival, or peaceful.`);
}

export function pvpAllowed(mode: ServerMode): boolean {
  return mode !== 'peaceful';
}

export function explosionsAllowed(mode: ServerMode): boolean {
  return mode === 'anarchy';
}

function integerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Host/port/paths come from env. Never bake a machine-specific path or public IP
 * into gameplay code — VPS migration is a config change.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const host = env.HOST || env.FC_HOST || DEFAULT_SERVER_HOST;
  const serverMode = parseServerMode(env.SERVER_MODE || env.FC_SERVER_MODE);
  const explicitWorld = env.WORLD || env.FC_WORLD;
  const worldId = (explicitWorld?.trim() || serverMode || DEFAULT_WORLD_ID).trim() || DEFAULT_WORLD_ID;
  const dataDir = env.WORLD_PATH || env.FC_WORLD_PATH || `${cwd}/server/data/worlds`;
  const adminIdentity = loadAdminIdentityConfig(env);
  return {
    host,
    port: integerEnv(env, 'PORT', integerEnv(env, 'FC_PORT', DEFAULT_SERVER_PORT, 0, 65535), 0, 65535),
    serverMode,
    worldId,
    worldSeed: env.WORLD_SEED || env.FC_WORLD_SEED || ANARCHY_WORLD_SEED,
    dataDir,
    tickRate: integerEnv(env, 'TICK_RATE', integerEnv(env, 'FC_TICK_RATE', DEFAULT_TICK_RATE, 1, 60), 1, 60),
    chunkViewRadius: integerEnv(env, 'CHUNK_VIEW_RADIUS', integerEnv(env, 'FC_CHUNK_VIEW_RADIUS', DEFAULT_CHUNK_VIEW_RADIUS, 1, 8), 1, 8),
    maxPlayers: integerEnv(env, 'MAX_PLAYERS', integerEnv(env, 'FC_MAX_PLAYERS', DEFAULT_MAX_PLAYERS, 1, 1000), 1, 1000),
    serverName: env.SERVER_NAME || env.FC_SERVER_NAME || DEFAULT_SERVER_NAMES[serverMode],
    persistIntervalMs: integerEnv(env, 'PERSIST_INTERVAL_MS', 30_000, 1_000, 300_000),
    pluginDir: env.PLUGIN_DIR || env.FC_PLUGIN_DIR || `${cwd}/server/plugins`,
    operators: (env.FC_OPERATORS || env.OPERATORS || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    loadExamplePlugin: env.FC_EXAMPLE_PLUGIN === '1' || env.FC_EXAMPLE_PLUGIN === 'true',
    loadBuiltinPlugins: env.FC_NO_BUILTIN_PLUGINS !== '1' && env.FC_NO_BUILTIN_PLUGINS !== 'true',
    database: loadDatabaseConfig(env),
    economy: loadEconomyBackendConfig(env, loadDatabaseConfig(env)),
    adminIdentity,
    adminHttp: loadAdminHttpConfig(env, adminIdentity),
  };
}

export function worldDirectory(config: ServerConfig): string {
  return `${config.dataDir.replace(/\\/g, '/')}/${config.worldId}`;
}

/** Throws when two configs would persist into the same directory. */
export function assertDistinctWorldDirectories(configs: readonly ServerConfig[]): void {
  const seen = new Map<string, string>();
  for (const config of configs) {
    const directory = worldDirectory(config);
    const owner = `${config.serverMode}/${config.worldId}`;
    const previous = seen.get(directory);
    if (previous) {
      throw new Error(`World directory ${directory} is shared by ${previous} and ${owner}.`);
    }
    seen.set(directory, owner);
  }
}
