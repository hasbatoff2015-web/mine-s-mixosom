import { PersistenceError } from '../src/save/PersistenceError';
import { parseWorldSnapshot } from '../src/save/snapshot';
import type { WorldSnapshot } from '../src/save/types';
import type { WorldStore } from '../src/save/WorldStore';

export interface ImportWorldDumpOptions {
  readonly store: WorldStore;
  readonly worldId: string;
  readonly fallbackSeed: string;
  readonly raw: unknown;
  readonly force?: boolean;
}

/**
 * IndexedDB `SerializedWorldState` dump → shared snapshot → WorldStore.
 * Never runs on ordinary server startup.
 */
export async function importWorldDump(options: ImportWorldDumpOptions): Promise<WorldSnapshot> {
  const parsed = parseWorldSnapshot(options.raw);
  const snapshot: WorldSnapshot = {
    ...parsed,
    summary: {
      ...parsed.summary,
      id: options.worldId,
      seed: parsed.summary.seed || options.fallbackSeed,
      kind: 'server',
    },
  };
  if (!options.force && await options.store.exists(options.worldId)) {
    throw new PersistenceError(
      `World already exists (${options.worldId}). Pass --force to overwrite.`,
      'exists',
    );
  }
  await options.store.save(snapshot);
  return snapshot;
}
