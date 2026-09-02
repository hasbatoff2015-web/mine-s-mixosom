import { Inventory } from '../inventory';
import { PersistenceError } from './PersistenceError';
import {
  WORLD_SCHEMA_VERSION,
  type GameMode,
  type SerializedPersistedPlayer,
  type SerializedPlayerState,
  type SerializedServerWorld,
  type WorldSnapshot,
  type WorldSummary,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseVec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  return [x, y, z];
}

function requireVec3(value: unknown, label: string): [number, number, number] {
  const vec = parseVec3(value);
  if (!vec) throw new PersistenceError(`${label} is missing or invalid.`, 'corrupt');
  return vec;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseMode(value: unknown): GameMode {
  return value === 'creative' ? 'creative' : 'survival';
}

function parseSummary(value: unknown): WorldSummary {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.seed !== 'string') {
    throw new PersistenceError('World summary is missing id/seed.', 'corrupt');
  }
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : value.id,
    seed: value.seed,
    mode: parseMode(value.mode),
    createdAt: finiteNumber(value.createdAt, Date.now()),
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
    playTimeSeconds: finiteNumber(value.playTimeSeconds, 0),
    ...(value.kind === 'server' || value.kind === 'singleplayer' ? { kind: value.kind } : {}),
    ...(typeof value.serverId === 'string' ? { serverId: value.serverId } : {}),
  };
}

function parsePlayer(value: unknown): SerializedPlayerState {
  if (!isRecord(value)) throw new PersistenceError('Player snapshot is missing.', 'corrupt');
  return {
    position: requireVec3(value.position, 'player.position'),
    velocity: parseVec3(value.velocity) ?? [0, 0, 0],
    yaw: finiteNumber(value.yaw, 0),
    pitch: finiteNumber(value.pitch, 0),
    health: finiteNumber(value.health, 20),
    hunger: finiteNumber(value.hunger, 20),
    saturation: finiteNumber(value.saturation, 5),
    ...(typeof value.absorption === 'number' ? { absorption: value.absorption } : {}),
    ...(typeof value.absorptionTicks === 'number' ? { absorptionTicks: value.absorptionTicks } : {}),
    selectedSlot: Math.max(0, Math.floor(finiteNumber(value.selectedSlot, 0))),
    ...(parseVec3(value.spawnPoint) ? { spawnPoint: parseVec3(value.spawnPoint) } : {}),
    inventory: value.inventory ?? emptyInventoryBlob(),
  };
}

function parsePersistedPlayer(id: string, value: unknown): SerializedPersistedPlayer | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const z = finiteNumber(value.z, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  return {
    id: typeof value.id === 'string' ? value.id : id,
    name: typeof value.name === 'string' ? value.name : id.slice(0, 8),
    x,
    y,
    z,
    yaw: finiteNumber(value.yaw, 0),
    pitch: finiteNumber(value.pitch, 0),
    health: finiteNumber(value.health, 20),
    gamemode: parseMode(value.gamemode),
    selectedSlot: Math.max(0, Math.floor(finiteNumber(value.selectedSlot, 0))),
    inventory: value.inventory,
    ...(typeof value.sessionToken === 'string' ? { sessionToken: value.sessionToken } : {}),
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
    ...(value.survival !== undefined ? { survival: value.survival } : {}),
    ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
  };
}

function parsePlayers(value: unknown): Record<string, SerializedPersistedPlayer> | undefined {
  if (!isRecord(value)) return undefined;
  const players: Record<string, SerializedPersistedPlayer> = {};
  for (const [id, row] of Object.entries(value)) {
    const parsed = parsePersistedPlayer(id, row);
    if (parsed) players[id] = parsed;
  }
  return Object.keys(players).length > 0 ? players : undefined;
}

function parseServerWorld(value: unknown): SerializedServerWorld | undefined {
  if (!isRecord(value)) return undefined;
  const spawn = parseVec3(value.spawn);
  if (!spawn || typeof value.id !== 'string') return undefined;
  return {
    id: value.id,
    initialized: value.initialized !== false,
    spawnImported: value.spawnImported !== false,
    importVersion: Math.max(0, Math.floor(finiteNumber(value.importVersion, 0))),
    spawn,
    ...(value.report !== undefined ? { report: value.report } : {}),
  };
}

function emptyInventoryBlob(): unknown {
  return new Inventory().serialize();
}

/** Synthesized singleplayer-shaped player for server snapshots (required field). */
export function placeholderPlayer(spawn: readonly [number, number, number]): SerializedPlayerState {
  return {
    position: [spawn[0], spawn[1], spawn[2]],
    velocity: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    health: 20,
    hunger: 20,
    saturation: 5,
    selectedSlot: 0,
    spawnPoint: [spawn[0], spawn[1], spawn[2]],
    inventory: emptyInventoryBlob(),
  };
}

/**
 * Accepts current IndexedDB dumps (`schemaVersion: 1`) and fills optional collections.
 * Unknown future schema versions fail loudly instead of resetting the world.
 */
export function parseWorldSnapshot(raw: unknown): WorldSnapshot {
  if (!isRecord(raw)) throw new PersistenceError('World snapshot is not an object.', 'corrupt');
  const version = raw.schemaVersion === undefined ? WORLD_SCHEMA_VERSION : raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new PersistenceError('World snapshot schemaVersion is invalid.', 'corrupt');
  }
  if (version > WORLD_SCHEMA_VERSION) {
    throw new PersistenceError(
      `Unsupported world schemaVersion ${version} (supported ${WORLD_SCHEMA_VERSION}).`,
      'unsupported',
    );
  }
  if (version < 1) {
    throw new PersistenceError(`Unsupported world schemaVersion ${version}.`, 'unsupported');
  }
  const summary = parseSummary(raw.summary);
  const player = parsePlayer(raw.player);
  const players = parsePlayers(raw.players);
  const snapshot: WorldSnapshot = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    summary,
    timeOfDay: finiteNumber(raw.timeOfDay, 0),
    weather: 'clear',
    player,
    modifications: isRecord(raw.modifications) ? raw.modifications as WorldSnapshot['modifications'] : {},
    chests: asRecord(raw.chests),
    furnaces: asRecord(raw.furnaces),
    droppedItems: asArray(raw.droppedItems),
    mobs: asArray(raw.mobs),
    minecarts: asArray(raw.minecarts),
    fallingBlocks: asArray(raw.fallingBlocks),
    blockStates: asRecord(raw.blockStates),
  };
  if (players) snapshot.players = players;
  if (raw.redstone !== undefined) snapshot.redstone = raw.redstone;
  const serverWorld = parseServerWorld(raw.serverWorld);
  if (serverWorld) snapshot.serverWorld = serverWorld;
  return snapshot;
}

export function cloneWorldSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return structuredClone(snapshot);
}

export function worldIdOf(snapshot: WorldSnapshot): string {
  return snapshot.summary.id;
}
