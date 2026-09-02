import { join } from 'node:path';
import { PersistenceError } from '../src/save/PersistenceError';
import { fsRecordsToSnapshot, snapshotToFsRecords } from '../src/save/fsRecords';
import { parseWorldSnapshot, worldIdOf } from '../src/save/snapshot';
import type { WorldSnapshot } from '../src/save/types';
import type { WorldStore } from '../src/save/WorldStore';
import { WorldPersistence } from './persistence';

/**
 * Filesystem adapter. Layout stays `dataDir/<worldId>/{meta,world,players}.json`.
 */
export class FsWorldStore implements WorldStore {
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly dataDir: string) {}

  directoryFor(worldId: string): string {
    return join(this.dataDir.replace(/\\/g, '/'), worldId);
  }

  private persistence(worldId: string): WorldPersistence {
    return new WorldPersistence(this.directoryFor(worldId));
  }

  async load(worldId: string): Promise<WorldSnapshot | null> {
    const records = await this.persistence(worldId).loadRecords();
    if (!records) return null;
    return parseWorldSnapshot(fsRecordsToSnapshot(records));
  }

  async save(world: WorldSnapshot): Promise<void> {
    const snapshot = parseWorldSnapshot(world);
    const run = this.chain.then(() => this.write(snapshot));
    this.chain = run.then(() => undefined, () => undefined);
    await run;
  }

  private async write(snapshot: WorldSnapshot): Promise<void> {
    const id = worldIdOf(snapshot);
    await this.persistence(id).saveRecords(snapshotToFsRecords(snapshot));
  }

  async exists(worldId: string): Promise<boolean> {
    return this.persistence(worldId).exists();
  }

  async delete(worldId: string): Promise<void> {
    throw new PersistenceError(
      `Refusing to delete filesystem world ${worldId} without an explicit operator tool.`,
      'unsupported',
    );
  }
}
