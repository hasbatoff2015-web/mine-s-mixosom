import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import { bindVerifiedProviderIdentity, lookupVerifiedProviderIdentity, type IdentityScope } from '../../server/identity/providerLinks';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope: IdentityScope = { deploymentId: 'dev', serverMode: 'anarchy', worldId: 'world-a' };

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error('FC_TEST_DATABASE_URL scheme');
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name)) throw new Error('refusing database name');
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('provider identity links on PostgreSQL', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;

  function open(searchPath: string): PostgresDatabase {
    const database = new PostgresDatabase({ url: databaseUrl, deploymentId: 'dev', poolMax: 4, searchPath });
    opened.push(database);
    return database;
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
  }, 30_000);

  afterAll(async () => {
    for (const database of opened.splice(0)) await database.close().catch(() => undefined);
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
    }
  }, 30_000);

  async function schema(): Promise<string> {
    const name = `fc_link_${randomBytes(6).toString('hex')}`;
    await admin!.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  it('enforces one provider account and one player link, including a race', async () => {
    const name = await schema();
    const db = open(name);
    await db.start();
    expect(db.appliedMigrations).toContain('0008');
    const verified = { verified: true as const, provider: 'yandex' as const, providerUserId: 'Y1' };
    const [left, right] = await Promise.all([
      bindVerifiedProviderIdentity(db, scope, verified, A, () => true),
      bindVerifiedProviderIdentity(db, scope, verified, B, () => true),
    ]);
    expect([left.status, right.status].sort()).toEqual(['linked', 'provider_conflict']);
    const again = open(name);
    await again.start();
    expect(again.appliedMigrations).toEqual([]);
    expect(await lookupVerifiedProviderIdentity(again, scope, verified)).toEqual({
      status: 'found',
      playerId: left.status === 'linked' ? A : B,
    });
    await expect(again.query(
      `INSERT INTO player_identity_links (deployment_id, server_mode, world_id, provider, provider_user_id, player_id)
       VALUES ('dev', 'anarchy', 'world-a', 'yandex', 'Y1', $1::uuid)`,
      [A],
    )).rejects.toThrow(/player_identity_links_provider_user|duplicate key/i);
  }, 30_000);
});
