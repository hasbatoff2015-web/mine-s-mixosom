import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { databaseApplicationName } from '../../server/db/database';
import {
  DB_POOL_DEFAULT,
  DB_POOL_MAX_LIMIT,
  DB_POOL_MIN,
  databaseLogLabel,
  loadDatabaseConfig,
  loadServerConfig,
} from '../../server/config';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PASSWORD = 'super-secret-password';
const USER = 'fc_audit_user';
const connectionUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:5432/megacraft_dev`;

describe('database config', () => {
  it('disables PostgreSQL when the URL is missing or blank', () => {
    expect(loadDatabaseConfig({}).enabled).toBe(false);
    expect(loadDatabaseConfig({ FC_DATABASE_URL: '   ', FC_DEPLOYMENT_ID: 'dev' }).enabled).toBe(false);
    expect(loadDatabaseConfig({ FC_DEPLOYMENT_ID: 'prod' }).enabled).toBe(false);
    expect(loadServerConfig({}).database).toEqual({ enabled: false });
  });

  it('rejects a URL without a deployment id and does not echo the URL', () => {
    expect(() => loadDatabaseConfig({ FC_DATABASE_URL: connectionUrl })).toThrow(/FC_DEPLOYMENT_ID/);
    expect(() => loadDatabaseConfig({ FC_DATABASE_URL: connectionUrl, FC_DEPLOYMENT_ID: '   ' })).toThrow(/FC_DEPLOYMENT_ID/);
    try {
      loadDatabaseConfig({ FC_DATABASE_URL: connectionUrl, FC_DEPLOYMENT_ID: '' });
      throw new Error('expected rejection');
    } catch (error) {
      const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(USER);
      expect(text).not.toContain('postgresql://');
      expect(text).not.toContain(connectionUrl);
    }
  });

  it('rejects a bad scheme or an unparseable URL without echoing secrets', () => {
    expect(() => loadDatabaseConfig({
      FC_DATABASE_URL: 'http://example.test/megacraft_dev',
      FC_DEPLOYMENT_ID: 'dev',
    })).toThrow(/postgres: or postgresql:/);
    const junk = `not a url ${PASSWORD}`;
    try {
      loadDatabaseConfig({ FC_DATABASE_URL: junk, FC_DEPLOYMENT_ID: 'dev' });
      throw new Error('expected rejection');
    } catch (error) {
      const text = String(error);
      expect(text).toMatch(/not a valid URL/);
      expect(text).not.toContain(PASSWORD);
    }
  });

  it('accepts an explicit deployment id and a postgres scheme', () => {
    const loaded = loadDatabaseConfig({
      FC_DATABASE_URL: 'postgres://localhost/megacraft_dev',
      FC_DEPLOYMENT_ID: ' prod ',
    });
    expect(loaded.enabled).toBe(true);
    if (!loaded.enabled) return;
    expect(loaded.deploymentId).toBe('prod');
    expect(loaded.url).toBe('postgres://localhost/megacraft_dev');
    expect(loaded.poolMax).toBe(DB_POOL_DEFAULT);
    for (const id of ['dev', 'prod', 'a', `${'a'.repeat(63)}-`]) {
      const config = loadDatabaseConfig({ FC_DATABASE_URL: connectionUrl, FC_DEPLOYMENT_ID: id });
      expect(config.enabled).toBe(true);
    }
  });

  it('rejects deployment ids that are not an explicit token', () => {
    for (const id of ['', 'dev/prod', '.dev', 'has space', 'a'.repeat(65), 'кириллица']) {
      expect(() => loadDatabaseConfig({ FC_DATABASE_URL: connectionUrl, FC_DEPLOYMENT_ID: id })).toThrow(/FC_DEPLOYMENT_ID/);
    }
  });

  it('clamps the pool size', () => {
    const cases: Array<[string | undefined, number]> = [
      [undefined, DB_POOL_DEFAULT],
      ['', DB_POOL_DEFAULT],
      ['nope', DB_POOL_DEFAULT],
      ['0', DB_POOL_MIN],
      ['-3', DB_POOL_MIN],
      ['1', 1],
      ['2', 2],
      ['4.9', 4],
      ['8', DB_POOL_MAX_LIMIT],
      ['100', DB_POOL_MAX_LIMIT],
    ];
    for (const [raw, expected] of cases) {
      const config = loadDatabaseConfig({
        FC_DATABASE_URL: connectionUrl,
        FC_DEPLOYMENT_ID: 'dev',
        ...(raw === undefined ? {} : { FC_DB_POOL_MAX: raw }),
      });
      expect(config.enabled).toBe(true);
      if (config.enabled) expect(config.poolMax).toBe(expected);
    }
  });

  it('keeps the URL out of the log label and out of config loading', () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((method) => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    }));
    try {
      const config = loadServerConfig({
        FC_DATABASE_URL: connectionUrl,
        FC_DEPLOYMENT_ID: 'dev',
        FC_DB_POOL_MAX: '2',
      });
      expect(databaseLogLabel(config.database)).toBe('database: enabled deployment=dev poolMax=2');
      expect(databaseLogLabel({ enabled: false })).toBe('database: disabled');
      const text = `${logs.join('\n')}\n${databaseLogLabel(config.database)}`;
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(USER);
      expect(text).not.toContain(connectionUrl);
      expect(text).not.toContain('postgresql://');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('keeps application_name inside PostgreSQL name length', () => {
    expect(databaseApplicationName('dev')).toBe('frontier-cubes:dev');
    expect(databaseApplicationName('a'.repeat(64)).length).toBeLessThanOrEqual(63);
    const source = readFileSync(join(ROOT, 'server/db/database.ts'), 'utf8');
    expect(source).toContain('application_name: databaseApplicationName(this.deploymentId)');
  });
});
