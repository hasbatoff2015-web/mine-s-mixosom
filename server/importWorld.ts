import { readFile } from 'node:fs/promises';
import { loadServerConfig } from './config';
import { FsWorldStore } from './FsWorldStore';
import { importWorldDump } from './importDump';
import { serverLog } from './log';

/**
 * Explicit one-shot import of a WorldSnapshot JSON dump (IndexedDB export)
 * into server filesystem storage. Never runs on ordinary server startup.
 *
 * Usage: npm run server:import -- path/to/anarchy-idb.json
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const force = args.includes('--force');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) {
    console.error('Usage: npm run server:import -- <serialized-world.json> [--force]');
    process.exit(1);
  }
  const config = loadServerConfig();
  const store = new FsWorldStore(config.dataDir);
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  await importWorldDump({
    store,
    worldId: config.worldId,
    fallbackSeed: config.worldSeed,
    raw,
    force,
  });
  serverLog(`imported IndexedDB dump into ${store.directoryFor(config.worldId)}`);
  console.log('Restart the server to load the imported Anarchy world. Schematic files were not used.');
}

await main();
