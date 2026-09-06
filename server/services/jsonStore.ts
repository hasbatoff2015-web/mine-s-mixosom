import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Small JSON files next to the world save. Same atomic temp+rename pattern as
 * WorldPersistence, but synchronous so command handlers can persist immediately.
 */
export class JsonFileStore {
  constructor(readonly directory: string) {}

  pathFor(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/^\//, '');
    return join(this.directory, safe.endsWith('.json') ? safe : `${safe}.json`);
  }

  load<T>(name: string, fallback: T): T {
    try {
      const raw = readFileSync(this.pathFor(name), 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return fallback;
      throw error;
    }
  }

  save(name: string, value: unknown): void {
    const path = this.pathFor(name);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temp, path);
  }
}
