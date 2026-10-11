import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AdminAuditService } from '../../../server/db/audit';
import { IdempotencyConflictError } from '../../../server/db/errors';
import { IdempotencyService } from '../../../server/db/idempotency';
import type { Database } from '../../../server/db/types';

const DEPLOYMENT = 'dev';

export function registerIdempotencyCases(
  create: () => Database,
  options?: { manageLifecycle?: boolean },
): void {
  const manage = options?.manageLifecycle !== false;

  async function withDb(run: (db: Database) => Promise<void>): Promise<void> {
    const db = create();
    if (manage) await db.start();
    try {
      await run(db);
    } finally {
      if (manage) await db.close();
    }
  }

  it('runs the callback once and replays the stored response', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      const requestId = randomUUID();
      let calls = 0;
      const request = {
        deploymentId: DEPLOYMENT,
        requestId,
        operation: 'grant',
        actorId: 'admin-1',
        payload: { amount: 5, note: 'a' },
      };
      const first = await service.execute(request, async () => {
        calls += 1;
        return { ok: true, amount: 5 };
      });
      const replay = await service.execute({
        ...request,
        payload: { note: 'a', amount: 5 },
      }, async () => {
        calls += 1;
        return { ok: false };
      });
      expect(first).toEqual({ ok: true, amount: 5 });
      expect(replay).toEqual(first);
      expect(calls).toBe(1);
    });
  });

  it('rejects the same request id when the payload, actor, or operation differs', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      const requestId = randomUUID();
      const base = {
        deploymentId: DEPLOYMENT,
        requestId,
        operation: 'grant',
        actorId: 'admin-1',
        payload: { amount: 1 },
      };
      await service.execute(base, async () => ({ ok: true }));
      await expect(service.execute({ ...base, payload: { amount: 2 } }, async () => ({ ok: true })))
        .rejects.toMatchObject({ mismatch: 'payload' });
      await expect(service.execute({ ...base, actorId: 'admin-2' }, async () => ({ ok: true })))
        .rejects.toMatchObject({ mismatch: 'actor' });
      await expect(service.execute({ ...base, operation: 'revoke' }, async () => ({ ok: true })))
        .rejects.toMatchObject({ mismatch: 'operation' });
    });
  });

  it('rejects a different deployment before the callback', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      let calls = 0;
      const error = await service.execute({
        deploymentId: 'prod',
        requestId: randomUUID(),
        operation: 'grant',
        actorId: 'admin-1',
        payload: { n: 1 },
      }, async () => {
        calls += 1;
        return { ok: true };
      }).then(() => {
        throw new Error('expected a conflict');
      }, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(IdempotencyConflictError);
      expect((error as IdempotencyConflictError).mismatch).toBe('deployment');
      expect(calls).toBe(0);
    });
  });

  it('lets a failed callback be retried', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      const request = {
        deploymentId: DEPLOYMENT,
        requestId: randomUUID(),
        operation: 'grant',
        actorId: 'admin-1',
        payload: { amount: 3 },
      };
      let calls = 0;
      await expect(service.execute(request, async () => {
        calls += 1;
        throw new Error('boom');
      })).rejects.toThrow('boom');
      const result = await service.execute(request, async () => {
        calls += 1;
        return { ok: true };
      });
      expect(result).toEqual({ ok: true });
      expect(calls).toBe(2);
    });
  });

  it('resolves a concurrent duplicate to one committed callback', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      const request = {
        deploymentId: DEPLOYMENT,
        requestId: randomUUID(),
        operation: 'grant',
        actorId: 'admin-1',
        payload: { amount: 1 },
      };
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const first = service.execute(request, async () => {
        calls += 1;
        await gate;
        return { n: 1 };
      });
      const started = Date.now();
      while (calls < 1) {
        if (Date.now() - started > 2000) throw new Error('callback did not start');
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const second = service.execute(request, async () => {
        calls += 1;
        return { n: 2 };
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      release();
      const [left, right] = await Promise.all([first, second]);
      expect(left).toEqual({ n: 1 });
      expect(right).toEqual({ n: 1 });
      expect(calls).toBe(1);
    });
  });

  it('rolls the audit row back with the failed transaction and then retries', async () => {
    await withDb(async (db) => {
      const service = new IdempotencyService(db, DEPLOYMENT);
      const audit = new AdminAuditService(db, DEPLOYMENT);
      const requestId = randomUUID();
      const request = {
        deploymentId: DEPLOYMENT,
        requestId,
        operation: 'grant',
        actorId: 'admin-1',
        payload: { player: 'alice' },
      };
      const input = {
        requestId,
        adminId: 'admin-1',
        action: 'grant',
        targetType: 'player',
        targetId: 'alice',
        reason: 'because the ledger requires a reason',
        success: true,
      };
      await expect(service.execute(request, async (tx) => {
        await audit.append(input, tx);
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      expect(await audit.getByRequestId(requestId)).toBeNull();
      const result = await service.execute(request, async (tx) => {
        await audit.append(input, tx);
        return { ok: true };
      });
      expect(result).toEqual({ ok: true });
      const row = await audit.getByRequestId(requestId);
      expect(row?.reason).toBe(input.reason);
      expect(row?.deploymentId).toBe(DEPLOYMENT);
      const replay = await service.execute(request, async () => ({ ok: false }));
      expect(replay).toEqual({ ok: true });
    });
  });
}
