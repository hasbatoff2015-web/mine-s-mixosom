import type { GameMode, SerializedServerWorld, SerializedWorldState, WorldSummary } from '../../save/types';
import type { VoxelWorld } from '../World';
import { parseSchematic } from './schematic';
import { importSchematicIntoWorld, type ImportReport } from './placeStructure';

export const ANARCHY_WORLD_ID = 'anarchy';
export const ANARCHY_SERVER_ID = 'anarchy-pvp';
export const ANARCHY_WORLD_SEED = 'anarchy-spawn-v1';
export const ANARCHY_SPAWN_MAP_URL = '/maps/frontier_spawn2.schem';
/** Legacy metadata written by the DEV schematic importer. Runtime never rebuilds from this. */
export const ANARCHY_IMPORT_VERSION = 3;
/** Extra world Y translation after the auto surface fit. X/Z stay 0. DEV importer only. */
export const ANARCHY_SPAWN_Y_SHIFT = -28;

export type AnarchyStartup =
  | { readonly action: 'restore'; readonly state: SerializedWorldState; readonly spawn: [number, number, number] }
  | { readonly action: 'create' };

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
    | 'cocoaToAir'
    | 'cocoaReplacements'
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

function copySpawn(spawn: readonly number[]): [number, number, number] {
  return [Number(spawn[0]), Number(spawn[1]), Number(spawn[2])];
}

export function isFiniteSpawn(spawn: readonly number[] | undefined): spawn is readonly [number, number, number] {
  return Boolean(
    spawn
    && spawn.length >= 3
    && Number.isFinite(spawn[0])
    && Number.isFinite(spawn[1])
    && Number.isFinite(spawn[2]),
  );
}

/** Canonical respawn: saved serverWorld.spawn, else player spawnPoint, else last position. */
export function resolveCanonicalAnarchySpawn(state: SerializedWorldState): [number, number, number] {
  if (isFiniteSpawn(state.serverWorld?.spawn)) return copySpawn(state.serverWorld.spawn);
  if (isFiniteSpawn(state.player.spawnPoint)) return copySpawn(state.player.spawnPoint);
  return copySpawn(state.player.position);
}

export function createCanonicalAnarchyServerWorld(
  spawn: readonly [number, number, number],
  previous?: SerializedServerWorld,
): AnarchyServerWorld {
  return {
    id: ANARCHY_WORLD_ID,
    initialized: true,
    spawnImported: previous?.spawnImported ?? true,
    importVersion: previous?.importVersion ?? ANARCHY_IMPORT_VERSION,
    spawn: copySpawn(spawn),
    ...(previous?.report ? { report: previous.report as AnarchyServerWorld['report'] } : {}),
  };
}

/**
 * Production Anarchy startup. Any persisted save is canonical.
 * Does not read schematic, importVersion, or spawnImported to decide rebuild.
 */
export function resolveAnarchyStartup(existing: SerializedWorldState | undefined): AnarchyStartup {
  if (!existing) return { action: 'create' };
  return {
    action: 'restore',
    state: existing,
    spawn: resolveCanonicalAnarchySpawn(existing),
  };
}

/** True when IndexedDB already has the Anarchy world. Version mismatches do not rebuild. */
export function hasPersistedAnarchyWorld(state: SerializedWorldState | undefined): boolean {
  return resolveAnarchyStartup(state).action === 'restore';
}

/**
 * @deprecated Runtime no longer rebuilds from schematic. Kept so old saves still count as loaded.
 * Any persisted Anarchy world is canonical regardless of importVersion.
 */
export function anarchyAlreadyImported(state: { summary?: { id: string }; serverWorld?: SerializedServerWorld } | undefined): boolean {
  if (!state) return false;
  if (state.summary && isAnarchyWorldId(state.summary.id)) return true;
  return Boolean(state.serverWorld);
}

/** DEV/offline tool: load schematic bytes. Production Anarchy must not call this. */
export async function loadSchematicBytes(url = ANARCHY_SPAWN_MAP_URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Spawn schematic is missing at ${url}. Copy frontier_spawn2.schem into public/maps/ without modifying the original.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** DEV/offline tool: bake a schematic into a VoxelWorld. Production Anarchy must not call this. */
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
      cocoaToAir: result.cocoaToAir,
      cocoaReplacements: result.cocoaReplacements,
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
