import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnarchyServer } from '../server/AnarchyServer';
import { loadServerConfig } from '../server/config';
import { BlockId } from '../src/blocks';
import { ANARCHY_WORLD_SEED } from '../src/world/import/anarchy';

const dataDir = await mkdtemp(join(tmpdir(), 'fc-headless-smoke-'));
const server = new AnarchyServer({
  ...loadServerConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    WORLD: 'anarchy',
    WORLD_SEED: ANARCHY_WORLD_SEED,
    MAX_PLAYERS: '4',
    CHUNK_VIEW_RADIUS: '1',
    TICK_RATE: '20',
    PERSIST_INTERVAL_MS: '60000',
  }, process.cwd()),
  dataDir,
  port: 0,
  chunkViewRadius: 1,
  persistIntervalMs: 60_000,
});

try {
  await server.start();
  server.world.tick();
  server.world.world.getChunk(0, 0);
  server.world.world.setBlock(4, 40, 4, BlockId.Dirt);
  await server.world.save();
  console.log('server-headless-smoke: start/tick/mutate/persist OK');
} finally {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
}
