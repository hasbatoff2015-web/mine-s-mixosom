import { AnarchyServer } from './AnarchyServer';
import { loadServerConfig } from './config';
import { attachServerConsole } from './console';
import { serverLog } from './log';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

const server = new AnarchyServer(loadServerConfig());
let detachConsole: (() => void) | undefined;
let stopping = false;

/**
 * One shutdown for signals, a failed listen, and fatal runtime errors.
 * `stopping` makes a second signal or a second fatal error a no-op so stop()
 * cannot run twice.
 */
function shutdown(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  detachConsole?.();
  detachConsole = undefined;
  void server.stop().then(() => {
    process.exit(exitCode);
  }, (error: unknown) => {
    serverLog(`shutdown failed: ${errorText(error)}`, 'error');
    process.exit(1);
  });
}

function fatal(kind: 'uncaughtException' | 'unhandledRejection', error: unknown): void {
  serverLog(`${kind}: ${errorText(error)}`, 'error');
  shutdown(1);
}

// Ctrl+C signals the whole foreground group. The shell then exits and the
// kernel delivers SIGHUP, which would abort an in-flight SIGINT stop before
// the world lock is released. Handle all three as one shutdown.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => shutdown(0));
}
process.on('uncaughtException', (error) => fatal('uncaughtException', error));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));

let started = false;
try {
  await server.start();
  started = true;
} catch (error) {
  const { serverMode, worldId, host, port } = server.config;
  serverLog(
    `startup failed mode=${serverMode} world=${worldId} host=${host} port=${port}: ${errorText(error)}`,
    'error',
  );
  shutdown(1);
}

if (started) {
  detachConsole = attachServerConsole(server);
  // Test-only. Production does not set this. Fires after the world lock is held
  // so the fatal path has a lock to release.
  const crash = process.env.FC_TEST_FATAL;
  if (crash === 'exception') {
    setImmediate(() => {
      throw new Error('FC_TEST_FATAL exception');
    });
  } else if (crash === 'rejection') {
    setImmediate(() => {
      void Promise.reject(new Error('FC_TEST_FATAL rejection'));
    });
  }
}
