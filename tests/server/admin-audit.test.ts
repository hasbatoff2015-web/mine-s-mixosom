import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AdminAuditService, type AdminAuditInput } from '../../server/db/audit';
import { AdminAuditValidationError } from '../../server/db/errors';
import { MemoryDatabase } from './helpers/memoryDatabase';

function input(overrides: Record<string, unknown> = {}): AdminAuditInput {
  return {
    requestId: randomUUID(),
    adminId: 'admin-1',
    action: 'grant',
    targetType: 'player',
    targetId: 'alice',
    reason: 'correct a stuck balance',
    serverMode: 'anarchy',
    worldId: 'anarchy',
    success: true,
    metadata: { b: 1, a: 'note' },
    ...overrides,
  } as AdminAuditInput;
}

describe('admin audit validation', () => {
  it('requires a non-empty reason, action, and admin id', async () => {
    const audit = new AdminAuditService(new MemoryDatabase(), 'dev');
    await expect(audit.append(input({ reason: '' }))).rejects.toBeInstanceOf(AdminAuditValidationError);
    await expect(audit.append(input({ reason: '   \n\t' }))).rejects.toThrow(/reason/);
    await expect(audit.append(input({ action: ' ' }))).rejects.toThrow(/action/);
    await expect(audit.append(input({ adminId: '' }))).rejects.toThrow(/adminId/);
    await expect(audit.append(input({ success: 'true' }))).rejects.toThrow(/boolean/);
    await expect(audit.append(input({ metadata: ['nope'] }))).rejects.toThrow(/metadata/);
    await expect(audit.append(input({ requestId: 'not-a-uuid' }))).rejects.toThrow(/UUID/);
    expect(() => new AdminAuditService(new MemoryDatabase(), '  ')).toThrow(/deployment id/);
  });

  it('inserts once and reads the row back', async () => {
    const db = new MemoryDatabase('dev');
    const audit = new AdminAuditService(db, 'dev');
    const requestId = randomUUID();
    const row = await audit.append(input({ requestId, reason: '  because  ' }));
    expect(row.reason).toBe('because');
    expect(row.adminId).toBe('admin-1');
    expect(row.action).toBe('grant');
    expect(row.deploymentId).toBe('dev');
    expect(row.requestId).toBe(requestId);
    expect(row.success).toBe(true);
    expect(row.metadata).toEqual({ a: 'note', b: 1 });
    expect(row.eventId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await audit.append(input({ requestId, success: false, reason: 'retry failed' }));
    expect(second.eventId).not.toBe(row.eventId);
    const history = await audit.listByRequestId(requestId);
    expect(history.map((entry) => entry.success)).toEqual([true, false]);
    expect((await audit.getLatestByRequestId(requestId))?.eventId).toBe(second.eventId);
    expect(await audit.listByRequestId(randomUUID())).toEqual([]);
    expect(await audit.getLatestByRequestId(randomUUID())).toBeNull();
  });

  it('exposes append and read, not a normal mutation API', () => {
    const names = Object.getOwnPropertyNames(AdminAuditService.prototype);
    expect(names).toContain('append');
    expect(names).toContain('listByRequestId');
    expect(names).toContain('getLatestByRequestId');
    expect(names).not.toContain('getByRequestId');
    expect(names.filter((name) => /update|delete|remove/i.test(name))).toEqual([]);
  });
});
