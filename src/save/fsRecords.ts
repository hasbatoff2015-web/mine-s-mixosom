import { ANARCHY_IMPORT_VERSION, ANARCHY_WORLD_ID } from '../world/import/anarchy';
import { PersistenceError } from './PersistenceError';
import { parseVec3, placeholderPlayer } from './snapshot';
import {
  WORLD_SCHEMA_VERSION,
  type SerializedPersistedPlayer,
  type WorldSnapshot,
} from './types';

export type WorldReadyState = 'UNINITIALIZED' | 'INITIALIZING' | 'READY';

/** On-disk `meta.json` (filesystem layout, not the logical snapshot). */
export interface FsWorldMeta {
  readonly worldId: string;
  readonly seed: string;
  readonly spawn: readonly [number, number, number];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly readyState: WorldReadyState;
}

/** On-disk `world.json`. */
export interface FsWorldFile {
  readonly timeOfDay: number;
  readonly modifications: Record<string, Record<string, number>>;
  readonly blockStates: Record<string, unknown>;
  readonly chests: Record<string, unknown>;
  readonly furnaces: Record<string, unknown>;
  readonly droppedItems: unknown[];
  readonly mobs: unknown[];
  readonly minecarts: unknown[];
  readonly fallingBlocks: unknown[];
  readonly redstone?: unknown;
}

/** On-disk `players.json`. */
export interface FsPlayersFile {
  readonly players: Record<string, SerializedPersistedPlayer>;
}

export interface FsWorldRecords {
  readonly meta: FsWorldMeta;
  readonly world: FsWorldFile;
  readonly players: FsPlayersFile;
}

function spawnOf(snapshot: WorldSnapshot): [number, number, number] {
  const fromServer = snapshot.serverWorld?.spawn;
  if (fromServer && fromServer.length >= 3) {
    return [Number(fromServer[0]), Number(fromServer[1]), Number(fromServer[2])];
  }
  if (snapshot.player.spawnPoint) return [...snapshot.player.spawnPoint];
  return [...snapshot.player.position];
}

export function snapshotToFsRecords(snapshot: WorldSnapshot): FsWorldRecords {
  const spawn = spawnOf(snapshot);
  const now = Date.now();
  return {
    meta: {
      worldId: snapshot.summary.id,
      seed: snapshot.summary.seed,
      spawn,
      createdAt: snapshot.summary.createdAt || now,
      updatedAt: snapshot.summary.updatedAt || now,
      readyState: 'READY',
    },
    world: {
      timeOfDay: snapshot.timeOfDay,
      modifications: snapshot.modifications,
      blockStates: snapshot.blockStates ?? {},
      chests: snapshot.chests,
      furnaces: snapshot.furnaces,
      droppedItems: snapshot.droppedItems,
      mobs: snapshot.mobs ?? [],
      minecarts: snapshot.minecarts ?? [],
      fallingBlocks: snapshot.fallingBlocks ?? [],
      ...(snapshot.redstone !== undefined ? { redstone: snapshot.redstone } : {}),
    },
    players: { players: snapshot.players ?? {} },
  };
}

export function fsRecordsToSnapshot(records: FsWorldRecords): WorldSnapshot {
  const spawn: [number, number, number] = [
    records.meta.spawn[0],
    records.meta.spawn[1],
    records.meta.spawn[2],
  ];
  const worldId = records.meta.worldId;
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    summary: {
      id: worldId,
      name: worldId === ANARCHY_WORLD_ID ? 'Анархия' : worldId,
      seed: records.meta.seed,
      mode: 'survival',
      kind: 'server',
      ...(worldId === ANARCHY_WORLD_ID ? { serverId: 'anarchy-pvp' } : {}),
      createdAt: records.meta.createdAt,
      updatedAt: records.meta.updatedAt,
      playTimeSeconds: 0,
    },
    timeOfDay: records.world.timeOfDay,
    weather: 'clear',
    player: placeholderPlayer(spawn),
    ...(Object.keys(records.players.players).length > 0 ? { players: records.players.players } : {}),
    modifications: records.world.modifications,
    chests: records.world.chests,
    furnaces: records.world.furnaces,
    droppedItems: records.world.droppedItems,
    mobs: records.world.mobs,
    minecarts: records.world.minecarts,
    fallingBlocks: records.world.fallingBlocks,
    blockStates: records.world.blockStates,
    ...(records.world.redstone !== undefined ? { redstone: records.world.redstone } : {}),
    serverWorld: {
      id: worldId,
      initialized: true,
      spawnImported: true,
      importVersion: ANARCHY_IMPORT_VERSION,
      spawn,
    },
  };
}

export function parseFsMeta(raw: unknown): FsWorldMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PersistenceError('meta.json is not an object.', 'corrupt');
  }
  const meta = raw as Record<string, unknown>;
  if (typeof meta.worldId !== 'string' || typeof meta.seed !== 'string') {
    throw new PersistenceError('meta.json is missing worldId/seed.', 'corrupt');
  }
  const spawn = parseVec3(meta.spawn);
  if (!spawn) throw new PersistenceError('meta.json spawn is invalid.', 'corrupt');
  return {
    worldId: meta.worldId,
    seed: meta.seed,
    spawn,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : Date.now(),
    readyState: 'READY',
  };
}
