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
  readonly receipts = new Set<string>();

  constructor(readonly deploymentId: string) {}

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (sql.includes('SAVEPOINT') || sql.includes('RELEASE') || sql.includes('ROLLBACK TO')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO yandex_proof_receipts')) {
      const key = `${String(params[0])}:${String(params[1])}`;
      if (this.receipts.has(key)) return { rows: [], rowCount: 0 };
      this.receipts.add(key);
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

function proof(uniqueId: string): string {
  return signedPlayerProfile(uniqueId, SYNTHETIC_YANDEX_SECRET, Math.floor(Date.now() / 1000));
}

async function openServer(db: MemoryIdentityDb): Promise<{ server: AnarchyServer; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-yandex-'));
  dirs.push(dir);
  const config = {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
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
      expect(player?.connected).toBe(true);
      expect(player?.connectionId).not.toBe('');
      left.socket.close();
      right.socket.close();
    } finally {
      for (const gate of gates) gate.release();
      await server.stop();
    }
  });
});
