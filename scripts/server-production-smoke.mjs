/**
 * Build dist/server/index.mjs and boot it with plain node.
 * Uses a temporary WORLD_PATH. Does not touch server/data/worlds.
 * Modes run one after another, each on an OS-assigned port.
 */
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const MODES = [
  { mode: 'anarchy', world: 'anarchy' },
  { mode: 'survival', world: 'survival' },
  { mode: 'peaceful', world: 'peaceful' },
];

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 30_000;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function startServer(env) {
  const child = spawn(process.execPath, ['dist/server/index.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  return {
    child,
    output: () => output,
  };
}

async function stopServer(session) {
  if (session.child.exitCode !== null || session.child.signalCode !== null) {
    return session.child.exitCode;
  }
  session.child.kill('SIGTERM');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.child.kill('SIGKILL');
      reject(new Error(`SIGTERM did not stop the server\n${session.output()}`));
    }, STOP_TIMEOUT_MS);
    session.child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForStatus(session, mode, world) {
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
          const body = await response.json();
          if (body.ready === true && body.mode === mode && body.world === world) {
            return { port, body };
          }
        }
      } catch {
        // The socket is not accepting yet.
      }
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for /status ${mode}/${world}\n${session.output()}`);
}

async function smokeMode(worldPath, { mode, world }) {
  const lockPath = join(worldPath, world, '.instance.lock');
  const session = startServer({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    SERVER_MODE: mode,
    WORLD: world,
    WORLD_PATH: worldPath,
    CHUNK_VIEW_RADIUS: '1',
    MAX_PLAYERS: '4',
    PERSIST_INTERVAL_MS: '60000',
    FC_EXAMPLE_PLUGIN: '',
    FC_NO_BUILTIN_PLUGINS: '',
  });
  try {
    const { port, body } = await waitForStatus(session, mode, world);
    const plugins = session.output().match(/plugins: (\d+) enabled: ([^\n]+)/);
    if (!plugins || Number(plugins[1]) < 20 || !plugins[2].includes('permissions')) {
      throw new Error(`builtin plugins did not enable for ${mode}\n${session.output()}`);
    }
    if (!(await exists(lockPath))) {
      throw new Error(`expected lock before shutdown: ${lockPath}`);
    }
    console.log(`[smoke:server:prod] ${mode} port=${port} status=${JSON.stringify(body)}`);
    const code = await stopServer(session);
    if (code !== 0) {
      throw new Error(`${mode} SIGTERM exit ${code}\n${session.output()}`);
    }
    if (await exists(lockPath)) {
      throw new Error(`lock remained after SIGTERM: ${lockPath}`);
    }
    console.log(`[smoke:server:prod] ${mode} SIGTERM exit 0, lock removed`);
  } catch (error) {
    await stopServer(session).catch(() => undefined);
    throw error;
  }
}

const worldPath = await mkdtemp(join(tmpdir(), 'fc-server-prod-'));
try {
  console.log(`[smoke:server:prod] building server, WORLD_PATH=${worldPath}`);
  await run(process.execPath, ['scripts/build-server.mjs']);
  for (const preset of MODES) {
    await smokeMode(worldPath, preset);
  }
  console.log('[smoke:server:prod] anarchy, survival, peaceful ok');
} finally {
  await rm(worldPath, { recursive: true, force: true });
}
