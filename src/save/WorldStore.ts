import type { WorldSnapshot, WorldSummary } from './types';

/**
 * Storage backend for a `WorldSnapshot`. Simulation never calls IndexedDB or
 * `fs.writeFile` directly.
 */
export interface WorldStore {
  load(worldId: string): Promise<WorldSnapshot | null>;
  save(world: WorldSnapshot): Promise<void>;
  exists(worldId: string): Promise<boolean>;
  delete?(worldId: string): Promise<void>;
  list?(): Promise<WorldSummary[]>;
}
