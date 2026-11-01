import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import { DatabaseClosedError } from '../../server/db/errors';

const PASSWORD = 'super-secret-password';
const USER = 'fc_audit_user';
const URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:1/megacraft_dev`;

describe('configured database failure', () => {
  it('fails closed without printing the url, user, or password', async () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((method) => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    }));
    try {
      const db = new PostgresDatabase({ url: URL, deploymentId: 'dev', poolMax: 4 });
      let thrown = '';
      try {
        await db.start();
        throw new Error('expected startup to fail');
      } catch (error) {
        thrown = error instanceof Error ? `${error.name}\n${error.message}\n${error.stack ?? ''}` : String(error);
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) expect(error.name).toBe('DatabaseError');
      }
      const text = `${logs.join('\n')}\n${thrown}`;
      expect(text).not.toContain('database: ready');
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(USER);
      expect(text).not.toContain(URL);
      expect(text).not.toContain('postgresql://');
      await db.close();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }, 20_000);

  it('treats close before start as closed, including a second close', async () => {
    const db = new PostgresDatabase({ url: URL, deploymentId: 'dev', poolMax: 1 });
    await db.close();
    await db.close();
    await expect(db.start()).rejects.toBeInstanceOf(DatabaseClosedError);
    expect(() => new PostgresDatabase({ url: URL, deploymentId: ' ', poolMax: 1 })).toThrow(/FC_DEPLOYMENT_ID/);
    expect(() => new PostgresDatabase({ url: URL, deploymentId: 'dev', poolMax: 9 })).toThrow(/pool max/);
  });
});
