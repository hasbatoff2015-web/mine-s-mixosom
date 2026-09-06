import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../../server/services/jsonStore';
import { PermissionService, permissionMatches } from '../../server/services/permissions';
import { clampRtpBounds, randomRtpColumn, RTP_MAX, RTP_MIN } from '../../server/services/rtp';

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
    expect(permissions.has('steve', 'server.admin')).toBe(false);
    expect(permissions.isOperator('steve')).toBe(false);
  });

  it('grants role permissions and wildcards', async () => {
    const permissions = await service();
    expect(permissionMatches('claim.*', 'claim.create')).toBe(true);
    expect(permissionMatches('claim.*', 'claim.admin')).toBe(true);
    expect(permissionMatches('server.*', 'server.plugins.manage')).toBe(true);
    expect(permissionMatches('home.use', 'home.sethome')).toBe(false);
    permissions.assignRole('alex', 'admin');
    expect(permissions.has('alex', 'claim.admin')).toBe(true);
    expect(permissions.has('alex', 'plugins.manage')).toBe(true);
  });

  it('treats OP as owner of every permission and persists deop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const first = new PermissionService(new JsonFileStore(dir), ['root']);
    first.load();
    expect(first.isOperator('root')).toBe(true);
    expect(first.has('root', 'anything.at.all')).toBe(true);
    expect(first.op('steve')).toBe(true);
    expect(first.has('steve', 'server.admin')).toBe(true);
    const removed = first.deop('steve');
    expect(removed.ok).toBe(true);
    expect(first.has('steve', 'server.admin')).toBe(false);
    expect(first.deop('root').ok).toBe(false);

    const second = new PermissionService(new JsonFileStore(dir), ['root']);
    second.load();
    expect(second.isOperator('root')).toBe(true);
    expect(second.isOperator('steve')).toBe(false);
  });

  it('keeps extra player nodes across reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-perm-'));
    dirs.push(dir);
    const first = new PermissionService(new JsonFileStore(dir));
    first.load();
    first.grant('ada', 'holograms.create');
    const second = new PermissionService(new JsonFileStore(dir));
    second.load();
    expect(second.has('ada', 'holograms.create')).toBe(true);
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
