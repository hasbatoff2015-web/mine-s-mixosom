import { AnarchyServer } from './AnarchyServer';
import { loadServerConfig } from './config';
import { attachServerConsole } from './console';

const server = new AnarchyServer(loadServerConfig());
let detachConsole: (() => void) | undefined;
let stopping = false;

const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  detachConsole?.();
  detachConsole = undefined;
  void server.stop().then(() => {
    process.exit(0);
  }, (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
};

// Ctrl+C signals the whole foreground group. The shell then exits and the
// kernel delivers SIGHUP, which would abort an in-flight SIGINT stop before
// the world lock is released. Handle all three as one shutdown.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, shutdown);
}

await server.start();
detachConsole = attachServerConsole(server);
