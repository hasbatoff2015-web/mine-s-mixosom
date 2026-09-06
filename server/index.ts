import { AnarchyServer } from './AnarchyServer';
import { loadServerConfig } from './config';
import { attachServerConsole } from './console';

const server = new AnarchyServer(loadServerConfig());
let detachConsole: (() => void) | undefined;

const shutdown = async (): Promise<void> => {
  detachConsole?.();
  detachConsole = undefined;
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

await server.start();
detachConsole = attachServerConsole(server);
