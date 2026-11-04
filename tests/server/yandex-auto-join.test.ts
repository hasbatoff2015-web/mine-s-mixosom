import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { ServerMessage } from '../../shared/protocol';
import { createItemStack } from '../../src/inventory';
import { planAfterCharacterChoice } from '../../src/net/yandexConnectIntent';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig, type ServerMode } from '../../server/config';
import type { Database, Queryable } from '../../server/db/types';
import { SYNTHETIC_YANDEX_SECRET, signedPlayerProfile } from './yandexProfileFixture';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class MemoryIdentityDb implements Database {
  readonly enabled = true;
  readonly appliedMigrations: readonly string[] = [];
  readonly links: { scope: string; providerUserId: string; playerId: string }[] = [];
  readonly receipts = new Map<string, { state: 'reserved' | 'consumed'; attemptId: string; playerId: string }>();
  readonly legacyHashes = new Set<string>();
  down = false;
  throwAfterLinkInsert = false;
  holdLookups = false;
  lookupWaits = 0;
  private lookupGate: Promise<void> = Promise.resolve();
  private releaseLookup: () => void = () => {};

  constructor(readonly deploymentId: string) {}

  armLookupHold(): void {
    this.holdLookups = true;
    this.lookupWaits = 0;
    this.lookupGate = new Promise((resolve) => {
      this.releaseLookup = () => {
        this.holdLookups = false;
        resolve();
      };
    });
  }

  releaseLookups(): void {
    this.releaseLookup();
  }

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('provider_user_id = $4') && !sql.includes('OR player_id') && this.holdLookups) {
      this.lookupWaits += 1;
      await this.lookupGate;
    }
    if (this.down) throw new Error('database unavailable');
    if (sql.includes('SAVEPOINT') || sql.includes('RELEASE') || sql.includes('ROLLBACK TO')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("server_mode = 'legacy'")) {
      const hit = this.legacyHashes.has(String(params[1]));
      return { rows: (hit ? [{}] : []) as T[], rowCount: hit ? 1 : 0 };
    }
    if (sql.includes('SELECT state, player_id')) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      const row = this.receipts.get(key);
      const rows = row ? [{ state: row.state, player_id: row.playerId }] : [];
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO yandex_proof_receipts')) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      if (this.receipts.has(key)) return { rows: [], rowCount: 0 };
      this.receipts.set(key, { state: 'reserved', attemptId: String(params[5]), playerId: String(params[4]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET state = 'consumed'")) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      const row = this.receipts.get(key);
      if (!row || row.state !== 'reserved' || row.attemptId !== String(params[4])) return { rows: [], rowCount: 0 };
      row.state = 'consumed';
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM yandex_proof_receipts') && !sql.includes('SKIP LOCKED')) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      const row = this.receipts.get(key);
      if (!row || row.state !== 'reserved' || row.attemptId !== String(params[4])) return { rows: [], rowCount: 0 };
      this.receipts.delete(key);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO player_identity_links')) {
      const scope = `${String(params[0])}|${String(params[1])}|${String(params[2])}`;
      const providerUserId = String(params[3]);
      const playerId = String(params[4]);
      if (this.links.some((row) => row.scope === scope && (row.providerUserId === providerUserId || row.playerId === playerId))) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      this.links.push({ scope, providerUserId, playerId });
      if (this.throwAfterLinkInsert) {
        this.throwAfterLinkInsert = false;
        throw new Error('link commit outcome unknown');
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('OR player_id')) {
      const scope = `${String(params[0])}|${String(params[1])}|${String(params[2])}`;
      const providerUserId = String(params[3]);
      const playerId = String(params[4]);
      const rows = this.links
        .filter((row) => row.scope === scope && (row.providerUserId === providerUserId || row.playerId === playerId))
        .map((row) => ({ player_id: row.playerId, provider_user_id: row.providerUserId }));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (sql.includes('provider_user_id = $4')) {
      const scope = `${String(params[0])}|${String(params[1])}|${String(params[2])}`;
      const row = this.links.find((link) => link.scope === scope && link.providerUserId === String(params[3]));
      const rows = row ? [{ player_id: row.playerId }] : [];
      return { rows: rows as T[], rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

let issuedAt = Math.floor(Date.now() / 1000);

function proof(uniqueId: string): string {
  issuedAt += 1;
  return signedPlayerProfile(uniqueId, SYNTHETIC_YANDEX_SECRET, issuedAt);
}

async function openTracked(
  db: MemoryIdentityDb,
  mode: ServerMode = 'anarchy',
  auth = true,
): Promise<{ server: AnarchyServer; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-yandex-auto-'));
  dirs.push(dir);
  const env: NodeJS.ProcessEnv = {
    HOST: '127.0.0.1',
    PORT: '0',
    WORLD: mode,
    SERVER_MODE: mode,
    WORLD_SEED: ANARCHY_WORLD_SEED,
    MAX_PLAYERS: '8',
    CHUNK_VIEW_RADIUS: '1',
    TICK_RATE: '20',
    PERSIST_INTERVAL_MS: '600000',
    FC_DATABASE_URL: 'postgres://local/yandex-test',
    FC_DEPLOYMENT_ID: 'dev',
  };
  if (auth) {
    env.FC_YANDEX_AUTH_ENABLED = '1';
    env.FC_YANDEX_AUTH_SECRET = SYNTHETIC_YANDEX_SECRET;
  }
  const config = {
    ...loadServerConfig(env, process.cwd()),
    dataDir: dir,
    chunkViewRadius: 1,
    persistIntervalMs: 600_000,
  };
  const server = new AnarchyServer(config, { database: db });
  await server.start();
  return { server, dir };
}

async function openServer(
  db: MemoryIdentityDb,
  mode: ServerMode = 'anarchy',
  auth = true,
): Promise<AnarchyServer> {
  return (await openTracked(db, mode, auth)).server;
}

function connect(url: string, join: Record<string, unknown>): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('message', (data) => {
      messages.push(JSON.parse(String(data)) as ServerMessage);
    });
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, ...join }));
      resolve({ socket, messages });
    });
  });
}

