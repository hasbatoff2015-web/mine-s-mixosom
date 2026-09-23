import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerMode } from './config';
import { serverLog } from './log';

export const WORLD_LOCK_FILE = '.instance.lock';

export interface WorldLockInfo {
  readonly pid: number;
  readonly mode: ServerMode;
  readonly worldId: string;
  readonly port: number;
}

export class WorldDirectoryLock {
  constructor(
    readonly directory: string,
    readonly info: WorldLockInfo,
  ) {}

  get path(): string {
    return join(this.directory, WORLD_LOCK_FILE);
  }

  async release(): Promise<void> {
    try {
      const current = await readLock(this.path);
      if (current && current.pid !== process.pid) return;
      await rm(this.path, { force: true });
      serverLog(`world lock released world=${this.info.worldId} pid=${this.info.pid}`);
    } catch {
      // The directory may already be gone.
    }
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Exclusive ownership of one world directory. A second process (or a second
 * instance in this process) that targets the same directory fails before it
 * can read or write the JSON store.
 */
export async function acquireWorldDirectoryLock(
  directory: string,
  info: Omit<WorldLockInfo, 'pid'>,
): Promise<WorldDirectoryLock> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, WORLD_LOCK_FILE);
  const payload: WorldLockInfo = { pid: process.pid, ...info };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      serverLog(
        `world lock acquired world=${payload.worldId} mode=${payload.mode} pid=${payload.pid} port=${payload.port}`,
      );
      return new WorldDirectoryLock(directory, payload);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readLock(path);
      if (existing && pidAlive(existing.pid)) {
        throw new Error(
          `World directory is already owned by pid ${existing.pid}`
          + ` (mode ${existing.mode}, world ${existing.worldId}, port ${existing.port}): ${directory}`,
        );
      }
      if (existing) {
        serverLog(`world lock stale pid=${existing.pid} world=${existing.worldId} path=${path}`);
      }
      await rm(path, { force: true });
    }
  }
  throw new Error(`Could not acquire world directory lock: ${directory}`);
}

async function readLock(path: string): Promise<WorldLockInfo | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<WorldLockInfo>;
    if (typeof raw.pid !== 'number' || typeof raw.worldId !== 'string') return undefined;
    const mode: ServerMode = raw.mode === 'survival' || raw.mode === 'peaceful' ? raw.mode : 'anarchy';
    return {
      pid: raw.pid,
      mode,
      worldId: raw.worldId,
      port: typeof raw.port === 'number' ? raw.port : 0,
    };
  } catch {
    return undefined;
  }
}
