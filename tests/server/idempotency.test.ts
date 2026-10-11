import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IdempotencyPendingError, IdempotencyValidationError } from '../../server/db/errors';
import { hashPayload } from '../../server/db/canonicalJson';
import { IdempotencyService } from '../../server/db/idempotency';
import { MemoryDatabase } from './helpers/memoryDatabase';
import { registerIdempotencyCases } from './helpers/idempotencyCases';

describe('idempotency', () => {
  registerIdempotencyCases(() => new MemoryDatabase('dev'));

  it('does not run the callback when a committed in-progress row is already visible', async () => {
    const db = new MemoryDatabase('dev');
    const requestId = randomUUID();
    db.seedIdempotency({
      deployment_id: 'dev',
      request_id: requestId,
      operation: 'grant',
      actor_id: 'admin-1',
      payload_hash: hashPayload({ amount: 1 }),
      state: 'in_progress',
      response: null,
      committed_at: null,
    });
    const service = new IdempotencyService(db, 'dev');
    let calls = 0;
    await expect(service.execute({
      deploymentId: 'dev',
      requestId,
      operation: 'grant',
      actorId: 'admin-1',
      payload: { amount: 1 },
    }, async () => {
      calls += 1;
      return { ok: true };
    })).rejects.toBeInstanceOf(IdempotencyPendingError);
    expect(calls).toBe(0);
  });

  it('rejects an empty operation before a transaction', async () => {
    const service = new IdempotencyService(new MemoryDatabase('dev'), 'dev');
    await expect(service.execute({
      deploymentId: 'dev',
      requestId: randomUUID(),
      operation: ' ',
      actorId: 'admin-1',
      payload: {},
    }, async () => ({ ok: true }))).rejects.toBeInstanceOf(IdempotencyValidationError);
  });
});
