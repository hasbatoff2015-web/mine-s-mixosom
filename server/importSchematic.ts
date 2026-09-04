import { VoxelWorld } from '../src/world/World';
import {
  ANARCHY_IMPORT_VERSION,
  ANARCHY_SERVER_ID,
  ANARCHY_WORLD_ID,
  createCanonicalAnarchyServerWorld,
  importAnarchySpawn,
} from '../src/world/import/anarchy';
import { parseSchematic } from '../src/world/import/schematic';
import { isGzip } from '../src/world/import/inflate';
import { PersistenceError } from '../src/save/PersistenceError';
import { placeholderPlayer } from '../src/save/snapshot';
import { WORLD_SCHEMA_VERSION, type WorldSnapshot } from '../src/save/types';
import type { WorldStore } from '../src/save/WorldStore';
import type { ImportReport } from '../src/world/import/placeStructure';
import { backupWorldDirectory } from './backupWorldDir';

export interface ImportAnarchySchematicOptions {
  readonly store: WorldStore;
  readonly worldId: string;
  readonly seed: string;
  readonly bytes: Uint8Array;
  readonly force?: boolean;
  /** Absolute world directory (`dataDir/<worldId>`). Copied when overwriting. */
  readonly worldDir?: string;
  readonly preservePlayers?: boolean;
}

export interface SchematicInspect {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly offset: readonly [number, number, number];
  readonly paletteSize: number;
  readonly entityCount: number;
  readonly blockEntityCount: number;
  readonly gzip: boolean;
  readonly byteLength: number;
}

export interface ImportAnarchySchematicResult {
  readonly snapshot: WorldSnapshot;
  readonly inspect: SchematicInspect;
  readonly report: Pick<
    ImportReport,
    | 'width'
    | 'height'
    | 'length'
    | 'nonAirBlocks'
    | 'mappedBlocks'
    | 'unsupportedToDiamond'
    | 'jungleToOak'
    | 'cocoaToAir'
    | 'yShift'
    | 'offset'
    | 'lowestImportedY'
    | 'highestImportedY'
    | 'affectedChunks'
    | 'applied'
  >;
  readonly spawn: [number, number, number];
  readonly modifiedCells: number;
  readonly backupPath?: string;
}

export function countModifiedCells(modifications: WorldSnapshot['modifications']): {
  chunks: number;
  cells: number;
} {
  let cells = 0;
  const keys = Object.keys(modifications);
  for (const key of keys) cells += Object.keys(modifications[key] ?? {}).length;
  return { chunks: keys.length, cells };
}

export async function inspectSchematicBytes(bytes: Uint8Array): Promise<SchematicInspect> {
  const parsed = await parseSchematic(bytes);
  return {
    version: parsed.version,
    width: parsed.width,
    height: parsed.height,
    length: parsed.length,
    offset: parsed.offset,
    paletteSize: parsed.palette.length,
    entityCount: parsed.entities.length,
    blockEntityCount: parsed.blockEntities.length,
    gzip: isGzip(bytes),
    byteLength: bytes.byteLength,
  };
}

/**
 * One-shot offline bake: Sponge `.schem` → VoxelWorld via existing
 * `importAnarchySpawn` → `WorldSnapshot` → WorldStore.
 * Never called from ordinary Anarchy startup.
 */
export async function importAnarchySchematic(
  options: ImportAnarchySchematicOptions,
): Promise<ImportAnarchySchematicResult> {
  const inspect = await inspectSchematicBytes(options.bytes);
  const exists = await options.store.exists(options.worldId);
  if (exists && !options.force) {
    throw new PersistenceError(
      `World already exists (${options.worldId}). Pass --force to overwrite.`,
      'exists',
    );
  }

  let backupPath: string | undefined;
  let previous: WorldSnapshot | null = null;
  if (exists) {
    previous = await options.store.load(options.worldId);
    if (options.worldDir) backupPath = await backupWorldDirectory(options.worldDir);
  }

  const world = new VoxelWorld(options.seed);
  const imported = await importAnarchySpawn(world, options.bytes);
  const spawn = imported.spawn;
  const now = Date.now();
  const preservePlayers = options.preservePlayers !== false;
  const snapshot: WorldSnapshot = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    summary: {
      id: options.worldId,
      name: options.worldId === ANARCHY_WORLD_ID ? 'Анархия' : options.worldId,
      seed: options.seed,
      mode: 'survival',
      kind: 'server',
      ...(options.worldId === ANARCHY_WORLD_ID ? { serverId: ANARCHY_SERVER_ID } : {}),
      createdAt: previous?.summary.createdAt ?? now,
      updatedAt: now,
      playTimeSeconds: previous?.summary.playTimeSeconds ?? 0,
    },
    timeOfDay: world.timeOfDay,
    weather: 'clear',
    player: placeholderPlayer(spawn),
    ...(preservePlayers && previous?.players ? { players: previous.players } : {}),
    modifications: world.serializeModifications(),
    blockStates: world.serializeBlockStates(),
    chests: Object.fromEntries(world.chests),
    furnaces: Object.fromEntries(world.furnaces),
    droppedItems: [],
    mobs: [],
    minecarts: [],
    fallingBlocks: [],
    serverWorld: createCanonicalAnarchyServerWorld(spawn, {
      id: options.worldId,
      initialized: true,
      spawnImported: true,
      importVersion: ANARCHY_IMPORT_VERSION,
      spawn,
      report: imported.serverWorld.report,
    }),
  };

  await options.store.save(snapshot);
  const counts = countModifiedCells(snapshot.modifications);
  return {
    snapshot,
    inspect,
    report: {
      width: imported.report.width,
      height: imported.report.height,
      length: imported.report.length,
      nonAirBlocks: imported.report.nonAirBlocks,
      mappedBlocks: imported.report.mappedBlocks,
      unsupportedToDiamond: imported.report.unsupportedToDiamond,
      jungleToOak: imported.report.jungleToOak,
      cocoaToAir: imported.report.cocoaToAir,
      yShift: imported.report.yShift,
      offset: imported.report.offset,
      lowestImportedY: imported.report.lowestImportedY,
      highestImportedY: imported.report.highestImportedY,
      affectedChunks: imported.report.affectedChunks,
      applied: imported.report.applied,
    },
    spawn,
    modifiedCells: counts.cells,
    ...(backupPath ? { backupPath } : {}),
  };
}
