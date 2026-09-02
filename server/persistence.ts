import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PersistenceError } from '../src/save/PersistenceError';
import {
  parseFsMeta,
  type FsPlayersFile,
  type FsWorldFile,
  type FsWorldMeta,
  type FsWorldRecords,
  type WorldReadyState,
} from '../src/save/fsRecords';
import { asArray, asRecord, isRecord } from '../src/save/snapshot';
import type { SerializedPersistedPlayer } from '../src/save/types';
import { serverLog } from './log';

/** @deprecated Use `SerializedPersistedPlayer` from `src/save`. */
export type StoredPlayer = SerializedPersistedPlayer;
export type { WorldReadyState, FsWorldRecords };

async function readJson(path: string): Promise<{ missing: true } | { missing: false; value: unknown }> {
  try {
    return { missing: false, value: JSON.parse(await readFile(path, 'utf8')) as unknown };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { missing: true };
    const reason = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to read ${path}: ${reason}`, 'corrupt');
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/**
 * Low-level meta.json / world.json / players.json IO. Logical state is `WorldSnapshot`.
 */
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
    return !meta.missing;
  }

  /**
   * `null` = directory has no meta (empty world, safe to create).
   * Corrupt / incomplete existing files throw `PersistenceError` — never a silent reset.
   */
  async loadRecords(): Promise<FsWorldRecords | null> {
    const metaRaw = await readJson(this.metaPath);
    if (metaRaw.missing) return null;
    let meta: FsWorldMeta;
    try {
      meta = parseFsMeta(metaRaw.value);
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('meta.json is corrupt.', 'corrupt');
    }

    const worldRaw = await readJson(this.worldPath);
    if (worldRaw.missing) {
      throw new PersistenceError(
        `Incomplete world save in ${this.directory}: meta.json exists but world.json is missing.`,
        'incomplete',
      );
    }
    if (!isRecord(worldRaw.value)) {
      throw new PersistenceError('world.json is not an object.', 'corrupt');
    }
    const worldFile = worldRaw.value;
    const world: FsWorldFile = {
      timeOfDay: typeof worldFile.timeOfDay === 'number' ? worldFile.timeOfDay : 0,
      modifications: isRecord(worldFile.modifications)
        ? worldFile.modifications as FsWorldFile['modifications']
        : {},
      blockStates: asRecord(worldFile.blockStates),
      chests: asRecord(worldFile.chests),
      furnaces: asRecord(worldFile.furnaces),
      droppedItems: asArray(worldFile.droppedItems),
      mobs: asArray(worldFile.mobs),
      minecarts: asArray(worldFile.minecarts),
      fallingBlocks: asArray(worldFile.fallingBlocks),
      ...(worldFile.redstone !== undefined ? { redstone: worldFile.redstone } : {}),
    };

    const playersRaw = await readJson(this.playersPath);
    let players: Record<string, SerializedPersistedPlayer> = {};
    if (!playersRaw.missing) {
      if (!isRecord(playersRaw.value)) {
        throw new PersistenceError('players.json is not an object.', 'corrupt');
      }
      const table = isRecord(playersRaw.value.players) ? playersRaw.value.players : playersRaw.value;
      players = table as Record<string, SerializedPersistedPlayer>;
    }

    const playersFile: FsPlayersFile = { players };
    return { meta, world, players: playersFile };
  }

  async saveRecords(records: FsWorldRecords): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const now = Date.now();
    const meta: FsWorldMeta = { ...records.meta, updatedAt: now, readyState: 'READY' };
    await writeJsonAtomic(this.worldPath, records.world);
    await writeJsonAtomic(this.playersPath, records.players);
    await writeJsonAtomic(this.metaPath, meta);
    serverLog('world saved');
  }
}
