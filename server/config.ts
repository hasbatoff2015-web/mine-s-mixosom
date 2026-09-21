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
