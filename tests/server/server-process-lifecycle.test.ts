import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

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
    ...extra,
  };
}

function waitClose(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function stopServer(session: Session): Promise<number | null> {
  if (session.child.exitCode !== null) return session.child.exitCode;
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

      contender = startServer(baseEnv(worldPath, 'contender', String(port)));
      const code = await waitClose(contender.child, START_TIMEOUT_MS);
      const log = contender.output();
      expect(code).toBe(1);
      expect(log).toContain('EADDRINUSE');
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
      expect(holderCode).toBe(0);
      expect(holder.output()).toContain('world saved');
      expect(await exists(holderLock)).toBe(false);
    } finally {
      await stopServer(holder).catch(() => undefined);
      if (contender && contender.child.exitCode === null) contender.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);

  it('SIGTERM saves the world, removes the lock, and exits 0 once', async () => {
    const worldPath = await mkdtemp(join(tmpdir(), 'fc-term-'));
    const session = startServer(baseEnv(worldPath, 'term-world', '0'));
    const lockPath = join(worldPath, 'term-world', '.instance.lock');
    try {
      await waitForStatus(session, 'term-world');
      expect(await exists(lockPath)).toBe(true);
      session.child.kill('SIGTERM');
      session.child.kill('SIGTERM');
      const code = await waitClose(session.child, STOP_TIMEOUT_MS);
      expect(code).toBe(0);
      expect(session.output()).toContain('world saved');
      expect(session.output().match(/\[server\] stopped/g)).toHaveLength(1);
      expect(await exists(lockPath)).toBe(false);
    } finally {
      if (session.child.exitCode === null) session.child.kill('SIGKILL');
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
      expect(code).toBe(1);
      expect(log).toContain(label);
      expect(log).toContain(message);
      expect(log).toContain('world saved');
      expect(log.match(/\[server\] stopped/g)).toHaveLength(1);
      expect(await exists(lockPath)).toBe(false);
    } finally {
      if (session.child.exitCode === null) session.child.kill('SIGKILL');
      await rm(worldPath, { recursive: true, force: true });
    }
  }, START_TIMEOUT_MS);
});