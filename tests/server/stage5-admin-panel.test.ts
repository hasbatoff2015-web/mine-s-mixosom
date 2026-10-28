import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAdminAsset } from '../../server/admin/assets';
import { AdminHttpServer } from '../../server/admin/http';
import type { AdminPanelApi } from '../../server/admin/panelHost';
import { digestAdminSecret, generateAdminSecret, type AdminCredential } from '../../server/admin/credentials';
import { Inventory } from '../../src/inventory';

const IDS = ['admin-owner', 'admin-colleague'] as const;

function credentials(owner: string, colleague: string): readonly [AdminCredential, AdminCredential] {
  return [
    { adminId: IDS[0], digest: digestAdminSecret(owner) },
    { adminId: IDS[1], digest: digestAdminSecret(colleague) },
  ];
}

function raw(options: {
  port: number;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const payload = options.body === undefined ? undefined : Buffer.from(options.body);
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: options.port,
      method: options.method ?? 'GET',
      path: options.path ?? '/admin/',
      headers: {
        Host: `127.0.0.1:${options.port}`,
        ...(payload ? { 'Content-Length': String(payload.length) } : {}),
        ...(options.headers ?? {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function panel(record: { adminId?: string } = {}): AdminPanelApi {
  return {
    overview: () => ({ serverMode: 'anarchy', worldId: 'anarchy', online: 1, maxPlayers: 8 }),
    players: () => ({ players: [{ playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '<b>Ada</b>', online: true, gamemode: 'survival' }] }),
    incidents: () => ({ incidents: [], scanned: false }),
    resources: () => ({ knownGaps: ['drop-despawn'], scanned: false, resources: [], anomalies: [] }),
    serverStatus: () => ({ measuredTickMs: null, configuredTickRate: 20, online: 1, postgres: false, release: null }),
    economy: async () => ({ balance: 10, backend: 'postgres', entries: [] }),
    audit: async () => ({ entries: [] }),
    recheck: async (adminId) => {
      record.adminId = adminId;
      return { scanned: true };
    },
    kick: async (adminId) => {
      record.adminId = adminId;
      return { ok: true };
    },
    ban: async (adminId) => {
      record.adminId = adminId;
      return { ok: true };
    },
    unban: async () => ({ ok: true }),
    adjust: async (adminId) => {
      record.adminId = adminId;
      return { ok: true, balance: 20, replayed: false };
    },
  };
}

describe('stage 5 admin panel http', () => {
  const servers: AdminHttpServer[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  });

  it('serves only allowlisted admin files and rejects traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fc-admin-ui-'));
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Панель</title>');
    await writeFile(join(root, 'assets/app.js'), 'console.log(1)');
    await writeFile(join(root, 'secret.txt'), 'nope');
    expect(readAdminAsset(root, '/admin/')?.body.toString()).toContain('Панель');
    expect(readAdminAsset(root, '/admin/assets/app.js')?.type).toContain('javascript');
    expect(readAdminAsset(root, '/admin/assets/../secret.txt')).toBeNull();
    expect(readAdminAsset(root, '/admin/assets/app.js.map')).toBeNull();
    expect(readAdminAsset(root, '/etc/passwd')).toBeNull();

    const server = new AdminHttpServer({
      port: 0,
      credentials: credentials(generateAdminSecret(), generateAdminSecret()),
      assetsRoot: root,
      inspect: () => null,
      describe: () => ({ serverMode: 'anarchy', worldId: 'anarchy' }),
    });
    servers.push(server);
    await server.start();
    const page = await raw({ port: server.port, path: '/admin/' });
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.body).toContain('Панель');
    const escaped = await raw({ port: server.port, path: '/admin/assets/..%2fsecret.txt' });
    expect(escaped.status).toBe(404);
  });

  it('refuses to listen when the admin bundle index is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fc-admin-empty-'));
    const server = new AdminHttpServer({
      port: 0,
      credentials: credentials(generateAdminSecret(), generateAdminSecret()),
      assetsRoot: root,
      inspect: () => null,
      describe: () => ({ serverMode: 'anarchy', worldId: 'anarchy' }),
    });
    await expect(server.start()).rejects.toThrow(/admin ui bundle is missing/);
  });

  it('requires a session, csrf and the server admin id for a kick', async () => {
    const owner = generateAdminSecret();
    const seen: { adminId?: string } = {};
    const server = new AdminHttpServer({
      port: 0,
      credentials: credentials(owner, generateAdminSecret()),
      panel: panel(seen),
      inspect: () => ({
        playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Ada',
        online: true,
        gamemode: 'survival',
        worldId: 'anarchy',
        balance: 1,
        inventory: new Inventory().serialize(),
        inventoryRevision: 1,
      }),
      describe: () => ({ serverMode: 'anarchy', worldId: 'anarchy' }),
    });
    servers.push(server);
    await server.start();
    const origin = `http://127.0.0.1:${server.port}`;
    const denied = await raw({ port: server.port, path: '/admin/api/overview' });
    expect(denied.status).toBe(401);
    const login = await raw({
      port: server.port,
      method: 'POST',
      path: '/admin/api/login',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: owner, adminId: 'admin-colleague' }),
    });
    expect(login.status).toBe(200);
    const me = JSON.parse(login.body) as { adminId: string; csrfToken: string };
    expect(me.adminId).toBe('admin-owner');
    const cookie = String(login.headers['set-cookie']?.[0] ?? login.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const session = cookie.slice(0, cookie.indexOf(';'));
    const noCsrf = await raw({
      port: server.port,
      method: 'POST',
      path: '/admin/api/player/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/kick',
      headers: { Origin: origin, Cookie: session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'спам', requestId: '11111111-1111-4111-8111-111111111111', adminId: 'admin-colleague' }),
    });
    expect(noCsrf.status).toBe(403);
    const badOrigin = await raw({
      port: server.port,
      method: 'POST',
      path: '/admin/api/player/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/kick',
      headers: {
        Origin: 'http://evil.example',
        Cookie: session,
        'X-CSRF-Token': me.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'спам', requestId: '11111111-1111-4111-8111-111111111111' }),
    });
    expect(badOrigin.status).toBe(403);
    const kicked = await raw({
      port: server.port,
      method: 'POST',
      path: '/admin/api/player/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/kick',
      headers: {
        Origin: origin,
        Cookie: session,
        'X-CSRF-Token': me.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'спам',
        requestId: '11111111-1111-4111-8111-111111111111',
        adminId: 'admin-colleague',
      }),
    });
    expect(kicked.status).toBe(200);
    expect(seen.adminId).toBe('admin-owner');
    const players = await raw({
      port: server.port,
      path: '/admin/api/players?limit=20',
      headers: { Cookie: session },
    });
    expect(players.body).toContain('<b>Ada</b>');
    expect(players.headers['content-type']).toContain('application/json');
  });
});
