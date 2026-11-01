import { describe, expect, it, vi } from 'vitest';
import { loadServerConfig } from '../../server/config';
import { DisabledDatabase, createDatabase } from '../../server/db/database';
import { DatabaseClosedError, DatabaseDisabledError } from '../../server/db/errors';
import * as pg from 'pg';

const pools = vi.hoisted(() => ({ count: 0 }));

vi.mock('pg', () => {
  class Pool {
    static readonly mocked = true;

    constructor() {
      pools.count += 1;
    }
  }
  return { Pool, default: { Pool } };
});

describe('disabled database', () => {
  it('does not construct a pool and still starts', async () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((method) => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    }));
    try {
      const db = createDatabase(loadServerConfig({}));
      expect((pg.Pool as unknown as { mocked?: boolean }).mocked).toBe(true);
      expect(db).toBeInstanceOf(DisabledDatabase);
      expect(db.enabled).toBe(false);
      expect(db.deploymentId).toBeNull();
      await db.start();
      await db.start();
      await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(DatabaseDisabledError);
      await expect(db.transaction(async () => 1)).rejects.toBeInstanceOf(DatabaseDisabledError);
      await db.close();
      await db.close();
      await expect(db.start()).rejects.toBeInstanceOf(DatabaseClosedError);
      expect(pools.count).toBe(0);
      expect(logs.filter((line) => line.includes('database: disabled'))).toHaveLength(1);
      expect(logs.join('\n')).not.toContain('database: ready');
      expect(logs.join('\n')).not.toContain('postgresql://');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
