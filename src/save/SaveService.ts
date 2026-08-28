import type { GameMode, SerializedWorldState, WorldSummary } from './types';
import { isServerWorldSummary } from '../world/import/anarchy';

const DATABASE = 'frontier-cubes-saves';
const STORE = 'worlds';
const VERSION = 1;

export class SaveService {
  private database?: IDBDatabase;
  private memory = new Map<string, SerializedWorldState>();

  async initialize(): Promise<void> {
    if (!('indexedDB' in window)) return;
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'summary.id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  createSummary(name: string, seed: string, mode: GameMode): WorldSummary {
    const now = Date.now();
    return {
      id: crypto.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
      name: name.trim() || 'Новый мир',
      seed: seed.trim() || `${Math.floor(Math.random() * 2_147_483_647)}`,
      mode,
      createdAt: now,
      updatedAt: now,
      playTimeSeconds: 0,
    };
  }

  async listWorlds(): Promise<WorldSummary[]> {
    const worlds = this.database
      ? await this.request<SerializedWorldState[]>('readonly', (store) => store.getAll())
      : [...this.memory.values()];
    return worlds
      .map((world) => world.summary)
      .filter((summary) => !isServerWorldSummary(summary))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadWorld(id: string): Promise<SerializedWorldState | undefined> {
    if (!this.database) return structuredClone(this.memory.get(id));
    const world = await this.request<SerializedWorldState | undefined>('readonly', (store) => store.get(id));
    return world ? structuredClone(world) : undefined;
  }

  async saveWorld(state: SerializedWorldState): Promise<void> {
    const copy = structuredClone(state);
    copy.summary.updatedAt = Date.now();
    if (!this.database) {
      this.memory.set(copy.summary.id, copy);
      return;
    }
    await this.request<IDBValidKey>('readwrite', (store) => store.put(copy));
  }

  async deleteWorld(id: string): Promise<void> {
    if (!this.database) {
      this.memory.delete(id);
      return;
    }
    await this.request<undefined>('readwrite', (store) => store.delete(id));
  }

  close(): void {
    this.database?.close();
  }

  private request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    if (!this.database) return Promise.reject(new Error('Save database is not initialized.'));
    return new Promise<T>((resolve, reject) => {
      const transaction = this.database!.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
