import { request, type IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminHttpServer } from '../../server/admin/http';
import { AdminIdentityPolicy } from '../../server/admin/identity';
import type { AdminPlayerSnapshot } from '../../server/admin/inspection';
import {
  digestAdminSecret,
  generateAdminSecret,
  type AdminCredential,
} from '../../server/admin/credentials';
import { Inventory } from '../../src/inventory';

const IDS = ['admin-owner', 'admin-colleague'] as const;

function credentials(ownerSecret: string, colleagueSecret: string): readonly [AdminCredential, AdminCredential] {
  return [
    { adminId: IDS[0], digest: digestAdminSecret(ownerSecret) },
    { adminId: IDS[1], digest: digestAdminSecret(colleagueSecret) },
  ];
}

function snapshot(playerId: string): AdminPlayerSnapshot {
  return {
    playerId,
    name: 'Ada',
    online: true,
    gamemode: 'survival',
    worldId: 'anarchy',
    position: { x: 1, y: 2, z: 3 },
    health: 20,
    balance: 10,
    inventory: new Inventory().serialize(),
    inventoryRevision: 3,
  };
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function rawHttp(options: {
  port: number;
  method?: string;
  path?: string;
  host?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<RawResponse> {
  const payload = options.body === undefined ? undefined : Buffer.from(options.body);
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (payload && headers['Content-Length'] === undefined && headers['content-length'] === undefined) {
    headers['Content-Length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: options.port,
      method: options.method ?? 'GET',
      path: options.path ?? '/admin/api/me',
      headers: {
        Host: options.host ?? `127.0.0.1:${options.port}`,
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function setCookies(headers: IncomingHttpHeaders): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function sessionPair(response: RawResponse): { cookie: string; header: string } {
  const header = setCookies(response.headers)[0] ?? '';
  const match = header.match(/fc_admin_session=([^;]+)/);
  if (!match?.[1]) throw new Error(`missing session cookie: ${header}`);
  return { cookie: match[1], header };
}

function jsonBody(response: RawResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe('stage 4 admin http', () => {
  const servers: AdminHttpServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  });

  async function start(extra?: Partial<ConstructorParameters<typeof AdminHttpServer>[0]>): Promise<{
    server: AdminHttpServer;
    ownerSecret: string;
    colleagueSecret: string;
  }> {
    const ownerSecret = generateAdminSecret();
    const colleagueSecret = generateAdminSecret();
    const policy = new AdminIdentityPolicy({ enabled: true, ids: IDS });
    const players = new Map<string, AdminPlayerSnapshot>([['ada-1', snapshot('ada-1')]]);
    const server = new AdminHttpServer({
      port: 0,
      credentials: credentials(ownerSecret, colleagueSecret),
      inspect: (adminId, playerId) => {
        policy.requireAdmin(adminId);
        return players.get(playerId) ?? null;
      },
      describe: () => ({ serverMode: 'anarchy', worldId: 'anarchy' }),
      ...extra,
    });
    servers.push(server);
    await server.start();
    return { server, ownerSecret, colleagueSecret };
  }

  async function login(port: number, secret: string, fields: Record<string, unknown> = {}): Promise<RawResponse> {
    return rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, ...fields }),
    });
  }

  it('binds loopback, separates the two admins, and keeps responses free of secrets', async () => {
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    }));
    try {
      const { server, ownerSecret, colleagueSecret } = await start();
      const address = server.boundAddress();
      expect(address).toEqual({ address: '127.0.0.1', port: server.port });
      expect(server.port).toBeGreaterThan(0);

      const owner = await login(server.port, ownerSecret, { adminId: 'admin-colleague' });
      const colleague = await login(server.port, colleagueSecret, { adminId: 'admin-owner' });
      expect(owner.status).toBe(200);
      expect(colleague.status).toBe(200);
      const ownerBody = jsonBody(owner);
      const colleagueBody = jsonBody(colleague);
      expect(ownerBody.adminId).toBe('admin-owner');
      expect(colleagueBody.adminId).toBe('admin-colleague');
      expect(ownerBody).not.toHaveProperty('role');
      expect(colleagueBody).not.toHaveProperty('role');
      expect(ownerBody.serverMode).toBe('anarchy');
      expect(typeof ownerBody.csrfToken).toBe('string');
      expect(ownerBody.csrfToken).not.toBe(colleagueBody.csrfToken);

      const ownerCookie = sessionPair(owner);
      const colleagueCookie = sessionPair(colleague);
      expect(ownerCookie.cookie).not.toBe(colleagueCookie.cookie);
      expect(ownerCookie.cookie).toHaveLength(43);
      expect(ownerCookie.cookie).not.toBe(ownerSecret);
      expect(ownerCookie.header).toContain('HttpOnly');
      expect(ownerCookie.header).toContain('SameSite=Strict');
      expect(ownerCookie.header).toContain('Path=/admin');
      expect(ownerCookie.header).not.toContain('Secure');
      for (const header of Object.keys(owner.headers)) {
        expect(header.toLowerCase()).not.toBe('access-control-allow-origin');
      }

      const ownerView = await rawHttp({
        port: server.port,
        path: '/admin/api/player/ada-1?adminId=admin-colleague',
        headers: { Cookie: `fc_admin_session=${ownerCookie.cookie}`, 'X-Admin-Id': 'admin-colleague' },
      });
      const colleagueView = await rawHttp({
        port: server.port,
        path: '/admin/api/player/ada-1',
        headers: { Cookie: `fc_admin_session=${colleagueCookie.cookie}` },
      });
      expect(ownerView.status).toBe(200);
      expect(colleagueView.body).toBe(ownerView.body);
      expect(ownerView.body).not.toContain('sessionToken');
      expect(ownerView.body).not.toContain('postgres');
      expect(ownerView.body).not.toContain(ownerSecret);
      expect(jsonBody(ownerView).playerId).toBe('ada-1');

      const me = await rawHttp({
        port: server.port,
        headers: { Cookie: `fc_admin_session=${ownerCookie.cookie}` },
      });
      expect(jsonBody(me).adminId).toBe('admin-owner');

      const text = `${owner.body}\n${colleague.body}\n${ownerView.body}\n${logs.join('\n')}`;
      expect(text).not.toContain(ownerSecret);
      expect(text).not.toContain(colleagueSecret);
      expect(text).not.toContain(digestAdminSecret(ownerSecret).toString('hex'));
      expect(logs.join('\n')).toContain('admin login-ok id=admin-owner');
      expect(logs.join('\n')).toContain('admin login-ok id=admin-colleague');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('rejects missing auth, forged cookies, game tokens, nicknames, bad input, and cross-origin reads', async () => {
    const { server, ownerSecret } = await start();
    const port = server.port;
    const unknown = 'c'.repeat(43);
    expect((await rawHttp({ port, path: '/admin/api/player/ada-1' })).status).toBe(401);
    expect((await rawHttp({ port, path: '/admin/api/me' })).status).toBe(401);
    expect((await login(port, unknown, { adminId: 'admin-owner' })).status).toBe(401);
    expect((await login(port, 'admin-owner', { adminId: 'admin-owner' })).status).toBe(401);
    expect((await login(port, '11111111-1111-4111-8111-111111111111')).status).toBe(401);
    expect((await rawHttp({
      port,
      headers: { Cookie: 'fc_admin_session=11111111-1111-4111-8111-111111111111' },
    })).status).toBe(401);

    const logged = await login(port, ownerSecret);
    const cookie = sessionPair(logged).cookie;
    const cross = await rawHttp({
      port,
      path: '/admin/api/player/ada-1',
      headers: {
        Cookie: `fc_admin_session=${cookie}`,
        Origin: 'https://evil.example',
      },
    });
    expect(cross.status).toBe(403);
    expect(cross.body).not.toContain('Ada');
    expect(cross.headers['access-control-allow-origin']).toBeUndefined();

    const badHost = await rawHttp({
      port,
      host: 'evil.example',
      headers: {
        Cookie: `fc_admin_session=${cookie}`,
        'X-Forwarded-Host': `127.0.0.1:${port}`,
      },
    });
    expect(badHost.status).toBe(403);
    const forwarded = await rawHttp({
      port,
      headers: {
        Cookie: `fc_admin_session=${cookie}`,
        'X-Forwarded-Host': 'evil.example',
      },
    });
    expect(forwarded.status).toBe(200);

    expect((await rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })).status).toBe(400);
    expect((await rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'f'.repeat(5000) }),
    })).status).toBe(413);
    expect((await rawHttp({ port, method: 'DELETE', path: '/admin/api/me' })).status).toBe(405);
    expect((await rawHttp({ port, method: 'GET', path: '/admin/api/login' })).status).toBe(405);
    expect((await rawHttp({ port, method: 'POST', path: '/admin/api/player/ada-1' })).status).toBe(405);
    expect((await rawHttp({
      port,
      path: '/admin/api/player/..%2Fsecret',
      headers: { Cookie: `fc_admin_session=${cookie}` },
    })).status).toBe(400);
    expect((await rawHttp({
      port,
      path: '/admin/api/player/missing-player',
      headers: { Cookie: `fc_admin_session=${cookie}` },
    })).status).toBe(404);
  });

  it('rate-limits login failures without retaining an unbounded counter', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    });
    try {
      const { server } = await start();
      const secret = 'e'.repeat(43);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await login(server.port, secret, { adminId: 'admin-owner' });
        statuses.push(response.status);
        expect(response.body).not.toContain(secret);
      }
      expect(statuses.slice(0, 8).every((status) => status === 401)).toBe(true);
      expect(statuses.slice(8).every((status) => status === 429)).toBe(true);
      expect(server.retainedLoginFailures).toBeLessThanOrEqual(8);
      expect(logs.filter((line) => line.includes('admin login-rejected')).length).toBe(1);
      expect(logs.join('\n')).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it('expires sessions, requires CSRF and origin on logout, and drops them on restart', async () => {
    const clock = { now: 1_000_000 };
    const { server, ownerSecret, colleagueSecret } = await start({
      now: () => clock.now,
      idleMs: 1_000,
      absoluteMs: 10_000,
      maxSessions: 2,
    });
    const port = server.port;
    const first = await login(port, ownerSecret);
    const firstCookie = sessionPair(first).cookie;
    const csrf = String(jsonBody(first).csrfToken);
    clock.now += 1_000;
    const expired = await rawHttp({
      port,
      path: '/admin/api/player/ada-1',
      headers: { Cookie: `fc_admin_session=${firstCookie}` },
    });
    expect(expired.status).toBe(401);

    clock.now += 1;
    const again = await login(port, ownerSecret);
    const cookie = sessionPair(again).cookie;
    const token = String(jsonBody(again).csrfToken);
    const origin = `http://127.0.0.1:${port}`;
    const missingCsrf = await rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/logout',
      headers: { Cookie: `fc_admin_session=${cookie}`, Origin: origin },
    });
    expect(missingCsrf.status).toBe(403);
    const badOrigin = await rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/logout',
      headers: {
        Cookie: `fc_admin_session=${cookie}`,
        Origin: 'https://evil.example',
        'X-CSRF-Token': token,
      },
    });
    expect(badOrigin.status).toBe(403);
    expect((await rawHttp({
      port,
      headers: { Cookie: `fc_admin_session=${cookie}` },
    })).status).toBe(200);

    const loggedOut = await rawHttp({
      port,
      method: 'POST',
      path: '/admin/api/logout',
      headers: {
        Cookie: `fc_admin_session=${cookie}`,
        Origin: origin,
        'X-CSRF-Token': token,
      },
    });
    expect(loggedOut.status).toBe(200);
    expect(setCookies(loggedOut.headers)[0]).toContain('Max-Age=0');
    expect((await rawHttp({
      port,
      headers: { Cookie: `fc_admin_session=${cookie}` },
    })).status).toBe(401);

    const kept: string[] = [];
    for (const secret of [ownerSecret, colleagueSecret, ownerSecret, colleagueSecret]) {
      const response = await login(port, secret);
      expect(response.status).toBe(200);
      kept.push(sessionPair(response).cookie);
    }
    expect(server.sessionCount).toBeLessThanOrEqual(2);
    expect((await rawHttp({
      port,
      headers: { Cookie: `fc_admin_session=${kept[0]}` },
    })).status).toBe(401);
    const latest = await rawHttp({
      port,
      path: '/admin/api/me?adminId=admin-owner',
      headers: { Cookie: `fc_admin_session=${kept[3]}` },
    });
    expect(jsonBody(latest).adminId).toBe('admin-colleague');

    const absolute = await login(port, ownerSecret);
    const absoluteCookie = sessionPair(absolute).cookie;
    clock.now = Number(jsonBody(absolute).expiresAt);
    expect((await rawHttp({
      port,
      headers: { Cookie: `fc_admin_session=${absoluteCookie}` },
    })).status).toBe(401);

    const live = await login(port, ownerSecret);
    const liveCookie = sessionPair(live).cookie;
    await server.stop();
    await server.start();
    expect((await rawHttp({
      port: server.port,
      headers: { Cookie: `fc_admin_session=${liveCookie}` },
    })).status).toBe(401);
    expect(csrf).not.toBe(token);
  });

  it('serves two private listeners for two server modes', async () => {
    const ownerSecret = generateAdminSecret();
    const colleagueSecret = generateAdminSecret();
    const shared = credentials(ownerSecret, colleagueSecret);
    const anarchy = new AdminHttpServer({
      port: 0,
      credentials: shared,
      inspect: () => null,
      describe: () => ({ serverMode: 'anarchy', worldId: 'anarchy' }),
    });
    const survival = new AdminHttpServer({
      port: 0,
      credentials: shared,
      inspect: () => null,
      describe: () => ({ serverMode: 'survival', worldId: 'survival' }),
    });
    servers.push(anarchy, survival);
    await anarchy.start();
    await survival.start();
    expect(anarchy.boundAddress()?.address).toBe('127.0.0.1');
    expect(survival.boundAddress()?.address).toBe('127.0.0.1');
    expect(anarchy.port).not.toBe(survival.port);
    const logged = await login(survival.port, colleagueSecret);
    expect(jsonBody(logged).serverMode).toBe('survival');
    expect(jsonBody(logged).adminId).toBe('admin-colleague');
  });
});
