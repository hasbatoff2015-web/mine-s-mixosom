import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database, Queryable } from '../../server/db/types';
import {
  PURGE_EXPIRED_RECEIPTS_SQL,
  consumeReservedProof,
  purgeExpiredReceipts,
  receiptRetentionSeconds,
  releaseReservedProof,
  reserveResumeProof,
} from '../../server/identity/yandexProofReceipts';
import { legacyProofFingerprint, verifyYandexPlayerProof } from '../../server/identity/yandexVerifier';
import { SYNTHETIC_YANDEX_SECRET, signedPlayerProfile } from './yandexProfileFixture';

const scope = { deploymentId: 'dev', serverMode: 'anarchy' as const, worldId: 'anarchy' };
const player = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attempt = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherAttempt = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface Row {
  deploymentId: string;
  serverMode: string;
  worldId: string;
  proofHash: string;
  state: 'reserved' | 'consumed';
  attemptId: string;
  createdAt: number;
}

class ReceiptDb implements Database {
  readonly enabled = true;
  readonly deploymentId = 'dev';
  readonly appliedMigrations: readonly string[] = [];
  readonly rows: Row[] = [];
  now = 1_000_000;
  failConsume = false;

  async start(): Promise<void> {}
  async close(): Promise<void> {}
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes("server_mode = 'legacy'")) {
      const hit = this.rows.some((row) => row.deploymentId === String(params[0])
        && row.serverMode === 'legacy'
        && row.proofHash === String(params[1]));
      return { rows: (hit ? [{}] : []) as T[], rowCount: hit ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO yandex_proof_receipts')) {
      const key = this.rows.find((row) => row.deploymentId === String(params[0])
        && row.serverMode === String(params[1])
        && row.worldId === String(params[2])
        && row.proofHash === String(params[3]));
      if (key) return { rows: [], rowCount: 0 };
      this.rows.push({
        deploymentId: String(params[0]),
        serverMode: String(params[1]),
        worldId: String(params[2]),
        proofHash: String(params[3]),
        state: 'reserved',
        attemptId: String(params[5]),
        createdAt: this.now,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET state = 'consumed'")) {
      if (this.failConsume) throw new Error('consume failed');
      const row = this.rows.find((item) => item.deploymentId === String(params[0])
        && item.serverMode === String(params[1])
        && item.worldId === String(params[2])
        && item.proofHash === String(params[3])
        && item.state === 'reserved'
        && item.attemptId === String(params[4]));
      if (!row) return { rows: [], rowCount: 0 };
      row.state = 'consumed';
      return { rows: [], rowCount: 1 };
    }
    if (sql === PURGE_EXPIRED_RECEIPTS_SQL) {
      const olderThan = Number(params[0]);
      const cutoff = this.now - olderThan;
      let removed = 0;
      for (let index = this.rows.length - 1; index >= 0 && removed < 500; index -= 1) {
        const row = this.rows[index];
        if (!row) continue;
        if (row.deploymentId !== String(params[1]) || row.serverMode !== String(params[2]) || row.worldId !== String(params[3])) continue;
        if (row.createdAt >= cutoff) continue;
        this.rows.splice(index, 1);
        removed += 1;
      }
      return { rows: [], rowCount: removed };
    }
    if (sql.includes('DELETE FROM yandex_proof_receipts')) {
      const index = this.rows.findIndex((row) => row.deploymentId === String(params[0])
        && row.serverMode === String(params[1])
        && row.worldId === String(params[2])
        && row.proofHash === String(params[3])
        && row.state === 'reserved'
        && row.attemptId === String(params[4]));
      if (index < 0) return { rows: [], rowCount: 0 };
      this.rows.splice(index, 1);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('yandex proof receipts', () => {
  it('blocks a legacy string hash without creating a second identity', async () => {
    const proof = signedPlayerProfile('legacy-user', SYNTHETIC_YANDEX_SECRET, 1_700_000_000);
    const verified = verifyYandexPlayerProof(proof, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: 1_700_000_000_000,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    if (!verified.ok) throw new Error(verified.reason);
    const legacy = legacyProofFingerprint(proof);
    expect(legacy).not.toBe(verified.identity.proofHash);
    expect(legacy).toBe(createHash('sha256').update(proof, 'utf8').digest('hex'));
    const db = new ReceiptDb();
    db.rows.push({
      deploymentId: 'dev',
      serverMode: 'legacy',
      worldId: 'legacy',
      proofHash: legacy,
      state: 'consumed',
      attemptId: attempt,
      createdAt: 1,
    });
    expect(await reserveResumeProof(db, scope, verified.identity.proofHash, player, attempt, legacy)).toBe('reused');
    expect(db.rows).toHaveLength(1);
    const other = signedPlayerProfile('legacy-user', SYNTHETIC_YANDEX_SECRET, 1_700_000_010);
    const otherVerified = verifyYandexPlayerProof(other, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: 1_700_000_000_000,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    if (!otherVerified.ok) throw new Error(otherVerified.reason);
    expect(await reserveResumeProof(
      db,
      scope,
      otherVerified.identity.proofHash,
      player,
      otherAttempt,
      legacyProofFingerprint(other),
    )).toBe('reserved');
    expect(await consumeReservedProof(db, scope, otherVerified.identity.proofHash, otherAttempt)).toBe(true);
    expect(await consumeReservedProof(db, scope, otherVerified.identity.proofHash, otherAttempt)).toBe(false);
    const bad = verifyYandexPlayerProof(`${proof}x`, {
      secret: SYNTHETIC_YANDEX_SECRET,
      nowMs: 1_700_000_000_000,
      maxAgeSeconds: 600,
      clockSkewSeconds: 120,
    });
    expect(bad.ok).toBe(false);
  });

  it('keeps an unknown consume and releases only the matching reservation', async () => {
    const db = new ReceiptDb();
    const hash = 'ab'.repeat(32);
    expect(await reserveResumeProof(db, scope, hash, player, attempt)).toBe('reserved');
    db.failConsume = true;
    await expect(consumeReservedProof(db, scope, hash, attempt)).rejects.toThrow(/consume failed/);
    expect(db.rows[0]?.state).toBe('reserved');
    await releaseReservedProof(db, scope, hash, otherAttempt);
    expect(db.rows).toHaveLength(1);
    db.failConsume = false;
    expect(await consumeReservedProof(db, scope, hash, otherAttempt)).toBe(false);
    expect(await consumeReservedProof(db, scope, hash, attempt)).toBe(true);
    await releaseReservedProof(db, scope, hash, attempt);
    expect(db.rows[0]?.state).toBe('consumed');
  });

  it('purges only expired rows in the caller scope', async () => {
    const db = new ReceiptDb();
    db.now = 20_000;
    const keep: Row = {
      deploymentId: 'dev',
      serverMode: 'anarchy',
      worldId: 'anarchy',
      proofHash: 'aa'.repeat(32),
      state: 'reserved',
      attemptId: attempt,
      createdAt: 19_000,
    };
    const old: Row = { ...keep, proofHash: 'bb'.repeat(32), state: 'consumed', createdAt: 1 };
    const prod: Row = { ...old, deploymentId: 'prod', proofHash: 'cc'.repeat(32) };
    const survival: Row = { ...old, serverMode: 'survival', worldId: 'survival', proofHash: 'dd'.repeat(32) };
    db.rows.push(keep, old, prod, survival);
    expect(PURGE_EXPIRED_RECEIPTS_SQL).toContain('deployment_id = $2');
    expect(PURGE_EXPIRED_RECEIPTS_SQL).toContain('server_mode = $3');
    expect(PURGE_EXPIRED_RECEIPTS_SQL).toContain('world_id = $4');
    expect(PURGE_EXPIRED_RECEIPTS_SQL).toContain('SKIP LOCKED');
    await purgeExpiredReceipts(db, scope, receiptRetentionSeconds(600, 120));
    expect(db.rows.map((row) => row.proofHash).sort()).toEqual([keep.proofHash, prod.proofHash, survival.proofHash].sort());
    expect(receiptRetentionSeconds(60, 0)).toBe(3600 + 600 + 3600);
  });
});
