import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IdempotencyService } from '../../server/db/idempotency';
import { PostgresGameplayEconomy } from '../../server/economy/postgresAuthority';
import type { MegacoinService } from '../../server/economy/service';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { KillStatistics } from '../../server/services/killStats';

function economy(): PostgresGameplayEconomy {
  const store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'fc-track-')));
  return new PostgresGameplayEconomy(
    {} as MegacoinService,
    {} as IdempotencyService,
    new EconomyService(store),
    new KillStatistics(store),
  );
}

function pending(work: PostgresGameplayEconomy): Set<Promise<unknown>> {
  return (work as unknown as { pending: Set<Promise<unknown>> }).pending;
}

describe('postgres economy background tracking', () => {
  it('clears a resolved promise and a rejected one without an unhandled rejection', async () => {
    const work = economy();
    const reasons: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      work.track(Promise.resolve('ok'));
      work.track(Promise.reject(new Error('postgres://secret@db.example/prod')));
      await work.idle();
      await new Promise((resolve) => setImmediate(resolve));
      expect(pending(work).size).toBe(0);
      expect(reasons).toEqual([]);
      await work.shutdown();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('drains tracked work on shutdown and still closes after a failure', async () => {
    const work = economy();
    let released = false;
    work.track(new Promise<void>((resolve) => {
      setTimeout(() => {
        released = true;
        resolve();
      }, 30);
    }));
    await work.shutdown();
    expect(released).toBe(true);
    expect(pending(work).size).toBe(0);

    const failed = economy();
    failed.track(Promise.reject(new Error('background')));
    await failed.idle();
    await failed.shutdown();
    expect(pending(failed).size).toBe(0);
  });
});
