import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { FsWorldStore } from '../../server/FsWorldStore';
import { inventoryWithDiamond, sampleSnapshot } from '../persistFixture';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = join(ROOT, 'dist/server/index.mjs');
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 30_000;

interface Session {
  child: ChildProcess;
  output: () => string;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
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

async function canonicalBytes(worldDir: string): Promise<Buffer[]> {
  return Promise.all(CANONICAL_FILES.map((name) => readFile(join(worldDir, name))));
}

async function seedAuthoritativeWorld(worldPath: string, worldId: string): Promise<void> {
  const store = new FsWorldStore(worldPath);
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

function startServer(env: NodeJS.ProcessEnv): Session {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { child, output: () => output };
}

function baseEnv(worldPath: string, world: string, port: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: port,
    SERVER_MODE: 'anarchy',
    WORLD: world,
    WORLD_PATH: worldPath,
    CHUNK_VIEW_RADIUS: '1',
    MAX_PLAYERS: '4',
    PERSIST_INTERVAL_MS: '60000',
    FC_EXAMPLE_PLUGIN: '',
    FC_NO_BUILTIN_PLUGINS: '',
    FC_TEST_FATAL: '',
    FC_DATABASE_URL: '',
    FC_DEPLOYMENT_ID: '',
    FC_DB_POOL_MAX: '',
    FC_TEST_DATABASE_URL: '',
    FC_ADMIN_IDS: '',
    FC_ADMIN_PORT: '',
    FC_ADMIN_AUTH_HASHES: '',
    ...extra,
  };
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function waitClose(child: ChildProcess, timeoutMs: number): Promise<ExitResult> {
  const current = (): ExitResult => ({ code: child.exitCode, signal: child.signalCode });
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(current());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once('exit', finish);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off('exit', finish);
      finish(child.exitCode, child.signalCode);
    }
  });
}

async function stopServer(session: Session): Promise<ExitResult> {
  if (session.child.exitCode !== null || session.child.signalCode !== null) {
    return { code: session.child.exitCode, signal: session.child.signalCode };
  }
  session.child.kill('SIGTERM');
  return waitClose(session.child, STOP_TIMEOUT_MS);
}

async function waitForStatus(session: Session, world: string): Promise<number> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (session.child.exitCode !== null) {
      throw new Error(`server exited ${session.child.exitCode} before /status\n${session.output()}`);
    }
    const match = session.output().match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      const port = Number(match[1]);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`);
        if (response.status === 200) {
          const body = await response.json() as { ready?: boolean; world?: string; mode?: string };
          if (body.ready === true && body.world === world && body.mode === 'anarchy') return port;
        }
      } catch {
        // Not accepting yet.
      }
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for /status\n${session.output()}`);
}