async function until(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

async function welcome(messages: ServerMessage[]): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = messages.find((message) => message.type === 'welcome');
    if (found && found.type === 'welcome') return found;
    const error = messages.find((message) => message.type === 'error');
    if (error && error.type === 'error') throw Object.assign(new Error(error.message), { code: error.code });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no welcome');
}

function giveDiamond(server: AnarchyServer, playerId: string): void {
  const player = server.world.players.get(playerId);
  if (!player) throw new Error('player is offline');
  expect(player.inventory.add(createItemStack('diamond', 3))).toBeNull();
}

async function giveCoins(server: AnarchyServer, playerId: string, amount: number): Promise<void> {
  const before = server.world.money.getBalance(playerId);
  const result = await Promise.resolve(server.world.money.deposit(playerId, amount, 'yandex-auto-test'));
  expect(result.ok).toBe(true);
  expect(server.world.money.getBalance(playerId)).toBe(before + amount);
}

describe('automatic yandex join', () => {
  it('keeps an unauthorized guest in one browser and a different guest in another', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db, 'anarchy', false);
    try {
      const first = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const hello = await welcome(first.messages);
      expect(hello.yandexSync).toBeUndefined();
      first.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const again = await connect(server.wsUrl(), { name: 'Ada', sessionToken: hello.sessionToken });
      const back = await welcome(again.messages);
      expect(back.playerId).toBe(hello.playerId);
      const other = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const stranger = await welcome(other.messages);
      expect(stranger.playerId).not.toBe(hello.playerId);
      expect(db.links).toHaveLength(0);
      again.socket.close();
      other.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('opens a linked character without a manual link and does not grant a second kit', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const body = proof('linked-user');
      const created = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true, authMode: 'yandex_auto', yandexProof: body });
      const hello = await welcome(created.messages);
      expect(hello.yandexSync).toBe('linked');
      expect(db.links).toHaveLength(1);
      expect(db.links[0]?.playerId).toBe(hello.playerId);
      giveDiamond(server, hello.playerId);
      const balance = server.world.money.getBalance(hello.playerId);
      await giveCoins(server, hello.playerId, 7);
      const inventory = JSON.stringify(hello.inventory);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const same = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: hello.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: body,
      });
      const back = await welcome(same.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(back.yandexSync).toBe('restored');
      expect(JSON.stringify(back.inventory)).toBe(JSON.stringify(server.world.players.get(hello.playerId)?.inventory.serialize()));
      expect(JSON.stringify(back.inventory)).not.toBe(inventory);
      expect(JSON.stringify(back.inventory).match(/diamond/g)?.length).toBe(1);
      expect(server.world.money.getBalance(hello.playerId)).toBe(balance + 7);
      const freshProof = proof('linked-user');
      const browser = await connect(server.wsUrl(), { name: 'Ada', authMode: 'yandex_auto', yandexProof: freshProof });
      const restored = await welcome(browser.messages);
      expect(restored.playerId).toBe(hello.playerId);
      expect(restored.yandexSync).toBe('restored');
      expect(db.links).toHaveLength(1);
      expect(server.world.players.size).toBe(1);
      same.socket.close();
      browser.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('binds the existing guest instead of creating another character', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const guest = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const hello = await welcome(guest.messages);
      expect(hello.yandexSync).toBeUndefined();
      giveDiamond(server, hello.playerId);
      await giveCoins(server, hello.playerId, 4);
      const balance = server.world.money.getBalance(hello.playerId);
      guest.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const body = proof('bind-guest');
      const linked = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: hello.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: body,
      });
      const back = await welcome(linked.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(back.yandexSync).toBe('linked');
      expect(JSON.stringify(back.inventory)).toContain('diamond');
      expect(server.world.money.getBalance(hello.playerId)).toBe(balance);
      expect(db.links.map((row) => row.playerId)).toEqual([hello.playerId]);
      expect(server.world.players.size).toBe(1);
      linked.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('asks before switching characters and keeps both inventories', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const guest = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const local = await welcome(guest.messages);
      giveDiamond(server, local.playerId);
      guest.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const body = proof('other-character');
      const linked = await connect(server.wsUrl(), { name: 'Bea', freshGuest: true, authMode: 'yandex_auto', yandexProof: body });
      const remote = await welcome(linked.messages);
      expect(remote.playerId).not.toBe(local.playerId);
      const gold = createItemStack('gold_ingot', 2);
      expect(server.world.players.get(remote.playerId)?.inventory.add(gold)).toBeNull();
      await giveCoins(server, remote.playerId, 9);
      const balance = server.world.money.getBalance(remote.playerId);
      linked.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const conflict = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: local.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: proof('other-character'),
      });
      await expect(welcome(conflict.messages)).rejects.toMatchObject({ code: 'yandex_character_conflict' });
      expect(server.world.players.get(local.playerId)?.connected).not.toBe(true);
      const stayed = await connect(server.wsUrl(), { name: 'Ada', sessionToken: local.sessionToken });
      const stillLocal = await welcome(stayed.messages);
      expect(stillLocal.playerId).toBe(local.playerId);
      expect(JSON.stringify(stillLocal.inventory)).toContain('diamond');
      expect(JSON.stringify(stillLocal.inventory)).not.toContain('gold_ingot');
      stayed.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const opened = await connect(server.wsUrl(), {
        name: 'Bea',
        authMode: 'yandex_auto',
        yandexProof: proof('other-character'),
        confirmYandexResume: true,
      });
      const chosen = await welcome(opened.messages);
      expect(chosen.playerId).toBe(remote.playerId);
      expect(JSON.stringify(chosen.inventory)).toContain('gold_ingot');
      expect(JSON.stringify(chosen.inventory)).not.toContain('diamond');
      expect(server.world.money.getBalance(remote.playerId)).toBe(balance);
      expect(db.links).toHaveLength(1);
      opened.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('does not treat a client authorization flag or a bad proof as a link', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const forged = await connect(server.wsUrl(), {
        name: 'Ada',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: 'not-a-signature',
        isAuthorized: true,
        uniqueID: 'attacker',
      });
      const hello = await welcome(forged.messages);
      expect(hello.yandexSync).toBe('guest');
      expect(db.links).toHaveLength(0);
      forged.socket.close();
      const plain = await connect(server.wsUrl(), { name: 'Bea', freshGuest: true, isAuthorized: true, uniqueID: 'attacker' });
      const guest = await welcome(plain.messages);
      expect(guest.playerId).not.toBe(hello.playerId);
      expect(guest.yandexSync).toBeUndefined();
      expect(db.links).toHaveLength(0);
      plain.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('does not create a player from a reused proof and still rejoins the same guest token', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const body = proof('once-user');
      const created = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true, authMode: 'yandex_auto', yandexProof: body });
      const hello = await welcome(created.messages);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const replay = await connect(server.wsUrl(), { name: 'Ada', authMode: 'yandex_auto', yandexProof: body });
      await expect(welcome(replay.messages)).rejects.toMatchObject({ code: 'proof_reused' });
      expect(server.world.players.size).toBe(1);
      const again = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: hello.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: body,
      });
      const back = await welcome(again.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(db.links).toHaveLength(1);
      again.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('keeps the guest when the database is down and does not report a link', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const guest = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const hello = await welcome(guest.messages);
      guest.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      db.down = true;
      const retry = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: hello.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: proof('db-down'),
      });
      const back = await welcome(retry.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(back.yandexSync).toBe('unavailable');
      expect(db.links).toHaveLength(0);
      retry.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('leaves auth disabled as a guest and keeps survival separate from anarchy', async () => {
    const db = new MemoryIdentityDb('dev');
    const anarchy = await openServer(db, 'anarchy', true);
    const survival = await openServer(db, 'survival', false);
    try {
      const body = proof('mode-user');
      const linked = await connect(anarchy.wsUrl(), { name: 'Ada', freshGuest: true, authMode: 'yandex_auto', yandexProof: body });
      const hello = await welcome(linked.messages);
      expect(hello.yandexSync).toBe('linked');
      const guest = await connect(survival.wsUrl(), {
        name: 'Ada',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: proof('mode-user'),
      });
      const other = await welcome(guest.messages);
      expect(other.yandexSync).toBeUndefined();
      expect(other.playerId).not.toBe(hello.playerId);
      expect(db.links).toHaveLength(1);
      expect(db.links[0]?.scope.startsWith('dev|anarchy|')).toBe(true);
      linked.socket.close();
      guest.socket.close();
    } finally {
      await survival.stop();
      await anarchy.stop();
    }
  });

  it('creates one character when two first joins race the same Yandex id', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    db.armLookupHold();
    try {
      const firstProof = proof('race-user');
      const secondProof = proof('race-user');
      const left = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true, authMode: 'yandex_auto', yandexProof: firstProof });
      const right = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true, authMode: 'yandex_auto', yandexProof: secondProof });
      expect(await until(() => db.lookupWaits >= 2)).toBe(true);
      db.releaseLookups();
      const results = await Promise.allSettled([welcome(left.messages), welcome(right.messages)]);
      const welcomed = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      expect(welcomed.length).toBeGreaterThan(0);
      const ids = new Set(welcomed.map((row) => row.playerId));
      expect(ids.size).toBe(1);
      expect(db.links).toHaveLength(1);
      expect(db.links[0]?.playerId).toBe([...ids][0]);
      expect(server.world.players.size).toBe(1);
      expect([...ids][0]).toBe(db.links[0]?.playerId);
      left.socket.close();
      right.socket.close();
    } finally {
      db.releaseLookups();
      await server.stop();
    }
  });

  it('keeps a committed link when publication is refused and the next join returns that uuid', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server, dir } = await openTracked(db);
    let stopped = false;
    try {
      server.world.beforeJoinPublish = async () => {
        server.world.publishRefusal = { error: 'publication held', code: 'publish_held' };
      };
      const created = await connect(server.wsUrl(), {
        name: 'Ada',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: proof('held-user'),
      });
      await expect(welcome(created.messages)).rejects.toMatchObject({ code: 'publish_held' });
      expect(db.links).toHaveLength(1);
      const linkedId = db.links[0]!.playerId;
      expect(server.world.players.has(linkedId)).toBe(false);
      created.socket.close();
      server.world.beforeJoinPublish = undefined;
      const again = await connect(server.wsUrl(), { name: 'Ada', authMode: 'yandex_auto', yandexProof: proof('held-user') });
      const back = await welcome(again.messages);
      expect(back.playerId).toBe(linkedId);
      expect(back.yandexSync).toBe('restored');
      const inventory = JSON.stringify(back.inventory);
      again.socket.send(JSON.stringify({ type: 'chat', text: 'held-ok', channel: 'global' }));
      expect(await until(() => again.messages.some((message) => message.type === 'chat' && message.text.includes('held-ok')))).toBe(true);
      again.socket.close();
      await server.stop();
      stopped = true;
      const restarted = new AnarchyServer({
        ...loadServerConfig({
          HOST: '127.0.0.1',
          PORT: '0',
          WORLD: 'anarchy',
          SERVER_MODE: 'anarchy',
          WORLD_SEED: ANARCHY_WORLD_SEED,
          MAX_PLAYERS: '8',
          CHUNK_VIEW_RADIUS: '1',
          TICK_RATE: '20',
          PERSIST_INTERVAL_MS: '600000',
          FC_DATABASE_URL: 'postgres://local/yandex-test',
          FC_DEPLOYMENT_ID: 'dev',
          FC_YANDEX_AUTH_ENABLED: '1',
          FC_YANDEX_AUTH_SECRET: SYNTHETIC_YANDEX_SECRET,
        }, process.cwd()),
        dataDir: dir,
        chunkViewRadius: 1,
        persistIntervalMs: 600_000,
      }, { database: db });
      await restarted.start();
      try {
        const afterRestart = await connect(restarted.wsUrl(), {
          name: 'Ada',
          authMode: 'yandex_auto',
          yandexProof: proof('held-user'),
        });
        const restored = await welcome(afterRestart.messages);
        expect(restored.playerId).toBe(linkedId);
        expect(JSON.stringify(restored.inventory)).toBe(inventory);
        expect(db.links).toHaveLength(1);
        expect(restarted.world.players.size).toBe(1);
        afterRestart.socket.close();
      } finally {
        await restarted.stop();
      }
    } finally {
      if (!stopped) await server.stop();
    }
  });

  it('keeps the player when the link insert is committed and the driver then throws', async () => {
    const db = new MemoryIdentityDb('dev');
    db.throwAfterLinkInsert = true;
    const server = await openServer(db);
    try {
      const created = await connect(server.wsUrl(), {
        name: 'Ada',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: proof('thrown-link'),
      });
      const hello = await welcome(created.messages);
      expect(hello.yandexSync).toBe('linked');
      expect(db.links.map((row) => row.playerId)).toEqual([hello.playerId]);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const again = await connect(server.wsUrl(), { name: 'Ada', authMode: 'yandex_auto', yandexProof: proof('thrown-link') });
      const back = await welcome(again.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(db.links).toHaveLength(1);
      expect(server.world.players.size).toBe(1);
      again.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('stays on guest A after the conflict choice and opens B only when that choice is explicit', async () => {
    const db = new MemoryIdentityDb('dev');
    const server = await openServer(db);
    try {
      const guest = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const local = await welcome(guest.messages);
      expect(server.world.players.get(local.playerId)?.inventory.add(createItemStack('diamond', 3))).toBeNull();
      guest.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const linked = await connect(server.wsUrl(), {
        name: 'Bea',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: proof('choice-user'),
      });
      const remote = await welcome(linked.messages);
      expect(server.world.players.get(remote.playerId)?.inventory.add(createItemStack('gold_ingot', 2))).toBeNull();
      linked.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const conflict = await connect(server.wsUrl(), {
        name: 'Ada',
        sessionToken: local.sessionToken,
        authMode: 'yandex_auto',
        yandexProof: proof('choice-user'),
      });
      await expect(welcome(conflict.messages)).rejects.toMatchObject({ code: 'yandex_character_conflict' });
      const guestPlan = planAfterCharacterChoice('guest', proof('choice-user'));
      const guestJoin = guestPlan.kind === 'guest'
        ? { name: 'Ada', sessionToken: local.sessionToken }
        : { name: 'Ada', authMode: 'yandex_auto' as const, yandexProof: guestPlan.proof, confirmYandexResume: true };
      expect(guestJoin).not.toHaveProperty('authMode');
      expect(guestJoin).toMatchObject({ sessionToken: local.sessionToken });
      const stayed = await connect(server.wsUrl(), guestJoin);
      const asGuest = await welcome(stayed.messages);
      expect(asGuest.playerId).toBe(local.playerId);
      expect(asGuest.yandexSync).toBeUndefined();
      expect(JSON.stringify(asGuest.inventory)).toContain('diamond');
      expect(JSON.stringify(asGuest.inventory)).not.toContain('gold_ingot');
      stayed.socket.send(JSON.stringify({ type: 'chat', text: 'guest-ok', channel: 'global' }));
      expect(await until(() => stayed.messages.some((message) => message.type === 'chat' && message.text.includes('guest-ok')))).toBe(true);
      stayed.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const yandexPlan = planAfterCharacterChoice('yandex', proof('choice-user'));
      expect(yandexPlan.kind).toBe('yandex');
      const opened = await connect(server.wsUrl(), {
        name: 'Bea',
        authMode: 'yandex_auto',
        yandexProof: yandexPlan.kind === 'yandex' ? yandexPlan.proof : '',
        confirmYandexResume: yandexPlan.kind === 'yandex' && yandexPlan.confirmOtherCharacter,
      });
      const asYandex = await welcome(opened.messages);
      expect(asYandex.playerId).toBe(remote.playerId);
      expect(JSON.stringify(asYandex.inventory)).toContain('gold_ingot');
      expect(JSON.stringify(asYandex.inventory)).not.toContain('diamond');
      expect(db.links).toHaveLength(1);
      opened.socket.close();
    } finally {
      await server.stop();
    }
  });
});
