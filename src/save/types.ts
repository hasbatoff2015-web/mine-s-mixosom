export type GameMode = 'survival' | 'creative';

/** Serialized gameplay state schema. Independent of network protocol and schematic import version. */
export const WORLD_SCHEMA_VERSION = 1;
export type WorldSchemaVersion = typeof WORLD_SCHEMA_VERSION;

export interface WorldSummary {
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  playTimeSeconds: number;
  /** Absent/undefined = ordinary singleplayer world. */
  kind?: 'singleplayer' | 'server';
  serverId?: string;
}

/** Singleplayer local player, and the host blob in IndexedDB Anarchy dumps. */
export interface SerializedPlayerState {
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  absorption?: number;
  absorptionTicks?: number;
  selectedSlot: number;
  spawnPoint?: [number, number, number];
  inventory: unknown;
}

/**
 * Authoritative multiplayer player row (filesystem `players.json`).
 * Session token is identity for reconnect, not a visual field.
 */
export interface SerializedPersistedPlayer {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly gamemode: GameMode;
  readonly selectedSlot: number;
  readonly inventory: unknown;
  readonly sessionToken?: string;
  readonly updatedAt: number;
  readonly survival?: unknown;
  readonly cursor?: unknown;
}

export interface SerializedServerWorld {
  id: string;
  initialized: boolean;
  spawnImported: boolean;
  importVersion: number;
  spawn: readonly [number, number, number];
  report?: unknown;
}

/**
 * Canonical gameplay snapshot. Storage adapters map this to IndexedDB or
 * meta.json / world.json / players.json. Not a Three.js / input / HUD dump.
 */
export interface WorldSnapshot {
  schemaVersion: WorldSchemaVersion;
  summary: WorldSummary;
  timeOfDay: number;
  weather: 'clear';
  player: SerializedPlayerState;
  /** Server roster. Omitted on ordinary singleplayer IndexedDB records. */
  players?: Record<string, SerializedPersistedPlayer>;
  modifications: Record<string, Record<string, number>>;
  chests: Record<string, unknown>;
  furnaces: Record<string, unknown>;
  droppedItems: unknown[];
  mobs?: unknown[];
  redstone?: unknown;
  blockStates?: Record<string, unknown>;
  minecarts?: unknown[];
  fallingBlocks?: unknown[];
  serverWorld?: SerializedServerWorld;
}

/** Historical name of the IndexedDB record. Same object as `WorldSnapshot`. */
export type SerializedWorldState = WorldSnapshot;
