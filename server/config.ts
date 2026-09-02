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

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
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
}

function integerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function firstNonEmptyEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value) return value;
  }
  return undefined;
}

export function isWildcardBindHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

/** Host used by local clients when the process binds a wildcard interface. */
export function connectableServerHost(bindHost: string): string {
  return isWildcardBindHost(bindHost) ? DEFAULT_SERVER_HOST : bindHost;
}

/**
 * Bind host. Canonical: `FC_SERVER_HOST`. Aliases `FC_HOST` / `HOST` remain.
 * Default `127.0.0.1` keeps the process loopback-only. LAN/VPN QA uses `0.0.0.0`.
 */
export function resolveServerHost(env: NodeJS.ProcessEnv = process.env): string {
  return firstNonEmptyEnv(env, ['FC_SERVER_HOST', 'FC_HOST', 'HOST']) ?? DEFAULT_SERVER_HOST;
}

/**
 * Host/port/paths come from env. Never bake a machine-specific path or public IP
 * into gameplay code — VPS migration is a config change.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const host = resolveServerHost(env);
  const worldId = (env.WORLD || env.FC_WORLD || DEFAULT_WORLD_ID).trim() || DEFAULT_WORLD_ID;
  const dataDir = env.WORLD_PATH || env.FC_WORLD_PATH || `${cwd}/server/data/worlds`;
  return {
    host,
    port: integerEnv(env, 'PORT', integerEnv(env, 'FC_PORT', DEFAULT_SERVER_PORT, 0, 65535), 0, 65535),
    worldId,
    worldSeed: env.WORLD_SEED || env.FC_WORLD_SEED || ANARCHY_WORLD_SEED,
    dataDir,
    tickRate: integerEnv(env, 'TICK_RATE', integerEnv(env, 'FC_TICK_RATE', DEFAULT_TICK_RATE, 1, 60), 1, 60),
    chunkViewRadius: integerEnv(env, 'CHUNK_VIEW_RADIUS', integerEnv(env, 'FC_CHUNK_VIEW_RADIUS', DEFAULT_CHUNK_VIEW_RADIUS, 1, 8), 1, 8),
    maxPlayers: integerEnv(env, 'MAX_PLAYERS', integerEnv(env, 'FC_MAX_PLAYERS', DEFAULT_MAX_PLAYERS, 1, 1000), 1, 1000),
    serverName: env.SERVER_NAME || env.FC_SERVER_NAME || DEFAULT_SERVER_NAME,
    persistIntervalMs: integerEnv(env, 'PERSIST_INTERVAL_MS', 30_000, 1_000, 300_000),
    pluginDir: env.PLUGIN_DIR || env.FC_PLUGIN_DIR || `${cwd}/server/plugins`,
    operators: (env.FC_OPERATORS || env.OPERATORS || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    loadExamplePlugin: env.FC_EXAMPLE_PLUGIN === '1' || env.FC_EXAMPLE_PLUGIN === 'true',
  };
}

export function worldDirectory(config: ServerConfig): string {
  return `${config.dataDir.replace(/\\/g, '/')}/${config.worldId}`;
}
