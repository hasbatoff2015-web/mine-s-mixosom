import type { GameMode, SerializedServerWorld, WorldSummary } from '../../save/types';
import type { VoxelWorld } from '../World';
import { parseSchematic } from './schematic';
import { importSchematicIntoWorld, type ImportReport } from './placeStructure';

export const ANARCHY_WORLD_ID = 'anarchy';
export const ANARCHY_SERVER_ID = 'anarchy-pvp';
export const ANARCHY_WORLD_SEED = 'anarchy-spawn-v1';
export const ANARCHY_SPAWN_MAP_URL = '/maps/frontier_spawn2.schem';
/** Bumped when spawn mapping/placement changes so a stale IndexedDB world is rebuilt once. */
export const ANARCHY_IMPORT_VERSION = 2;
/** Extra world Y translation after the auto surface fit. X/Z stay 0. */
export const ANARCHY_SPAWN_Y_SHIFT = -28;

export interface AnarchyServerWorld {
  readonly id: string;
  readonly initialized: boolean;
  readonly spawnImported: boolean;
  readonly importVersion: number;
  readonly spawn: readonly [number, number, number];
  readonly report?: Pick<
    ImportReport,
    | 'width'
    | 'height'
    | 'length'
    | 'nonAirBlocks'
    | 'mappedBlocks'
    | 'unsupportedToDiamond'
    | 'jungleToOak'
    | 'jungleReplacements'
    | 'replacements'
    | 'skippedEntities'
    | 'skippedBlockEntities'
    | 'baseOffset'
    | 'yShift'
    | 'offset'
    | 'lowestImportedY'
    | 'highestImportedY'
    | 'affectedChunks'
  >;
}

export function isAnarchyWorldId(id: string): boolean {
  return id === ANARCHY_WORLD_ID;
}

export function isAnarchyServerId(id: string): boolean {
  return id === ANARCHY_SERVER_ID;
}

export function isServerWorldSummary(summary: Pick<WorldSummary, 'kind' | 'id'>): boolean {
  return summary.kind === 'server' || isAnarchyWorldId(summary.id);
}

export function createAnarchySummary(now = Date.now()): WorldSummary {
  return {
    id: ANARCHY_WORLD_ID,
    name: 'Анархия',
    seed: ANARCHY_WORLD_SEED,
    mode: 'survival' satisfies GameMode,
    kind: 'server',
    serverId: ANARCHY_SERVER_ID,
    createdAt: now,
    updatedAt: now,
    playTimeSeconds: 0,
  };
}

export function anarchyAlreadyImported(state: { serverWorld?: SerializedServerWorld } | undefined): boolean {
  return state?.serverWorld?.spawnImported === true && state.serverWorld.importVersion === ANARCHY_IMPORT_VERSION;
}

export async function loadSchematicBytes(url = ANARCHY_SPAWN_MAP_URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Spawn schematic is missing at ${url}. Copy frontier_spawn2.schem into public/maps/ without modifying the original.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function importAnarchySpawn(world: VoxelWorld, bytes: Uint8Array): Promise<{
  report: ImportReport;
  spawn: [number, number, number];
  serverWorld: AnarchyServerWorld;
}> {
  const schematic = await parseSchematic(bytes);
  const result = importSchematicIntoWorld(world, schematic, world.generator.columnAt(0, 0).height, {
    yShift: ANARCHY_SPAWN_Y_SHIFT,
  });
  const serverWorld: AnarchyServerWorld = {
    id: ANARCHY_WORLD_ID,
    initialized: true,
    spawnImported: true,
    importVersion: ANARCHY_IMPORT_VERSION,
    spawn: result.spawn,
    report: {
      width: result.width,
      height: result.height,
      length: result.length,
      nonAirBlocks: result.nonAirBlocks,
      mappedBlocks: result.mappedBlocks,
      unsupportedToDiamond: result.unsupportedToDiamond,
      jungleToOak: result.jungleToOak,
      jungleReplacements: result.jungleReplacements,
      replacements: result.replacements,
      skippedEntities: result.skippedEntities,
      skippedBlockEntities: result.skippedBlockEntities,
      baseOffset: result.baseOffset,
      yShift: result.yShift,
      offset: result.offset,
      lowestImportedY: result.lowestImportedY,
      highestImportedY: result.highestImportedY,
      affectedChunks: result.affectedChunks,
    },
  };
  return { report: result, spawn: result.spawn, serverWorld };
}
