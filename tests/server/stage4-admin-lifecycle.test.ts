import { createServer } from 'node:http';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import { AnarchyServer } from '../../server/AnarchyServer';
import {
  digestAdminSecret,
  generateAdminSecret,
  type AdminCredential,
} from '../../server/admin/credentials';
import { loadServerConfig } from '../../server/config';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

const IDS = ['admin-owner', 'admin-colleague'] as const;

function pair(ownerSecret: string, colleagueSecret: string): readonly [AdminCredential, AdminCredential] {
  return [
    { adminId: IDS[0], digest: digestAdminSecret(ownerSecret) },
    { adminId: IDS[1], digest: digestAdminSecret(colleagueSecret) },
  ];
}

function baseConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'stage4',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '4',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
      FC_NO_BUILTIN_PLUGINS: '1',
      FC_DATABASE_URL: '',
      FC_ADMIN_IDS: 'admin-owner,admin-colleague',
    }),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    loadBuiltinPlugins: false,
    pluginDir: join(dataDir, 'plugins'),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function listen(port: number, host: string): Promise<ReturnType<typeof createServer>> {
  const blocker = createServer((_req, res) => {
    res.writeHead(200);
    res.end('blocker');
  });
  return new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(port, host, () => resolve(blocker));
  });
}

describe('stage 4 admin lifecycle', () => {
  const dirs: string[] = [];
  const servers: AnarchyServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('keeps the public game listener free of admin routes when admin HTTP is off', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-stage4-off-'));
    dirs.push(dataDir);
    const server = new AnarchyServer(baseConfig(dataDir));
    servers.push(server);
    await server.start();
    expect(server.adminPort).toBe(0);
    expect(server.config.database.enabled).toBe(false);
    const status = await fetch(`http://127.0.0.1:${server.port}/status`);
    const body = await status.json() as Record<string, unknown>;
    expect(status.status).toBe(200);
    expect(body).toMatchObject({ ready: true, world: 'stage4', mode: 'anarchy' });
    expect(JSON.stringify(body)).not.toContain('admin');
    const hidden = await fetch(`http://127.0.0.1:${server.port}/admin/api/me`);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain('admin-owner');
    await server.stop();
    expect(server.adminPort).toBe(0);
  });

  it('serves private inspection for both admins without changing gameplay state', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-stage4-on-'));
    dirs.push(dataDir);
    const ownerSecret = generateAdminSecret();
    const colleagueSecret = generateAdminSecret();
    const ownerId = 'AdminOwner';
    const colleagueId = 'AdminMate';
    const server = new AnarchyServer({
      ...baseConfig(dataDir),
      adminIdentity: { enabled: true, ids: [ownerId, colleagueId] },
      adminHttp: {
        enabled: true,
        port: 0,
        credentials: [
          { adminId: ownerId, digest: digestAdminSecret(ownerSecret) },
          { adminId: colleagueId, digest: digestAdminSecret(colleagueSecret) },
        ],
      },
    });
    servers.push(server);
    await server.start();
    expect(server.adminPort).toBeGreaterThan(0);
    expect(server.adminPort).not.toBe(server.port);

    const socket = new WebSocket(server.wsUrl());
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
      const welcome = await new Promise<{ playerId: string; sessionToken: string; name: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('welcome timeout')), 5000);
        socket.on('message', (data) => {
          const message = JSON.parse(String(data)) as { type?: string; playerId?: string; sessionToken?: string; name?: string };
          if (message.type !== 'welcome' || !message.playerId || !message.sessionToken) return;
          clearTimeout(timer);
          resolve({ playerId: message.playerId, sessionToken: message.sessionToken, name: message.name ?? '' });
        });
        socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, name: ownerId }));
      });
      expect(welcome.name).toBe(ownerId);
      const player = server.world.players.get(welcome.playerId);
      if (!player) throw new Error('player missing');
      const beforeInventory = JSON.stringify(player.inventory.serialize());
      const beforeBalance = server.world.economy.getBalance(welcome.playerId);
      const beforeListings = server.world.auction.holdingListings().length;
      const beforeBuyers = server.world.buyer.list().length;

      const gameToken = await adminRequest(server.adminPort, 'GET', '/admin/api/me', {
        Cookie: `fc_admin_session=${welcome.sessionToken}`,
      });
      expect(gameToken.status).toBe(401);
      const nickname = await adminRequest(server.adminPort, 'POST', '/admin/api/login', {
        'Content-Type': 'application/json',
      }, JSON.stringify({ secret: ownerId, adminId: colleagueId }));
      expect(nickname.status).toBe(401);

      const status = await fetch(`http://127.0.0.1:${server.port}/status`);
      const statusText = await status.text();
      expect(status.status).toBe(200);
      expect(statusText).not.toContain(ownerSecret);
      expect(statusText).not.toContain(welcome.sessionToken);
      const publicAdmin = await fetch(`http://127.0.0.1:${server.port}/admin/api/me`);
      expect(publicAdmin.status).toBe(404);

      const owner = await adminRequest(server.adminPort, 'POST', '/admin/api/login', {
        'Content-Type': 'application/json',
      }, JSON.stringify({ secret: ownerSecret, adminId: colleagueId }));
      const colleague = await adminRequest(server.adminPort, 'POST', '/admin/api/login', {
        'Content-Type': 'application/json',
      }, JSON.stringify({ secret: colleagueSecret }));
      expect(owner.status).toBe(200);
      expect(colleague.status).toBe(200);
      expect(JSON.parse(owner.body).adminId).toBe(ownerId);
      expect(JSON.parse(colleague.body).adminId).toBe(colleagueId);
      const ownerCookie = cookieOf(owner.setCookie);
      const colleagueCookie = cookieOf(colleague.setCookie);
      const ownerView = await adminRequest(server.adminPort, 'GET', `/admin/api/player/${welcome.playerId}`, {
        Cookie: `fc_admin_session=${ownerCookie}`,
      });
      const colleagueView = await adminRequest(server.adminPort, 'GET', `/admin/api/player/${welcome.playerId}`, {
        Cookie: `fc_admin_session=${colleagueCookie}`,
      });
      expect(ownerView.status).toBe(200);
      expect(colleagueView.body).toBe(ownerView.body);
      expect(ownerView.body).not.toContain(welcome.sessionToken);
      expect(ownerView.body).not.toContain('sessionToken');
      expect(ownerView.body).not.toContain(ownerSecret);
      expect(JSON.parse(ownerView.body).name).toBe(ownerId);

      expect(JSON.stringify(player.inventory.serialize())).toBe(beforeInventory);
      expect(server.world.economy.getBalance(welcome.playerId)).toBe(beforeBalance);
      expect(server.world.auction.holdingListings().length).toBe(beforeListings);
      expect(server.world.buyer.list().length).toBe(beforeBuyers);
      expect(player.connected).toBe(true);
    } finally {
      socket.close();
    }

    const adminPort = server.adminPort;
    await server.stop();
    expect(server.adminPort).toBe(0);
    await expect(adminRequest(adminPort, 'GET', '/admin/api/me')).rejects.toThrow();
  });

  it('fails a taken admin port before writing a world snapshot', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-stage4-busy-'));
    dirs.push(dataDir);
    const blocker = await listen(0, '127.0.0.1');
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('blocker has no port');
    const server = new AnarchyServer({
      ...baseConfig(dataDir),
      adminHttp: {
        enabled: true,
        port: address.port,
        credentials: pair(generateAdminSecret(), generateAdminSecret()),
      },
    });
    servers.push(server);
    await expect(server.start()).rejects.toThrow(/EADDRINUSE|address already in use/i);
    expect(server.adminPort).toBe(0);
    expect(await exists(join(dataDir, 'stage4', 'meta.json'))).toBe(false);
    expect(await exists(join(dataDir, 'stage4', 'world.json'))).toBe(false);
    expect(await exists(join(dataDir, 'stage4', 'players.json'))).toBe(false);
    const stillBlocked = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(await stillBlocked.text()).toBe('blocker');
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await server.stop();
  });
});

interface AdminResult {
  status: number;
  body: string;
  setCookie: string;
}

function adminRequest(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<AdminResult> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: { Host: `127.0.0.1:${port}`, ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = res.headers['set-cookie'];
        const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          setCookie,
        });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function cookieOf(setCookie: string): string {
  const match = setCookie.match(/fc_admin_session=([^;]+)/);
  if (!match?.[1]) throw new Error(`missing session cookie: ${setCookie}`);
  return match[1];
}
