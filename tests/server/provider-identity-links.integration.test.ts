import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase } from '../../server/db/database';
import { bindVerifiedProviderIdentity, lookupVerifiedProviderIdentity, type IdentityScope } from '../../server/identity/providerLinks';
import {
  consumeReservedProof,
  purgeExpiredReceipts,
  receiptRetentionSeconds,
  releaseReservedProof,
  reserveResumeProof,
} from '../../server/identity/yandexProofReceipts';
import { legacyProofFingerprint, verifyYandexPlayerProof } from '../../server/identity/yandexVerifier';
import { SYNTHETIC_ISSUED_AT, SYNTHETIC_NOW_MS, SYNTHETIC_YANDEX_SECRET, signedPlayerProfile } from './yandexProfileFixture';

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
    const proof = signedPlayerProfile('Y1', SYNTHETIC_YANDEX_SECRET, SYNTHETIC_ISSUED_AT);
    const checked = verifyYandexPlayerProof(proof, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: SYNTHETIC_NOW_MS,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    if (!checked.ok) throw new Error(checked.reason);
    const verified = checked.identity;
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

  it('reserves one resume proof per world and releases only that attempt', async () => {
    const name = await schema();
    const db = open(name);
    await db.start();
    expect(db.appliedMigrations).toContain('0010');
    const hash = 'a'.repeat(64);
    const attempt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const survival = { ...scope, serverMode: 'survival', worldId: 'survival' };
    expect(await reserveResumeProof(db, scope, hash, A, attempt)).toBe('reserved');
    expect(await reserveResumeProof(db, scope, hash, B, other)).toBe('reused');
    await releaseReservedProof(db, scope, hash, other);
    expect(await reserveResumeProof(db, scope, hash, A, other)).toBe('reused');
    expect(await reserveResumeProof(db, survival, hash, A, other)).toBe('reserved');
    await releaseReservedProof(db, survival, hash, other);
    expect(await reserveResumeProof(db, survival, hash, A, attempt)).toBe('reserved');
    const [left, right] = await Promise.all([
      reserveResumeProof(db, { ...scope, worldId: 'world-b' }, hash, A, attempt),
      reserveResumeProof(db, { ...scope, worldId: 'world-b' }, hash, B, other),
    ]);
    expect([left, right].sort()).toEqual(['reserved', 'reused']);
    expect(await consumeReservedProof(db, scope, hash, other)).toBe(false);
    expect(await consumeReservedProof(db, scope, hash, attempt)).toBe(true);
    expect(await consumeReservedProof(db, scope, hash, attempt)).toBe(false);
    await releaseReservedProof(db, scope, hash, attempt);
    const consumed = await db.query<{ state: string }>(
      `SELECT state FROM yandex_proof_receipts WHERE proof_hash = $1 AND server_mode = 'anarchy' AND world_id = 'world-a'`,
      [hash],
    );
    expect(consumed.rows[0]?.state).toBe('consumed');
  }, 30_000);

  it('keeps a 0009 string hash blocking only that proof and isolates cleanup', async () => {
    const name = await schema();
    const db = open(name);
    await db.start();
    expect(db.appliedMigrations).toContain('0009');
    expect(db.appliedMigrations).toContain('0010');
    const attempt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const proof = signedPlayerProfile('legacy-user', SYNTHETIC_YANDEX_SECRET, SYNTHETIC_ISSUED_AT);
    const verified = verifyYandexPlayerProof(proof, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: SYNTHETIC_NOW_MS,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    if (!verified.ok) throw new Error(verified.reason);
    const legacy = legacyProofFingerprint(proof);
    expect(legacy).toBe(createHash('sha256').update(proof, 'utf8').digest('hex'));
    expect(legacy).not.toBe(verified.identity.proofHash);
    await db.query(
      `INSERT INTO yandex_proof_receipts
        (deployment_id, proof_hash, player_id, purpose, server_mode, world_id, state)
       VALUES ('dev', $1, $2::uuid, 'resume', 'legacy', 'legacy', 'consumed')`,
      [legacy, A],
    );
    expect(await reserveResumeProof(db, scope, verified.identity.proofHash, A, attempt, legacy)).toBe('reused');
    const fresh = signedPlayerProfile('legacy-user', SYNTHETIC_YANDEX_SECRET, SYNTHETIC_ISSUED_AT + 1);
    const freshVerified = verifyYandexPlayerProof(fresh, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: SYNTHETIC_NOW_MS,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    if (!freshVerified.ok) throw new Error(freshVerified.reason);
    expect(await reserveResumeProof(
      db,
      scope,
      freshVerified.identity.proofHash,
      A,
      other,
      legacyProofFingerprint(fresh),
    )).toBe('reserved');
    await expect(consumeReservedProof(db, scope, freshVerified.identity.proofHash, 'not-a-uuid')).rejects.toThrow();
    const still = await db.query<{ state: string }>(
      `SELECT state FROM yandex_proof_receipts WHERE proof_hash = $1`,
      [freshVerified.identity.proofHash],
    );
    expect(still.rows[0]?.state).toBe('reserved');
    expect(await consumeReservedProof(db, scope, freshVerified.identity.proofHash, other)).toBe(true);
    await db.query(
      `INSERT INTO yandex_proof_receipts
        (deployment_id, proof_hash, player_id, purpose, server_mode, world_id, state, created_at)
       VALUES
        ('prod', $1, $2::uuid, 'resume', 'anarchy', 'world-a', 'consumed', NOW() - interval '30 days'),
        ('dev', $3, $2::uuid, 'resume', 'survival', 'survival', 'consumed', NOW() - interval '30 days')`,
      ['11'.repeat(32), A, '22'.repeat(32)],
    );
    await db.query(
      `UPDATE yandex_proof_receipts SET created_at = NOW() - interval '30 days'
       WHERE proof_hash = $1`,
      [freshVerified.identity.proofHash],
    );
    await Promise.all([
      purgeExpiredReceipts(db, scope, receiptRetentionSeconds(600, 120)),
      purgeExpiredReceipts(db, scope, receiptRetentionSeconds(600, 120)),
    ]);
    const leftRows = await db.query<{ deployment_id: string; server_mode: string; proof_hash: string }>(
      `SELECT deployment_id, server_mode, proof_hash FROM yandex_proof_receipts ORDER BY proof_hash`,
    );
    const hashes = leftRows.rows.map((row) => `${row.deployment_id}:${row.server_mode}:${row.proof_hash}`);
    expect(hashes).toContain(`prod:anarchy:${'11'.repeat(32)}`);
    expect(hashes).toContain(`dev:survival:${'22'.repeat(32)}`);
    expect(hashes.some((row) => row.endsWith(freshVerified.identity.proofHash))).toBe(false);
    expect(hashes.some((row) => row.includes(legacy))).toBe(true);
  }, 30_000);
});
