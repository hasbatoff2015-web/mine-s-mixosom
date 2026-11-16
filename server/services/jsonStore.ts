import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Small JSON files next to the world save. Same atomic temp+rename pattern as
 * WorldPersistence, but synchronous so command handlers can persist immediately.
 */
export class JsonFileStore {
  /** Incremented on every load(), including missing-file fallbacks. Tests use this. */
  readCount = 0;

  constructor(readonly directory: string) {}

  pathFor(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/^\//, '');
    return join(this.directory, safe.endsWith('.json') ? safe : `${safe}.json`);
  }

  /** Missing file is distinct from corrupt JSON. Corrupt JSON throws and is not a fallback. */
  read(name: string): { missing: true } | { missing: false; value: unknown } {
    this.readCount += 1;
    try {
      const raw = readFileSync(this.pathFor(name), 'utf8');
      try {
        return { missing: false, value: JSON.parse(raw) as unknown };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw Object.assign(new Error(`Invalid JSON in ${name}: ${reason}`), { code: 'EJSON' });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { missing: true };
      throw error;
    }
  }

  load<T>(name: string, fallback: T): T {
    const read = this.read(name);
    if (read.missing) return fallback;
    return read.value as T;
  }

  save(name: string, value: unknown): void {
    const path = this.pathFor(name);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }
}