describe('production server process lifecycle', () => {
  beforeAll(async () => {
    await run(process.execPath, ['scripts/build-server.mjs']);
  }, START_TIMEOUT_MS);

  it('releases the contender lock when the port is already taken and leaves the holder running', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-bind-'));
    const holder = startServer(baseEnv(worldPath, 'holder', '0'));
    let contender: Session | undefined;
    try {
      const port = await waitForStatus(holder, 'holder');
      const holderLock = join(worldPath, 'holder', '.instance.lock');
      const contenderLock = join(worldPath, 'contender', '.instance.lock');
      expect(await exists(holderLock)).toBe(true);

      await seedAuthoritativeWorld(worldPath, 'contender');
      const contenderDir = join(worldPath, 'contender');
      const metaBeforeListen = await readFile(join(contenderDir, 'meta.json'));
      contender = startServer(baseEnv(worldPath, 'contender', String(port)));
      const code = await waitClose(contender.child, START_TIMEOUT_MS);
      const log = contender.output();
      expect(code.code).toBe(1);
      expect(log).toContain('EADDRINUSE');
      expect(log).toContain('world saved');
      expect(log).not.toContain('world created');
      const playersAfter = await readFile(join(contenderDir, 'players.json'), 'utf8');
      const worldAfter = await readFile(join(contenderDir, 'world.json'), 'utf8');
      expect(playersAfter).toContain('PersistenceCanary');
      expect(worldAfter).toContain(String(BlockId.GoldBlock));
      expect((await readFile(join(contenderDir, 'meta.json'))).equals(metaBeforeListen)).toBe(false);
      expect(log).toContain('mode=anarchy');
      expect(log).toContain('world=contender');
      expect(log).toContain('host=127.0.0.1');
      expect(log).toContain(`port=${port}`);
      expect(await exists(contenderLock)).toBe(false);
      expect(await exists(holderLock)).toBe(true);

      const status = await fetch(`http://127.0.0.1:${port}/status`);
      expect(status.status).toBe(200);
      const body = await status.json() as { ready?: boolean; world?: string };
      expect(body.ready).toBe(true);
      expect(body.world).toBe('holder');

      const holderCode = await stopServer(holder);
      if (process.platform === 'win32') {
        // child.kill('SIGTERM') is TerminateProcess. It must not be reported as exit 0.
        expect(holderCode.code).toBeNull();
        expect(holderCode.signal).toBe('SIGTERM');
        expect(holder.output()).not.toContain('[server] stopped');
      } else {
        expect(holderCode.code).toBe(0);
        expect(holder.output()).toContain('world saved');
        expect(holder.output()).toContain('[server] stopped');
        expect(await exists(holderLock)).toBe(false);
      }
    } finally {
      await stopServer(holder).catch(() => undefined);
      if (contender && contender.child.exitCode === null) contender.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it.skipIf(process.platform === 'win32')('SIGTERM saves the world, removes the lock, and exits 0 once', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-term-'));
    const session = startServer(baseEnv(worldPath, 'term-world', '0'));
    const lockPath = join(worldPath, 'term-world', '.instance.lock');
    try {
      await waitForStatus(session, 'term-world');
      expect(await exists(lockPath)).toBe(true);
      session.child.kill('SIGTERM');
      session.child.kill('SIGTERM');
      const code = await waitClose(session.child, STOP_TIMEOUT_MS);
      expect(code.code).toBe(0);
      expect(session.output()).toContain('world saved');
      expect(session.output().match(/\[server\] stopped/g)).toHaveLength(1);
      expect(await exists(lockPath)).toBe(false);
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it.skipIf(process.platform !== 'win32')('Windows child.kill(SIGTERM) does not run the graceful shutdown', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-term-win-'));
    const session = startServer(baseEnv(worldPath, 'term-world', '0'));
    try {
      await waitForStatus(session, 'term-world');
      session.child.kill('SIGTERM');
      const code = await waitClose(session.child, STOP_TIMEOUT_MS);
      expect(code.code).toBeNull();
      expect(code.signal).toBe('SIGTERM');
      expect(session.output()).not.toContain('[server] stopped');
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it.each([
    ['exception', 'uncaughtException', 'FC_TEST_FATAL exception'],
    ['rejection', 'unhandledRejection', 'FC_TEST_FATAL rejection'],
  ] as const)('FC_TEST_FATAL=%s stops, saves, removes the lock, and exits 1', async (fatal, label, message) => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-fatal-'));
    const world = `fatal-${fatal}`;
    const session = startServer(baseEnv(worldPath, world, '0', { FC_TEST_FATAL: fatal }));
    const lockPath = join(worldPath, world, '.instance.lock');
    try {
      const code = await waitClose(session.child, START_TIMEOUT_MS);
      const log = session.output();
      expect(code.code).toBe(1);
      expect(log).toContain(label);
      expect(log).toContain(message);
      expect(log).toContain('world saved');
      expect(log.match(/\[server\] stopped/g)).toHaveLength(1);
      expect(await exists(lockPath)).toBe(false);
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it('fails startup when the configured database is unreachable and does not keep the world lock', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-db-down-'));
    const world = 'db-down';
    const password = 'super-secret-password';
    const user = 'fc_audit_user';
    const session = startServer(baseEnv(worldPath, world, '0', {
      FC_DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:1/megacraft_dev`,
      FC_DEPLOYMENT_ID: 'dev',
    }));
    const lockPath = join(worldPath, world, '.instance.lock');
    try {
      const code = await waitClose(session.child, START_TIMEOUT_MS);
      const log = session.output();
      expect(code.code).toBe(1);
      expect(log).toContain('startup failed');
      expect(log).not.toContain('server ready');
      expect(log).not.toContain('database: ready');
      expect(log).not.toContain(password);
      expect(log).not.toContain(user);
      expect(log).not.toContain('postgresql://');
      expect(log).not.toContain('world saved');
      expect(log).not.toContain('world created');
      expect(log).not.toContain('world loaded');
      expect(await exists(lockPath)).toBe(false);
      for (const name of CANONICAL_FILES) {
        expect(await exists(join(worldPath, world, name))).toBe(false);
      }
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it('does not rewrite an existing world when the configured database is unreachable', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-db-keep-'));
    const world = 'db-keep';
    const worldDir = join(worldPath, world);
    const password = 'super-secret-password';
    const user = 'fc_audit_user';
    await seedAuthoritativeWorld(worldPath, world);
    const before = await canonicalBytes(worldDir);
    const session = startServer(baseEnv(worldPath, world, '0', {
      FC_DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:1/megacraft_dev`,
      FC_DEPLOYMENT_ID: 'dev',
    }));
    try {
      const code = await waitClose(session.child, START_TIMEOUT_MS);
      const log = session.output();
      expect(code.code).toBe(1);
      expect(log).toContain('startup failed');
      expect(log).not.toContain('world saved');
      expect(log).not.toContain('server ready');
      expect(log).not.toContain(password);
      expect(log).not.toContain(user);
      const after = await canonicalBytes(worldDir);
      expect(after[0]?.equals(before[0] ?? Buffer.alloc(0))).toBe(true);
      expect(after[1]?.equals(before[1] ?? Buffer.alloc(0))).toBe(true);
      expect(after[2]?.equals(before[2] ?? Buffer.alloc(0))).toBe(true);
      expect(after[2]?.toString('utf8')).toContain('PersistenceCanary');
      expect(after[1]?.toString('utf8')).toContain(String(BlockId.GoldBlock));
      expect(await exists(join(worldDir, '.instance.lock'))).toBe(false);
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it('does not replace corrupt world files when load fails before initialization', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-corrupt-'));
    const world = 'corrupt-world';
    const worldDir = join(worldPath, world);
    const meta = '{not-json';
    const worldBody = 'CORRUPT-WORLD-MARKER';
    const players = 'CORRUPT-PLAYERS-MARKER';
    await mkdir(worldDir, { recursive: true });
    await writeFile(join(worldDir, 'meta.json'), meta, 'utf8');
    await writeFile(join(worldDir, 'world.json'), worldBody, 'utf8');
    await writeFile(join(worldDir, 'players.json'), players, 'utf8');
    const session = startServer(baseEnv(worldPath, world, '0'));
    try {
      const code = await waitClose(session.child, START_TIMEOUT_MS);
      const log = session.output();
      expect(code.code).toBe(1);
      expect(log).toContain('startup failed');
      expect(log).not.toContain('world saved');
      expect(log).not.toContain('world created');
      expect(await readFile(join(worldDir, 'meta.json'), 'utf8')).toBe(meta);
      expect(await readFile(join(worldDir, 'world.json'), 'utf8')).toBe(worldBody);
      expect(await readFile(join(worldDir, 'players.json'), 'utf8')).toBe(players);
      expect(await exists(join(worldDir, '.instance.lock'))).toBe(false);
    } finally {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);
});