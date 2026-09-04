import { readFile } from 'node:fs/promises';
import { PersistenceError } from '../src/save/PersistenceError';
import { loadServerConfig, worldDirectory } from './config';
import { FsWorldStore } from './FsWorldStore';
import { backupWorldDirectory } from './backupWorldDir';
import { importWorldDump } from './importDump';
import { countModifiedCells, importAnarchySchematic } from './importSchematic';
import { isSchematicFilename, resolveExistingPath, schematicSearchCandidates } from './schematicPaths';
import { serverLog } from './log';

/**
 * Explicit one-shot import into server filesystem storage.
 * Never runs on ordinary server startup.
 *
 *   npm run server:import -- path/to/anarchy-idb.json [--force]
 *   npm run server:import -- path/to/frontier_spawn2.schem [--force]
 *   npm run server:import -- --schem [--force]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const force = args.includes('--force');
  const schemFlag = args.includes('--schem') || args.includes('--schematic');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file && !schemFlag) {
    console.error(
      'Usage: npm run server:import -- <serialized-world.json|.schem> [--force]\n'
      + '       npm run server:import -- --schem [--force]',
    );
    process.exit(1);
  }

  const config = loadServerConfig();
  const store = new FsWorldStore(config.dataDir);
  const worldDir = worldDirectory(config);

  try {
    if (schemFlag || (file && isSchematicFilename(file))) {
      const resolved = await resolveExistingPath(
        file,
        schematicSearchCandidates(process.cwd(), process.env),
      );
      const bytes = new Uint8Array(await readFile(resolved.path));
      const result = await importAnarchySchematic({
        store,
        worldId: config.worldId,
        seed: config.worldSeed,
        bytes,
        force,
        worldDir,
        preservePlayers: true,
      });
      const counts = countModifiedCells(result.snapshot.modifications);
      serverLog(`imported schematic ${resolved.path} into ${store.directoryFor(config.worldId)}`);
      console.log(
        [
          `Schematic: Sponge v${result.inspect.version} ${result.inspect.width}×${result.inspect.height}×${result.inspect.length}`
            + ` gzip=${result.inspect.gzip} bytes=${result.inspect.byteLength} palette=${result.inspect.paletteSize}`,
          `Placement: yShift=${result.report.yShift} offset=${result.report.offset.join(',')} `
            + `Y ${result.report.lowestImportedY}..${result.report.highestImportedY}`,
          `Imported: applied=${result.report.applied} nonAir=${result.report.nonAirBlocks} `
            + `chunks=${result.report.affectedChunks} modifiedCells=${result.modifiedCells}`,
          `Mapped=${result.report.mappedBlocks} diamond=${result.report.unsupportedToDiamond} `
            + `jungleToOak=${result.report.jungleToOak} cocoaToAir=${result.report.cocoaToAir}`,
          `Canonical spawn: ${result.spawn.join(', ')}`,
          `World id=${config.worldId} seed=${config.worldSeed} dir=${store.directoryFor(config.worldId)}`,
          `modifications: ${counts.chunks} chunks / ${counts.cells} cells`,
          result.backupPath ? `Backup: ${result.backupPath}` : 'Backup: (no previous world)',
          'Restart the server to load this world. Ordinary startup does not read .schem.',
        ].join('\n'),
      );
      return;
    }

    if (!file) {
      console.error('JSON dump path is required unless --schem is set.');
      process.exit(1);
    }
    const resolved = await resolveExistingPath(file);
    if (force && await store.exists(config.worldId)) {
      const backupPath = await backupWorldDirectory(worldDir);
      serverLog(`backed up existing world to ${backupPath}`);
    }
    const raw = JSON.parse(await readFile(resolved.path, 'utf8')) as unknown;
    const snapshot = await importWorldDump({
      store,
      worldId: config.worldId,
      fallbackSeed: config.worldSeed,
      raw,
      force,
    });
    const counts = countModifiedCells(snapshot.modifications);
    serverLog(`imported IndexedDB dump into ${store.directoryFor(config.worldId)}`);
    console.log(
      `Imported dump into ${store.directoryFor(config.worldId)} `
      + `(${counts.chunks} chunks / ${counts.cells} cells). `
      + 'Restart the server to load the imported Anarchy world. Schematic files were not used.',
    );
  } catch (error) {
    if (error instanceof PersistenceError && error.code === 'exists') {
      console.error(error.message);
      process.exit(2);
    }
    if (error instanceof PersistenceError && error.code === 'missing') {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

await main();
