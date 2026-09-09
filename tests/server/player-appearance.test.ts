import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/config';
import { encodeMessage, parseClientMessage, parseServerMessage, type ServerMessage } from '../../shared/protocol';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { AnarchyServer } from '../../server/AnarchyServer';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
} from '../../src/player/appearance/PlayerAppearance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-appearance-'));
}

function testConfig(dataDir: string, port = 0) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: String(port),
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: false,
    operators: [] as string[],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

const slim = createPlayerAppearance({
  skinId: 'e3eb6f99ea1c3fe1',
  model: 'slim',
});

class TestClient {
  readonly messages: ServerMessage[] = [];
  private socket: WebSocket | undefined;

  async connect(url: string, extra?: {
    name?: string;
    sessionToken?: string;
    appearance?: typeof slim;
  }): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    const socket = new WebSocket(url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.on('message', (data) => {
      const parsed = parseServerMessage(JSON.parse(String(data)));
      if ('error' in parsed) return;
      this.messages.push(parsed);
    });
    this.send({
      type: 'join',
      protocol: PROTOCOL_VERSION,
      ...(extra?.name ? { name: extra.name } : {}),
      ...(extra?.sessionToken ? { sessionToken: extra.sessionToken } : {}),
      ...(extra?.appearance ? { appearance: extra.appearance } : {}),
    });
    return this.waitFor('welcome');
  }

  send(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload));
  }

  async waitFor<T extends ServerMessage['type']>(type: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { type: T }>> {
    const existing = this.messages.find((message) => message.type === type);
    if (existing) return existing as Extract<ServerMessage, { type: T }>;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      const timer = setInterval(() => {
        const found = this.messages.find((message) => message.type === type);
        if (!found) return;
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(found as Extract<ServerMessage, { type: T }>);
      }, 10);
    });
  }

  close(): void {
    this.socket?.close();
  }
}

describe('authoritative player appearance', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  const servers: AnarchyServer[] = [];
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const server of servers.splice(0)) await server.stop();
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stores appearance on join/snapshot and rejects unknown skin ids', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({
      sink,
      name: 'Misha',
      appearance: slim,
    });
    if ('error' in joined) throw new Error(joined.error);
    expect(joined.player.appearance.skinId).toBe(slim.skinId);
    expect(joined.player.remoteInfo().appearance).toEqual(slim);
    expect(joined.player.snapshot().appearance).toBeUndefined();

    const invalid = world.setAppearance(joined.player, {
      skinId: 'definitely_missing',
      model: 'classic',
      layers: DEFAULT_PLAYER_APPEARANCE.layers,
    });
    expect(invalid.ok).toBe(false);
    expect(joined.player.appearance.skinId).toBe(slim.skinId);
    const png = parseClientMessage({
      type: 'appearance',
      skinId: slim.skinId,
      model: 'slim',
      base64: 'aaaa',
    });
    expect(png).toEqual({ error: 'appearance invalid' });
  });

  it('keeps the chosen skin across disconnect, reconnect, and server restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const first = world.join({
      sink: new MemorySink(),
      name: 'Misha',
      appearance: slim,
    });
    if ('error' in first) throw new Error(first.error);
    const token = first.player.sessionToken;
    const id = first.player.id;
    world.disconnect(id, true);
    const resumed = world.join({
      sink: new MemorySink(),
      sessionToken: token,
    });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.resumed).toBe(true);
    expect(resumed.player.appearance.skinId).toBe(slim.skinId);
    await world.save();
    await world.stop();
    worlds.pop();

    const restarted = new WorldInstance(testConfig(dir));
    worlds.push(restarted);
    await restarted.initialize();
    const afterRestart = restarted.join({
      sink: new MemorySink(),
      sessionToken: token,
    });
    if ('error' in afterRestart) throw new Error(afterRestart.error);
    expect(afterRestart.player.id).toBe(id);
    expect(afterRestart.player.appearance).toEqual(slim);
  });

  it('syncs appearance metadata to other clients without PNG bytes', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const server = new AnarchyServer(testConfig(dir));
    servers.push(server);
    await server.start();
    const url = `ws://127.0.0.1:${server.port}`;
    const alice = new TestClient();
    const bob = new TestClient();
    clients.push(alice, bob);
    const welcomeA = await alice.connect(url, { name: 'Alice', appearance: DEFAULT_PLAYER_APPEARANCE });
    expect(welcomeA.you.appearance?.skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    expect(JSON.stringify(welcomeA)).not.toMatch(/png|base64|data:image/i);
    const welcomeB = await bob.connect(url, { name: 'Bob', appearance: slim });
    expect(welcomeB.you.appearance).toEqual(slim);
    const joined = alice.messages.find((message) => message.type === 'player_joined');
    expect(joined).toMatchObject({
      type: 'player_joined',
      player: { name: 'Bob', appearance: slim },
    });

    bob.send({
      type: 'appearance',
      skinId: DEFAULT_PLAYER_APPEARANCE.skinId,
      model: 'classic',
      layers: DEFAULT_PLAYER_APPEARANCE.layers,
    });
    const change = await alice.waitFor('player_appearance');
    expect(change.appearance.skinId).toBe(DEFAULT_PLAYER_APPEARANCE.skinId);
    expect(encodeMessage(change)).not.toMatch(/png|base64/i);

    const state = alice.messages.find((message) => message.type === 'player_state');
    if (state && state.type === 'player_state') {
      for (const player of state.players) {
        expect(player.appearance).toBeUndefined();
      }
    }
  });
});
