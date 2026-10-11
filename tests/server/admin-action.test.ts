import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AdminActionService, type AdminActionRequest } from '../../server/admin/action';
import { AdminAuditService, type AdminAuditInput } from '../../server/db/audit';
import { AdminIdentityError, AdminActionValidationError } from '../../server/admin/errors';
import { AdminIdentityPolicy } from '../../server/admin/identity';
import { DisabledDatabase } from '../../server/db/database';
import { DatabaseDisabledError, IdempotencyConflictError } from '../../server/db/errors';
import { MemoryDatabase } from './helpers/memoryDatabase';

const POLICY = new AdminIdentityPolicy({
  enabled: true,
  ids: ['admin-owner', 'admin-colleague'],
});

const PROBE_INSERT = 'INSERT INTO admin_action_probe DEFAULT VALUES';
const PROBE_COUNT = 'SELECT probes FROM admin_action_probe';

function request(overrides: Partial<AdminActionRequest> = {}): AdminActionRequest {
  return {
    requestId: randomUUID(),
    adminId: 'admin-owner',
    action: 'note',
    targetType: 'player',
    targetId: 'alice',
    reason: 'correct a stuck record',
    payload: { amount: 1 },
    ...overrides,
  };
}

async function probes(db: MemoryDatabase): Promise<number> {
  const found = await db.query<{ n: number }>(PROBE_COUNT);
  return found.rows[0]?.n ?? 0;
}

describe('admin action service', () => {
  it('commits the callback and one success audit, then replays without a second call', async () => {
    const db = new MemoryDatabase('dev');
    const service = new AdminActionService(db, POLICY, 'dev');
    const body = request();
    let calls = 0;
    const first = await service.execute(body, async (tx) => {
      calls += 1;
      await tx.query(PROBE_INSERT);
      return { ok: true, n: 1 };
    });
    const again = await service.execute(body, async () => {
      calls += 1;
      return { ok: false };
    });
    expect(first).toEqual({ n: 1, ok: true });
    expect(again).toEqual(first);
    expect(calls).toBe(1);
    expect(await probes(db)).toBe(1);
    const history = await service.history(body.requestId);
    expect(history.map((row) => row.success)).toEqual([true]);
  });

  it('treats the colleague as the same kind of admin', async () => {
    const db = new MemoryDatabase('dev');
    const service = new AdminActionService(db, POLICY, 'dev');
    let calls = 0;
    await service.execute(request({ adminId: 'admin-colleague' }), async () => {
      calls += 1;
      return { ok: true };
    });
    expect(calls).toBe(1);
  });

  it('rolls a failed callback back, records a failure audit, and lets a retry succeed', async () => {
    const db = new MemoryDatabase('dev');
    const service = new AdminActionService(db, POLICY, 'dev');
    const body = request();
    let calls = 0;
    await expect(service.execute(body, async (tx) => {
      calls += 1;
      await tx.query(PROBE_INSERT);
      throw new Error('ledger rejected');
    })).rejects.toThrow(/ledger rejected/);
    expect(await probes(db)).toBe(0);
    expect((await service.history(body.requestId)).map((row) => row.success)).toEqual([false]);
    const done = await service.execute(body, async (tx) => {
      calls += 1;
      await tx.query(PROBE_INSERT);
      return { ok: true };
    });
    expect(done).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(await probes(db)).toBe(1);
    expect((await service.history(body.requestId)).map((row) => row.success)).toEqual([false, true]);
  });

  it('rolls the authoritative write back when the success audit cannot be stored', async () => {
    const db = new MemoryDatabase('dev');
    const audit = new AdminAuditService(db, 'dev');
    const original = audit.append.bind(audit);
    audit.append = async (input: AdminAuditInput, tx) => {
      if (input.success) throw new Error('audit store down');
      return original(input, tx);
    };
    const service = new AdminActionService(db, POLICY, 'dev', audit);
    const body = request();
    await expect(service.execute(body, async (tx) => {
      await tx.query(PROBE_INSERT);
      return { ok: true };
    })).rejects.toThrow(/audit store down/);
    expect(await probes(db)).toBe(0);
    expect((await service.history(body.requestId)).map((row) => row.success)).toEqual([false]);
  });

  it('rejects an unknown admin and an empty reason before the callback', async () => {
    const db = new MemoryDatabase('dev');
    const service = new AdminActionService(db, POLICY, 'dev');
    let calls = 0;
    const run = async (): Promise<void> => { calls += 1; };
    await expect(service.execute(request({ adminId: 'intruder' }), run)).rejects.toBeInstanceOf(AdminIdentityError);
    await expect(service.execute(request({ reason: '   ' }), run)).rejects.toBeInstanceOf(AdminActionValidationError);
    await expect(service.execute(request({ reason: 'other reason' }), async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    const owner = request();
    await service.execute(owner, async () => ({ ok: true }));
    await expect(service.execute({ ...owner, reason: 'different reason' }, run)).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.execute({ ...owner, action: 'other' }, run)).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.execute({ ...owner, adminId: 'admin-colleague' }, run)).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(service.execute({ ...owner, payload: { amount: 2 } }, run)).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(calls).toBe(0);
  });

  it('fails closed when PostgreSQL is disabled', async () => {
    const service = new AdminActionService(new DisabledDatabase(), POLICY, 'dev');
    let calls = 0;
    await expect(service.execute(request(), async () => {
      calls += 1;
      return { ok: true };
    })).rejects.toBeInstanceOf(DatabaseDisabledError);
    expect(calls).toBe(0);
  });

  it('fails closed when admin ids are not configured', async () => {
    const service = new AdminActionService(
      new MemoryDatabase('dev'),
      new AdminIdentityPolicy({ enabled: false }),
      'dev',
    );
    let calls = 0;
    await expect(service.execute(request(), async () => {
      calls += 1;
      return { ok: true };
    })).rejects.toThrow(/disabled/);
    expect(calls).toBe(0);
  });
});
