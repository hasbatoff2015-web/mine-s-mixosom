import { AnarchyServer } from './AnarchyServer';
import { loadServerConfig } from './config';

const server = new AnarchyServer(loadServerConfig());

const shutdown = async (): Promise<void> => {
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
