import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig, type ServerConfig } from '../../server/config';
import type { Database, DbQueryResult } from '../../server/db/types';
import { WORLD_LOCK_FILE } from '../../server/worldLock';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

class FakeDatabase implements Database {
  readonly enabled = true;
  readonly deploymentId = 'dev';
  readonly appliedMigrations: readonly string[] = [];
  closes = 0;
  queries = 0;
  readyAtStart: string | undefined;
  fail = false;

  constructor(private readonly readyState: () => string) {}

  async start(): Promise<void> {
    this.readyAtStart = this.readyState();
    if (this.fail) throw new Error('database unreachable');
  }

  async close(): Promise<void> {
    this.closes += 1;
  }

  async query<T = Record<string, unknown>>(): Promise<DbQueryResult<T>> {
    this.queries += 1;
    throw new Error('unexpected query');
  }

  async transaction(): Promise<never> {
    this.queries += 1;
    throw new Error('unexpected transaction');
  }
}

function testConfig(dataDir: string): ServerConfig {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'db-life',
      MAX_PLAYERS: '4',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
      FC_NO_BUILTIN_PLUGINS: '1',
      PLUGIN_DIR: join(dataDir, 'plugins'),
    }),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    loadBuiltinPlugins: false,
    pluginDir: join(dataDir, 'plugins'),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('database lifecycle', () => {
  const dirs: string[] = [];
  const servers: AnarchyServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.stop().catch(() => undefined);
    }
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('starts the database before the world is ready and leaves /status unchanged', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-db-life-'));
    dirs.push(dataDir);
    let server: AnarchyServer | undefined;
    const fake = new FakeDatabase(() => server?.world.readyState ?? 'MISSING');
    server = new AnarchyServer(testConfig(dataDir), { database: fake });
    servers.push(server);
    await server.start();
    expect(fake.readyAtStart).toBe('UNINITIALIZED');
    expect(server.world.readyState).toBe('READY');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fake.queries).toBe(0);
    const response = await fetch(`http://127.0.0.1:${server.port}/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'maxPlayers', 'mode', 'name', 'online', 'ready', 'tickRate', 'world',
    ]);
    expect(body.ready).toBe(true);
    expect(body.world).toBe('db-life');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/database|postgres|password|deployment/i);
    await server.stop();
    await server.stop();
    expect(fake.closes).toBeGreaterThanOrEqual(2);
    expect(await exists(join(dataDir, 'db-life', WORLD_LOCK_FILE))).toBe(false);
  }, 60_000);

  it('releases the world lock when database startup fails and allows a second stop', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-db-fail-'));
    dirs.push(dataDir);
    let server: AnarchyServer | undefined;
    const fake = new FakeDatabase(() => server?.world.readyState ?? 'MISSING');
    fake.fail = true;
    server = new AnarchyServer(testConfig(dataDir), { database: fake });
    servers.push(server);
    await expect(server.start()).rejects.toThrow(/database unreachable/);
    expect(fake.readyAtStart).toBe('UNINITIALIZED');
    expect(fake.closes).toBeGreaterThanOrEqual(1);
    expect(fake.queries).toBe(0);
    const lockPath = join(dataDir, 'db-life', WORLD_LOCK_FILE);
    expect(await exists(lockPath)).toBe(false);
    await server.stop();
    await server.stop();
    expect(await exists(lockPath)).toBe(false);
  }, 30_000);

  it('does not query PostgreSQL from the gameplay tick methods', async () => {
    const source = await readFile(join(ROOT, 'server/WorldInstance.ts'), 'utf8');
    const region = (start: string, end: string): string => {
      const from = source.indexOf(start);
      const to = source.indexOf(end, from + start.length);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      return source.slice(from, to);
    };
    const bodies = [
      region('  tick(): void {', '  tickCatchUp(count: number): void {'),
      region('  tickCatchUp(count: number): void {', '  private clearAppliedSteps(): void {'),
      region('  private simulateGameplayTick(): void {', '  private finishRtpSearches(): void {'),
    ];
    for (const body of bodies) {
      expect(body).not.toContain('this.database');
      expect(body).not.toContain('.query(');
    }
  });
});
