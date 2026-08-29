import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadServerConfig, worldDirectory } from './config';
import { serverLog } from './log';

/**
 * Explicit one-shot import of a SerializedWorldState JSON dump (IndexedDB export)
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
  const directory = worldDirectory(config);
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const summary = raw.summary as { id?: string; seed?: string } | undefined;
  const serverWorld = raw.serverWorld as { spawn?: number[] } | undefined;
  const player = raw.player as { position?: number[]; spawnPoint?: number[] } | undefined;
  const spawn = serverWorld?.spawn ?? player?.spawnPoint ?? player?.position;
  if (!Array.isArray(spawn) || spawn.length < 3) {
    throw new Error('Dump is missing spawn/player position.');
  }
  await mkdir(directory, { recursive: true });
  const metaPath = join(directory, 'meta.json');
  try {
    await readFile(metaPath, 'utf8');
    if (!force) {
      throw new Error(`World already exists at ${directory}. Pass --force to overwrite.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
  }
  const now = Date.now();
  await writeFile(metaPath, `${JSON.stringify({
    worldId: summary?.id ?? config.worldId,
    seed: summary?.seed ?? config.worldSeed,
    spawn,
    createdAt: now,
    updatedAt: now,
    readyState: 'READY',
  }, null, 2)}\n`);
  await writeFile(join(directory, 'world.json'), `${JSON.stringify({
    timeOfDay: typeof raw.timeOfDay === 'number' ? raw.timeOfDay : 0,
    modifications: raw.modifications ?? {},
    blockStates: raw.blockStates ?? {},
    chests: raw.chests ?? {},
    furnaces: raw.furnaces ?? {},
    droppedItems: raw.droppedItems ?? [],
    mobs: raw.mobs ?? [],
    minecarts: raw.minecarts ?? [],
    fallingBlocks: raw.fallingBlocks ?? [],
    redstone: raw.redstone ?? undefined,
  }, null, 2)}\n`);
  await writeFile(join(directory, 'players.json'), `${JSON.stringify({ players: {} }, null, 2)}\n`);
  serverLog(`imported IndexedDB dump into ${directory}`);
  console.log('Restart the server to load the imported Anarchy world. Schematic files were not used.');
}

await main();
