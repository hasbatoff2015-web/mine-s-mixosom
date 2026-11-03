import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { ServerMessage } from '../../shared/protocol';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
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
  readonly receipts = new Map<string, { state: 'reserved' | 'consumed'; attemptId: string }>();
  readonly legacyHashes = new Set<string>();
  failConsume: 'ok' | 'miss' | 'throw' = 'ok';
  down = false;

  constructor(readonly deploymentId: string) {}

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (this.down) throw new Error('database unavailable');
    if (sql.includes('SAVEPOINT') || sql.includes('RELEASE') || sql.includes('ROLLBACK TO')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("server_mode = 'legacy'")) {
      const hit = this.legacyHashes.has(String(params[1]));
      return { rows: (hit ? [{}] : []) as T[], rowCount: hit ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO yandex_proof_receipts')) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      if (this.receipts.has(key)) return { rows: [], rowCount: 0 };
      this.receipts.set(key, { state: 'reserved', attemptId: String(params[5]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET state = 'consumed'")) {
      if (this.failConsume === 'throw') throw new Error('consume failed');
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      const row = this.receipts.get(key);
      if (this.failConsume === 'miss' || !row || row.state !== 'reserved' || row.attemptId !== String(params[4])) {
        return { rows: [], rowCount: 0 };
      }
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

async function openServer(db: MemoryIdentityDb, maxPlayers = 8): Promise<{ server: AnarchyServer; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-yandex-'));
  dirs.push(dir);
  const config = {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: String(maxPlayers),
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
  };
  const server = new AnarchyServer(config, { database: db });
  await server.start();
  return { server, dir };
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

async function until(predicate: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

function welcomeOf(messages: ServerMessage[]): Extract<ServerMessage, { type: 'welcome' }> | undefined {
  const found = messages.find((message) => message.type === 'welcome');
  return found && found.type === 'welcome' ? found : undefined;
}

async function welcome(messages: ServerMessage[]): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const found = messages.find((message) => message.type === 'welcome');
    if (found && found.type === 'welcome') return found;
    const error = messages.find((message) => message.type === 'error');
    if (error && error.type === 'error') throw Object.assign(new Error(error.message), { code: error.code });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no welcome');
}

describe('yandex link and resume', () => {
  it('links the connected guest and resumes that uuid with the same items', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    try {
      const first = await connect(server.wsUrl(), { name: 'Ada' });
      const hello = await welcome(first.messages);
      const player = server.world.players.get(hello.playerId);
      if (!player) throw new Error('missing player');
      player.inventory.clear();
      player.inventory.addItem('diamond', 4);
      const body = proof('yandex-user');
      first.socket.send(JSON.stringify({ type: 'auth_link', proof: body }));
      const deadline = Date.now() + 3000;
      let status = '';
      while (Date.now() < deadline && status === '') {
        const result = first.messages.find((message) => message.type === 'auth_result');
        if (result && result.type === 'auth_result') status = result.status;
        else await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(status).toBe('linked');
      expect(db.links).toEqual([{
        scope: 'dev|anarchy|anarchy',
        providerUserId: 'yandex-user',
        playerId: hello.playerId,
      }]);
      first.socket.send(JSON.stringify({ type: 'auth_link', proof: body }));
      const againAt = Date.now() + 3000;
      let again = '';
      while (Date.now() < againAt && again === '') {
        const results = first.messages.filter((message) => message.type === 'auth_result');
        const second = results[1];
        if (second && second.type === 'auth_result') again = second.status;
        else await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(again).toBe('already_linked');
      expect(db.links).toHaveLength(1);
      first.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const second = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: body });
      const back = await welcome(second.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(server.world.players.size).toBe(1);
      expect(server.world.players.get(back.playerId)?.inventory.has('diamond', 4)).toBe(true);
      const third = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: body });
      await expect(welcome(third.messages)).rejects.toMatchObject({ code: 'proof_reused' });
      expect(server.world.players.size).toBe(1);
      second.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('does not merge a local guest with a different linked character', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    try {
      const guest = await connect(server.wsUrl(), { name: 'GuestA' });
      const welcomeA = await welcome(guest.messages);
      const linked = await connect(server.wsUrl(), { name: 'GuestB' });
      const welcomeB = await welcome(linked.messages);
      const playerB = server.world.players.get(welcomeB.playerId);
      playerB?.inventory.clear();
      playerB?.inventory.addItem('diamond', 2);
      const body = proof('shared-yandex');
      linked.socket.send(JSON.stringify({ type: 'auth_link', proof: body }));
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !linked.messages.some((message) => message.type === 'auth_result')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      guest.socket.close();
      linked.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
      const conflict = await connect(server.wsUrl(), {
        name: 'GuestA',
        sessionToken: welcomeA.sessionToken,
        authMode: 'resume_yandex',
        yandexProof: body,
      });
      await expect(welcome(conflict.messages)).rejects.toMatchObject({ code: 'yandex_character_conflict' });
      expect(server.world.players.get(welcomeA.playerId)?.sessionToken).toBe(welcomeA.sessionToken);
      expect(server.world.players.get(welcomeB.playerId)?.inventory.has('diamond', 2)).toBe(true);
      const confirmed = await connect(server.wsUrl(), {
        name: 'GuestB',
        authMode: 'resume_yandex',
        yandexProof: proof('shared-yandex'),
        confirmYandexResume: true,
      });
      const back = await welcome(confirmed.messages);
      expect(back.playerId).toBe(welcomeB.playerId);
      expect(server.world.players.get(back.playerId)?.inventory.has('diamond', 2)).toBe(true);
      expect(server.world.players.has(welcomeA.playerId)).toBe(true);
      confirmed.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('keeps the newer resume playable when an older join finishes later', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    const gates: Array<{ release: () => void }> = [];
    server.world.beforeJoinPublish = () => new Promise((resolve) => {
      gates.push({ release: resolve });
    });
    try {
      const created = await connect(server.wsUrl(), { name: 'Solo' });
      while (gates.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
      gates.shift()?.release();
      const hello = await welcome(created.messages);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      server.world.beforeJoinPublish = () => new Promise((resolve) => {
        gates.push({ release: resolve });
      });
      const left = await connect(server.wsUrl(), { name: 'Solo', sessionToken: hello.sessionToken });
      const right = await connect(server.wsUrl(), { name: 'Solo', sessionToken: hello.sessionToken });
      const deadline = Date.now() + 3000;
      while (gates.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(gates).toHaveLength(2);
      const firstGate = gates[0]!;
      const secondGate = gates[1]!;
      secondGate.release();
      const rightWelcome = await welcome(right.messages);
      expect(rightWelcome.playerId).toBe(hello.playerId);
      firstGate.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const player = server.world.players.get(hello.playerId);
      expect(player?.connected).toBe(true);
      right.socket.send(JSON.stringify({ type: 'ping', t: 7 }));
      const pongAt = Date.now() + 3000;
      let pong = false;
      while (Date.now() < pongAt && !pong) {
        pong = right.messages.some((message) => message.type === 'pong');
        if (!pong) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(pong).toBe(true);
      const liveId = player?.connectionId;
      right.socket.send(JSON.stringify({ type: 'chat', text: 'race-ok', channel: 'global' }));
      const chatAt = Date.now() + 3000;
      let chat = false;
      while (Date.now() < chatAt && !chat) {
        chat = right.messages.some((message) => message.type === 'chat' && message.text.includes('race-ok'));
        if (!chat) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(chat).toBe(true);
      expect(player?.connected).toBe(true);
      expect(player?.connectionId).toBe(liveId);
      expect(server.world.players.size).toBe(1);
      left.socket.close();
      right.socket.close();
    } finally {
      for (const gate of gates) gate.release();
      await server.stop();
    }
  });

  it('does not welcome when proof consumption is rejected or the database throws', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    try {
      const created = await connect(server.wsUrl(), { name: 'Ada' });
      const hello = await welcome(created.messages);
      const player = server.world.players.get(hello.playerId);
      if (!player) throw new Error('missing player');
      player.inventory.clear();
      player.inventory.addItem('diamond', 4);
      const balance = await Promise.resolve(server.world.money.setBalance(hello.playerId, 40, 'yandex-test'));
      expect(balance.ok).toBe(true);
      const body = proof('yandex-user');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: body, requestId: 'link-request-1' }));
      expect(await until(() => created.messages.some((message) => message.type === 'auth_result'))).toBe(true);
      const linked = created.messages.find((message) => message.type === 'auth_result');
      expect(linked && linked.type === 'auth_result' ? linked.requestId : '').toBe('link-request-1');
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const saved = player.inventory.serialize();
      db.failConsume = 'miss';
      const missed = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: body });
      expect(await until(() => missed.messages.some((message) => message.type === 'error'))).toBe(true);
      expect(welcomeOf(missed.messages)).toBeUndefined();
      expect(JSON.stringify(missed.messages)).not.toContain(hello.sessionToken);
      expect(server.world.players.get(hello.playerId)?.connected).toBe(false);
      expect(server.world.players.get(hello.playerId)?.inventory.serialize()).toEqual(saved);
      expect(server.world.money.getBalance(hello.playerId)).toBe(40);
      expect([...db.receipts.values()].some((row) => row.state === 'consumed')).toBe(false);
      db.failConsume = 'ok';
      const recovered = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: body });
      const back = await welcome(recovered.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(back.sessionToken).toBe(hello.sessionToken);
      expect(server.world.players.get(back.playerId)?.inventory.has('diamond', 4)).toBe(true);
      recovered.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));

      db.failConsume = 'throw';
      const thrownProof = proof('yandex-user');
      const thrown = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: thrownProof });
      expect(await until(() => thrown.messages.some((message) => message.type === 'error'))).toBe(true);
      expect(welcomeOf(thrown.messages)).toBeUndefined();
      expect(JSON.stringify(thrown.messages)).not.toContain(hello.sessionToken);
      expect(server.world.players.get(hello.playerId)?.connected).toBe(false);
      expect(server.world.players.get(hello.playerId)?.inventory.serialize()).toEqual(saved);
      expect([...db.receipts.values()].some((row) => row.state === 'reserved')).toBe(true);
      const replay = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: thrownProof });
      await expect(welcome(replay.messages)).rejects.toMatchObject({ code: 'proof_reused' });
      expect(welcomeOf(replay.messages)).toBeUndefined();
      db.failConsume = 'ok';
      db.down = true;
      const guest = await connect(server.wsUrl(), { name: 'StillGuest', freshGuest: true });
      const guestHello = await welcome(guest.messages);
      expect(guestHello.playerId).not.toBe(hello.playerId);
      const blocked = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: proof('yandex-user') });
      await expect(welcome(blocked.messages)).rejects.toMatchObject({ code: 'db_unavailable' });
      expect(welcomeOf(blocked.messages)).toBeUndefined();
      guest.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('keeps the newer yandex session when an older resume finishes later', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    const gates: Array<{ release: () => void }> = [];
    try {
      const created = await connect(server.wsUrl(), { name: 'Solo' });
      const hello = await welcome(created.messages);
      const body = proof('solo-yandex');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: body, requestId: 'link-solo-1' }));
      expect(await until(() => created.messages.some((message) => message.type === 'auth_result'))).toBe(true);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      server.world.beforeJoinPublish = () => new Promise((resolve) => {
        gates.push({ release: resolve });
      });
      const older = await connect(server.wsUrl(), {
        name: 'Solo',
        authMode: 'resume_yandex',
        yandexProof: signedLater('solo-yandex', 0),
      });
      expect(await until(() => gates.length >= 1)).toBe(true);
      const newer = await connect(server.wsUrl(), {
        name: 'Solo',
        authMode: 'resume_yandex',
        yandexProof: signedLater('solo-yandex', 1),
      });
      expect(await until(() => gates.length >= 2)).toBe(true);
      gates[1]?.release();
      const right = await welcome(newer.messages);
      expect(right.playerId).toBe(hello.playerId);
      const liveId = server.world.players.get(hello.playerId)?.connectionId;
      gates[0]?.release();
      expect(await until(() => older.messages.some((message) => message.type === 'error'))).toBe(true);
      expect(welcomeOf(older.messages)).toBeUndefined();
      const player = server.world.players.get(hello.playerId);
      expect(player?.connected).toBe(true);
      expect(player?.connectionId).toBe(liveId);
      newer.socket.send(JSON.stringify({ type: 'chat', text: 'race-ok', channel: 'global' }));
      expect(await until(() => newer.messages.some((message) => message.type === 'chat' && message.text.includes('race-ok')))).toBe(true);
      expect(player?.connectionId).toBe(liveId);
      expect(server.world.onlineCount()).toBe(1);
      older.socket.close();
      newer.socket.close();
    } finally {
      for (const gate of gates) gate.release();
      await server.stop();
    }
  });

  it('lets an already online player replace the session on a full server', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db, 1);
    try {
      const created = await connect(server.wsUrl(), { name: 'Ada' });
      const hello = await welcome(created.messages);
      const body = proof('full-yandex');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: body }));
      expect(await until(() => created.messages.some((message) => message.type === 'auth_result'))).toBe(true);
      const stranger = await connect(server.wsUrl(), { name: 'Bea', freshGuest: true });
      await expect(welcome(stranger.messages)).rejects.toMatchObject({ message: 'server full' });
      expect(server.world.onlineCount()).toBe(1);
      const resumed = await connect(server.wsUrl(), {
        name: 'Ada',
        authMode: 'resume_yandex',
        yandexProof: proof('full-yandex'),
      });
      const back = await welcome(resumed.messages);
      expect(back.playerId).toBe(hello.playerId);
      expect(server.world.onlineCount()).toBe(1);
      const same = await connect(server.wsUrl(), { name: 'Ada', sessionToken: hello.sessionToken });
      const guestBack = await welcome(same.messages);
      expect(guestBack.playerId).toBe(hello.playerId);
      expect(server.world.onlineCount()).toBe(1);
      const other = await connect(server.wsUrl(), { name: 'Cora', freshGuest: true });
      await expect(welcome(other.messages)).rejects.toMatchObject({ message: 'server full' });
      expect(server.world.onlineCount()).toBe(1);
      same.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const filler = await connect(server.wsUrl(), { name: 'Bea', freshGuest: true });
      const filled = await welcome(filler.messages);
      expect(filled.playerId).not.toBe(hello.playerId);
      const offline = await connect(server.wsUrl(), { name: 'Ada', sessionToken: hello.sessionToken });
      await expect(welcome(offline.messages)).rejects.toMatchObject({ message: 'server full' });
      expect(server.world.onlineCount()).toBe(1);
      expect(server.world.players.get(filled.playerId)?.connected).toBe(true);
      filler.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('blocks a still-valid proof recorded under the old string hash', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    try {
      const created = await connect(server.wsUrl(), { name: 'Ada' });
      const hello = await welcome(created.messages);
      const body = proof('legacy-user');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: body }));
      expect(await until(() => created.messages.some((message) => message.type === 'auth_result'))).toBe(true);
      created.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      db.legacyHashes.add(createHash('sha256').update(body, 'utf8').digest('hex'));
      const blocked = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: body });
      await expect(welcome(blocked.messages)).rejects.toMatchObject({ code: 'proof_reused' });
      expect(welcomeOf(blocked.messages)).toBeUndefined();
      const fresh = proof('legacy-user');
      const again = await connect(server.wsUrl(), { name: 'Ada', authMode: 'resume_yandex', yandexProof: fresh });
      const back = await welcome(again.messages);
      expect(back.playerId).toBe(hello.playerId);
      again.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('echoes only the auth_link request that is in flight', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db);
    try {
      const created = await connect(server.wsUrl(), { name: 'Ada' });
      await welcome(created.messages);
      const first = proof('echo-user');
      const second = proof('echo-user');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: first, requestId: 'request-aaa' }));
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: second, requestId: 'request-bbb' }));
      expect(await until(() => created.messages.filter((message) => message.type === 'auth_result').length >= 2)).toBe(true);
      const overlapped = created.messages.filter((message) => message.type === 'auth_result');
      const statusFor = (id: string) => {
        const found = overlapped.find((message) => message.type === 'auth_result' && message.requestId === id);
        return found && found.type === 'auth_result' ? found.status : '';
      };
      expect(statusFor('request-aaa')).toBe('linked');
      expect(statusFor('request-bbb')).toBe('busy');
      const third = proof('echo-user');
      created.socket.send(JSON.stringify({ type: 'auth_link', proof: third, requestId: 'request-ccc' }));
      expect(await until(() => created.messages.some((message) => message.type === 'auth_result' && message.requestId === 'request-ccc'))).toBe(true);
      const last = created.messages.find((message) => message.type === 'auth_result' && message.requestId === 'request-ccc');
      expect(last && last.type === 'auth_result' ? last.status : '').toBe('already_linked');
      created.socket.close();
    } finally {
      await server.stop();
    }
  });

  it('holds the last slot until the first join publishes', async () => {
    const db = new MemoryIdentityDb('dev');
    const { server } = await openServer(db, 1);
    const gates: Array<{ release: () => void }> = [];
    server.world.beforeJoinPublish = () => new Promise((resolve) => {
      gates.push({ release: resolve });
    });
    try {
      const first = await connect(server.wsUrl(), { name: 'Ada' });
      expect(await until(() => gates.length === 1)).toBe(true);
      const second = await connect(server.wsUrl(), { name: 'Bea', freshGuest: true });
      await expect(welcome(second.messages)).rejects.toMatchObject({ message: 'server full' });
      gates[0]?.release();
      const hello = await welcome(first.messages);
      expect(server.world.onlineCount()).toBe(1);
      expect(server.world.players.get(hello.playerId)?.connected).toBe(true);
      first.socket.close();
    } finally {
      for (const gate of gates) gate.release();
      await server.stop();
    }
  });
});

function signedLater(uniqueId: string, skewSeconds: number): string {
  return signedPlayerProfile(uniqueId, SYNTHETIC_YANDEX_SECRET, Math.floor(Date.now() / 1000) + skewSeconds);
}
