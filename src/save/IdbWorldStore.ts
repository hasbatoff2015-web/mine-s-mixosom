import { SaveService } from './SaveService';
import { cloneWorldSnapshot, parseWorldSnapshot, worldIdOf } from './snapshot';
import type { GameMode, WorldSnapshot, WorldSummary } from './types';
import type { WorldStore } from './WorldStore';

/**
 * IndexedDB adapter. Database `frontier-cubes-saves`, store `worlds`, key `summary.id`.
 * Existing schema version 1 records load without renaming the database.
 */
export class IdbWorldStore implements WorldStore {
  constructor(private readonly inner = new SaveService()) {}

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  close(): void {
    this.inner.close();
  }

  createSummary(name: string, seed: string, mode: GameMode): WorldSummary {
    return this.inner.createSummary(name, seed, mode);
  }

  async load(worldId: string): Promise<WorldSnapshot | null> {
    const raw = await this.inner.loadWorld(worldId);
    if (!raw) return null;
    return parseWorldSnapshot(raw);
  }

  async save(world: WorldSnapshot): Promise<void> {
    const snapshot = cloneWorldSnapshot(parseWorldSnapshot(world));
    await this.inner.saveWorld(snapshot);
  }

  async exists(worldId: string): Promise<boolean> {
    return (await this.inner.loadWorld(worldId)) !== undefined;
  }

  async delete(worldId: string): Promise<void> {
    await this.inner.deleteWorld(worldId);
  }

  async list(): Promise<WorldSummary[]> {
    return this.inner.listWorlds();
  }

  /** @deprecated Prefer `load`. Kept for call sites that still use SaveService names. */
  async loadWorld(id: string): Promise<WorldSnapshot | undefined> {
    return (await this.load(id)) ?? undefined;
  }

  /** @deprecated Prefer `save`. */
  async saveWorld(state: WorldSnapshot): Promise<void> {
    await this.save(state);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.delete(id);
  }

  async listWorlds(): Promise<WorldSummary[]> {
    return this.list();
  }

  worldId(world: WorldSnapshot): string {
    return worldIdOf(world);
  }
}
