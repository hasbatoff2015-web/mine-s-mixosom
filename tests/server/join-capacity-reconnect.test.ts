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
  down = false;

  constructor(readonly deploymentId: string) {}
  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (this.down) throw new Error('database unavailable');
    if (sql.includes('SAVEPOINT') || sql.includes('RELEASE') || sql.includes('ROLLBACK TO')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT state, player_id') || sql.includes("server_mode = 'legacy'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO yandex_proof_receipts')) {
      const key = `${String(params[0])}|${String(params[1])}|${String(params[2])}|${String(params[3])}`;
      if (this.receipts.has(key)) return { rows: [], rowCount: 0 };
      this.receipts.set(key, { state: 'reserved', attemptId: String(params[5]) });
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
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('OR player_id')) {
      const scope = `${String(params[0])}|${String(params[1])}|${String(params[2])}`;
      const rows = this.links
        .filter((row) => row.scope === scope && (row.providerUserId === String(params[3]) || row.playerId === String(params[4])))
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

async function openServer(): Promise<{ server: AnarchyServer; db: MemoryIdentityDb }> {
  const dir = await mkdtemp(join(tmpdir(), 'fc-capacity-'));
  dirs.push(dir);
  const db = new MemoryIdentityDb('dev');
  const config = {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '1',
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
  return { server, db };
}

function connect(url: string, join: Record<string, unknown>): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
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

async function raceReconnect(
  prepare: (server: AnarchyServer) => Promise<{ socket: WebSocket; playerId: string; rejoin: Record<string, unknown> }>,
  finishOrder: 'stranger-first' | 'rejoin-first',
): Promise<void> {
  const { server } = await openServer();
  const gates: Array<{ release: () => void }> = [];
  try {
    const ready = await prepare(server);
    const oldConnection = server.world.players.get(ready.playerId)?.connectionId;
    server.world.beforeJoinPublish = () => new Promise((resolve) => {
      gates.push({ release: resolve });
    });
    const rejoining = await connect(server.wsUrl(), { name: 'Ada', ...ready.rejoin });
    expect(await until(() => gates.length === 1)).toBe(true);
    ready.socket.close();
    expect(await until(() => server.world.players.get(ready.playerId)?.connected === false)).toBe(true);
    if (finishOrder === 'stranger-first') {
      const stranger = await connect(server.wsUrl(), { name: 'Cora', freshGuest: true });
      await expect(welcome(stranger.messages)).rejects.toMatchObject({ message: 'server full' });
      gates[0]?.release();
      const back = await welcome(rejoining.messages);
      expect(back.playerId).toBe(ready.playerId);
      stranger.socket.close();
    } else {
      gates[0]?.release();
      const back = await welcome(rejoining.messages);
      expect(back.playerId).toBe(ready.playerId);
      const stranger = await connect(server.wsUrl(), { name: 'Cora', freshGuest: true });
      await expect(welcome(stranger.messages)).rejects.toMatchObject({ message: 'server full' });
      stranger.socket.close();
    }
    const winner = server.world.players.get(ready.playerId);
    expect(winner?.connected).toBe(true);
    expect(winner?.connectionId).not.toBe(oldConnection);
    expect(server.world.onlineCount()).toBeLessThanOrEqual(1);
    server.world.disconnect(ready.playerId, true, oldConnection);
    expect(winner?.connected).toBe(true);
    expect(server.world.onlineCount()).toBe(1);
    rejoining.socket.send(JSON.stringify({ type: 'chat', text: 'race-ok', channel: 'global' }));
    expect(await until(() => rejoining.messages.some((message) => message.type === 'chat' && message.text.includes('race-ok')))).toBe(true);
    expect(server.world.players.get(ready.playerId)?.connectionId).toBe(winner?.connectionId);
    rejoining.socket.close();
  } finally {
    for (const gate of gates) gate.release();
    await server.stop();
  }
}

describe('reconnect capacity race', () => {
  it('keeps the seat when the old guest socket drops before the rejoin publishes', async () => {
    await raceReconnect(async (server) => {
      const first = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const hello = await welcome(first.messages);
      return { socket: first.socket, playerId: hello.playerId, rejoin: { sessionToken: hello.sessionToken } };
    }, 'stranger-first');
  });

  it('rejects a stranger after the guest rejoin publishes', async () => {
    await raceReconnect(async (server) => {
      const first = await connect(server.wsUrl(), { name: 'Ada', freshGuest: true });
      const hello = await welcome(first.messages);
      return { socket: first.socket, playerId: hello.playerId, rejoin: { sessionToken: hello.sessionToken } };
    }, 'rejoin-first');
  });

  it('keeps the seat for a Yandex resume that is still pending', async () => {
    await raceReconnect(async (server) => {
      const created = await connect(server.wsUrl(), {
        name: 'Ada',
        freshGuest: true,
        authMode: 'yandex_auto',
        yandexProof: proof('capacity-user'),
      });
      const hello = await welcome(created.messages);
      return {
        socket: created.socket,
        playerId: hello.playerId,
        rejoin: { authMode: 'resume_yandex', yandexProof: proof('capacity-user') },
      };
    }, 'stranger-first');
  });
});
