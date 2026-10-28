import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService, permissionMatches } from '../../server/services/permissions';
import { clampRtpBounds, randomRtpColumn, RTP_MAX, RTP_MIN } from '../../server/services/rtp';

const ROOT = '11111111-1111-4111-8111-111111111111';
const STEVE = '22222222-2222-4222-8222-222222222222';
const ALEX = '33333333-3333-4333-8333-333333333333';
const ADA = '44444444-4444-4444-8444-444444444444';

describe('PermissionService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function service(operators: string[] = []): Promise<PermissionService> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const permissions = new PermissionService(new JsonFileStore(dir), operators);
    permissions.load();
    return permissions;
  }

  it('denies unknown nodes for a default player', async () => {
    const permissions = await service();
    expect(permissions.has('steve', 'home.use')).toBe(true);
    expect(permissions.has('steve', 'buyer.use')).toBe(true);
    expect(permissions.has('steve', 'friends.use')).toBe(true);
    expect(permissions.has('steve', 'trade.use')).toBe(true);
    expect(permissions.has('steve', 'buyer.create')).toBe(false);
    expect(permissions.has('steve', 'server.admin')).toBe(false);
    expect(permissions.isOperator('steve')).toBe(false);
  });

  it('grants role permissions and wildcards', async () => {
    const permissions = await service();
    expect(permissionMatches('claim.*', 'claim.create')).toBe(true);
    expect(permissionMatches('claim.*', 'claim.admin')).toBe(true);
    expect(permissionMatches('server.*', 'server.plugins.manage')).toBe(true);
    expect(permissionMatches('home.use', 'home.sethome')).toBe(false);
    permissions.assignRole(ALEX, 'admin');
    expect(permissions.has(ALEX, 'claim.admin')).toBe(true);
    expect(permissions.has(ALEX, 'buyer.create')).toBe(true);
    expect(permissions.has(ALEX, 'buyer.edit')).toBe(true);
    expect(permissions.has(ALEX, 'plugins.manage')).toBe(true);
    expect(permissions.assignRole('alex', 'admin').ok).toBe(false);
    expect(permissions.has('alex', 'claim.admin')).toBe(false);
  });

  it('treats OP as owner of every permission and persists deop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const first = new PermissionService(new JsonFileStore(dir), [ROOT]);
    first.load();
    expect(first.isOperator(ROOT)).toBe(true);
    expect(first.isOperator('root')).toBe(false);
    expect(first.has(ROOT, 'anything.at.all')).toBe(true);
    expect(first.op('steve')).toBe(false);
    expect(first.isOperator('steve')).toBe(false);
    expect(first.op(STEVE)).toBe(true);
    expect(first.has(STEVE, 'server.admin')).toBe(true);
    const removed = first.deop(STEVE);
    expect(removed.ok).toBe(true);
    expect(first.has(STEVE, 'server.admin')).toBe(false);
    expect(first.deop(ROOT).ok).toBe(false);
    expect(first.ignoredOperators()).toEqual([]);

    const second = new PermissionService(new JsonFileStore(dir), [ROOT]);
    second.load();
    expect(second.isOperator(ROOT)).toBe(true);
    expect(second.isOperator(STEVE)).toBe(false);
    expect(second.isOperator('root')).toBe(false);
  });

  it('keeps extra player nodes across reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const first = new PermissionService(new JsonFileStore(dir));
    first.load();
    first.grant(ADA, 'holograms.create');
    expect(first.grant('ada', 'holograms.create')).toBe(false);
    const second = new PermissionService(new JsonFileStore(dir));
    second.load();
    expect(second.has(ADA, 'holograms.create')).toBe(true);
    expect(second.has('ada', 'holograms.create')).toBe(false);
  });

  it('keeps a nickname grant inert across reload until it is migrated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    store.save('permissions', {
      ops: ['AdminOwner'],
      playerRoles: { AdminOwner: ['admin'] },
      playerPermissions: { AdminOwner: ['plugins.manage'] },
    });
    const first = new PermissionService(store, ['AdminOwner']);
    first.load();
    expect(first.isOperator('AdminOwner')).toBe(false);
    expect(first.has('AdminOwner', 'server.admin')).toBe(false);
    expect(first.has('adminowner', 'plugins.manage')).toBe(false);
    expect(first.ignoredOperators()).toEqual(['AdminOwner']);
    expect(first.legacyInfo('AdminOwner')).toMatchObject({
      operator: true,
      roles: ['admin'],
      permissions: ['plugins.manage'],
    });
    expect(first.migrateLegacy('AdminOwner', 'not-an-id').ok).toBe(false);
    expect(first.migrateLegacy('missing', ADA).ok).toBe(false);
    expect(first.migrateLegacy('AdminOwner', ADA).ok).toBe(true);
    expect(first.isOperator(ADA)).toBe(true);
    expect(first.has(ADA, 'economy.admin')).toBe(true);
    expect(first.has(ADA, 'plugins.manage')).toBe(true);
    expect(first.legacyInfo('AdminOwner')).toBeNull();
    expect(first.isOperator('AdminOwner')).toBe(false);

    const second = new PermissionService(new JsonFileStore(dir), ['AdminOwner']);
    second.load();
    expect(second.isOperator(ADA)).toBe(true);
    expect(second.isOperator('AdminOwner')).toBe(false);
    expect(second.has('AdminOwner', 'server.admin')).toBe(false);
    expect(second.legacyInfo('AdminOwner')).toBeNull();
  });

  it('does not persist environment operators and keeps manual grants', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const envOnly = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const manual = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    const both = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
    const first = new PermissionService(store, [envOnly, 'AdminOwner', both]);
    first.load();
    expect(first.isOperator(envOnly)).toBe(true);
    expect(first.isOperator('AdminOwner')).toBe(false);
    expect(first.snapshot().ops).not.toContain(envOnly);
    expect(first.op(manual)).toBe(true);
    expect(first.op(both)).toBe(true);
    expect(first.deop(envOnly).ok).toBe(false);
    expect(first.isOperator(envOnly)).toBe(true);

    const saved = new PermissionService(new JsonFileStore(dir), []);
    saved.load();
    expect(saved.isOperator(envOnly)).toBe(false);
    expect(saved.isOperator(manual)).toBe(true);
    expect(saved.isOperator(both)).toBe(true);

    store.save('permissions', { version: 2, ops: [envOnly], roles: {}, playerRoles: {}, playerPermissions: {} });
    const ambiguous = new PermissionService(new JsonFileStore(dir), []);
    ambiguous.load();
    expect(ambiguous.isOperator(envOnly)).toBe(false);
    expect(ambiguous.snapshot().ops).not.toContain(envOnly);
    expect(ambiguous.snapshot().unreviewedOps).toContain(envOnly);
    expect(ambiguous.op(envOnly)).toBe(true);
    expect(ambiguous.isOperator(envOnly)).toBe(true);
  });
});

describe('RTP bounds', () => {
  it('clamps the search region to ±10000', () => {
    const bounds = clampRtpBounds({ minX: -50_000, maxX: 80_000, minZ: -3, maxZ: 3 });
    expect(bounds.minX).toBe(RTP_MIN);
    expect(bounds.maxX).toBe(RTP_MAX);
    const column = randomRtpColumn(-4, -4, 9, 9, () => 0);
    expect(column).toEqual({ x: -4, z: 9 });
  });
});
