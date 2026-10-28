import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { FsWorldStore } from '../../server/FsWorldStore';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig, type ServerConfig } from '../../server/config';
import type { Database, DbQueryResult, Queryable } from '../../server/db/types';
import { WORLD_LOCK_FILE } from '../../server/worldLock';
import { inventoryWithDiamond, sampleSnapshot } from '../persistFixture';

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

  async query<T = Record<string, unknown>>(sql?: string): Promise<DbQueryResult<T>> {
    this.queries += 1;
    if (sql?.includes('admin_player_bans')) return { rows: [], rowCount: 0 };
    throw new Error('unexpected query');
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    this.queries += 1;
    const tx: Queryable = {
      query: async <R = Record<string, unknown>>(sql?: string): Promise<DbQueryResult<R>> => {
        this.queries += 1;
        if (sql?.includes('admin_player_bans')) return { rows: [] as R[], rowCount: 0 };
        throw new Error('unexpected transaction');
      },
    };
    return fn(tx);
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

const CANONICAL_FILES = ['meta.json', 'world.json', 'players.json'] as const;

async function canonicalBytes(dir: string, worldId: string): Promise<Buffer[]> {
  return Promise.all(CANONICAL_FILES.map((name) => readFile(join(dir, worldId, name))));
}

async function seedAuthoritativeWorld(dataDir: string, worldId: string): Promise<void> {
  const store = new FsWorldStore(dataDir);
  const base = sampleSnapshot();
  await store.save(sampleSnapshot({
    summary: { ...base.summary, id: worldId, name: worldId, seed: 'canary-seed' },
    serverWorld: {
      id: worldId,
      initialized: true,
      spawnImported: true,
      importVersion: 3,
      spawn: [8.5, 64, 8.5],
    },
    modifications: { '4,5': { '11': BlockId.GoldBlock } },
    players: {
      'canary-player': {
        id: 'canary-player',
        name: 'PersistenceCanary',
        x: 123.25,
        y: 70,
        z: 56.5,
        yaw: 1.5,
        pitch: 0.25,
        health: 17,
        gamemode: 'survival',
        selectedSlot: 3,
        inventory: inventoryWithDiamond(),
        updatedAt: 424242,
      },
    },
  }));
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
    expect(server.world.isPersistenceReady).toBe(false);
    await server.start();
    expect(server.world.isPersistenceReady).toBe(true);
    expect(fake.readyAtStart).toBe('UNINITIALIZED');
    expect(server.world.readyState).toBe('READY');
    for (const name of CANONICAL_FILES) {
      expect(await exists(join(dataDir, 'db-life', name))).toBe(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fake.queries).toBe(2);
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
    expect(server.world.isPersistenceReady).toBe(false);
    expect(fake.readyAtStart).toBe('UNINITIALIZED');
    expect(fake.closes).toBeGreaterThanOrEqual(1);
    expect(fake.queries).toBe(0);
    const lockPath = join(dataDir, 'db-life', WORLD_LOCK_FILE);
    expect(await exists(lockPath)).toBe(false);
    await server.stop();
    await server.stop();
    expect(server.world.isPersistenceReady).toBe(false);
    expect(await exists(lockPath)).toBe(false);
    for (const name of CANONICAL_FILES) {
      expect(await exists(join(dataDir, 'db-life', name))).toBe(false);
    }
  }, 30_000);

  it('does not rewrite an existing world when startup fails before load', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-db-keep-'));
    dirs.push(dataDir);
    await seedAuthoritativeWorld(dataDir, 'db-life');
    const before = await canonicalBytes(dataDir, 'db-life');
    let server: AnarchyServer | undefined;
    const fake = new FakeDatabase(() => server?.world.readyState ?? 'MISSING');
    fake.fail = true;
    server = new AnarchyServer(testConfig(dataDir), { database: fake });
    servers.push(server);
    await expect(server.start()).rejects.toThrow(/database unreachable/);
    await server.stop();
    await server.stop();
    const after = await canonicalBytes(dataDir, 'db-life');
    expect(before[1]?.toString('utf8')).toContain(String(BlockId.GoldBlock));
    expect(before[2]?.toString('utf8')).toContain('PersistenceCanary');
    expect(after[0]?.equals(before[0] ?? Buffer.alloc(0))).toBe(true);
    expect(after[1]?.equals(before[1] ?? Buffer.alloc(0))).toBe(true);
    expect(after[2]?.equals(before[2] ?? Buffer.alloc(0))).toBe(true);
    expect(server.world.isPersistenceReady).toBe(false);
    expect(await exists(join(dataDir, 'db-life', WORLD_LOCK_FILE))).toBe(false);
  }, 30_000);

  it('does not replace a corrupt world with a fresh snapshot when load fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-db-corrupt-'));
    dirs.push(dataDir);
    const worldDir = join(dataDir, 'db-life');
    const meta = '{not-json';
    const world = 'CORRUPT-WORLD-MARKER';
    const players = 'CORRUPT-PLAYERS-MARKER';
    await mkdir(worldDir, { recursive: true });
    await writeFile(join(worldDir, 'meta.json'), meta, 'utf8');
    await writeFile(join(worldDir, 'world.json'), world, 'utf8');
    await writeFile(join(worldDir, 'players.json'), players, 'utf8');
    const server = new AnarchyServer(testConfig(dataDir));
    servers.push(server);
    await expect(server.start()).rejects.toThrow(/meta\.json|corrupt/i);
    expect(server.world.isPersistenceReady).toBe(false);
    await server.stop();
    await server.stop();
    expect(await readFile(join(worldDir, 'meta.json'), 'utf8')).toBe(meta);
    expect(await readFile(join(worldDir, 'world.json'), 'utf8')).toBe(world);
    expect(await readFile(join(worldDir, 'players.json'), 'utf8')).toBe(players);
    expect(await exists(join(worldDir, WORLD_LOCK_FILE))).toBe(false);
  }, 30_000);

  it('creates a new world, persists a later mutation, and restores it with the database disabled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-db-save-'));
    dirs.push(dataDir);
    const server = new AnarchyServer(testConfig(dataDir));
    servers.push(server);
    expect(server.config.database.enabled).toBe(false);
    expect(server.world.isPersistenceReady).toBe(false);
    await server.start();
    expect(server.world.isPersistenceReady).toBe(true);
    for (const name of CANONICAL_FILES) {
      expect(await exists(join(dataDir, 'db-life', name))).toBe(true);
    }
    const x = Math.floor(server.world.spawn[0]);
    const y = Math.min(70, Math.max(2, Math.floor(server.world.spawn[1])));
    const z = Math.floor(server.world.spawn[2]);
    expect(server.world.world.setBlock(x, y, z, BlockId.GoldBlock)).toBe(true);
    await server.stop();
    await server.stop();

    const restarted = new AnarchyServer(testConfig(dataDir));
    servers.push(restarted);
    await restarted.start();
    expect(restarted.world.isPersistenceReady).toBe(true);
    expect(restarted.world.world.getBlock(x, y, z)).toBe(BlockId.GoldBlock);
    await restarted.stop();
  }, 60_000);

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
