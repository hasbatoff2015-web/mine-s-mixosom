import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GameMode, Vec3, WorldBlockStates, WorldModifications } from '../shared/protocol';
import { serverLog } from './log';

export type WorldReadyState = 'UNINITIALIZED' | 'INITIALIZING' | 'READY';

export interface WorldMeta {
  readonly worldId: string;
  readonly seed: string;
  readonly spawn: Vec3;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly readyState: WorldReadyState;
}

export interface StoredPlayer {
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
}

export interface WorldDiskState {
  readonly meta: WorldMeta;
  readonly timeOfDay: number;
  readonly modifications: WorldModifications;
  readonly blockStates: WorldBlockStates;
  readonly players: Record<string, StoredPlayer>;
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSpawn(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  return [x, y, z];
}

export class WorldPersistence {
  constructor(readonly directory: string) {}

  get metaPath(): string {
    return join(this.directory, 'meta.json');
  }

  get worldPath(): string {
    return join(this.directory, 'world.json');
  }

  get playersPath(): string {
    return join(this.directory, 'players.json');
  }

  async exists(): Promise<boolean> {
    const meta = await readJson(this.metaPath);
    return isRecord(meta);
  }

  async load(): Promise<WorldDiskState | undefined> {
    const metaRaw = await readJson(this.metaPath);
    if (!isRecord(metaRaw) || typeof metaRaw.worldId !== 'string' || typeof metaRaw.seed !== 'string') {
      return undefined;
    }
    const spawn = parseSpawn(metaRaw.spawn);
    if (!spawn) return undefined;
    const worldRaw = (await readJson(this.worldPath)) ?? {};
    const playersRaw = (await readJson(this.playersPath)) ?? {};
    const world = isRecord(worldRaw) ? worldRaw : {};
    const playersFile = isRecord(playersRaw) ? playersRaw : {};
    const modifications = isRecord(world.modifications) ? world.modifications as WorldModifications : {};
    const blockStates = isRecord(world.blockStates) ? world.blockStates as WorldBlockStates : {};
    const players = isRecord(playersFile.players) ? playersFile.players as Record<string, StoredPlayer> : {};
    return {
      meta: {
        worldId: metaRaw.worldId,
        seed: metaRaw.seed,
        spawn,
        createdAt: typeof metaRaw.createdAt === 'number' ? metaRaw.createdAt : Date.now(),
        updatedAt: typeof metaRaw.updatedAt === 'number' ? metaRaw.updatedAt : Date.now(),
        readyState: 'READY',
      },
      timeOfDay: typeof world.timeOfDay === 'number' ? world.timeOfDay : 0,
      modifications,
      blockStates,
      players,
    };
  }

  async save(state: WorldDiskState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const now = Date.now();
    await writeJsonAtomic(this.metaPath, {
      ...state.meta,
      updatedAt: now,
      readyState: 'READY',
    });
    await writeJsonAtomic(this.worldPath, {
      timeOfDay: state.timeOfDay,
      modifications: state.modifications,
      blockStates: state.blockStates,
    });
    await writeJsonAtomic(this.playersPath, { players: state.players });
    serverLog('world saved');
  }
}
