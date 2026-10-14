import { afterEach, describe, expect, it } from 'vitest';
import { AnarchyClient, statusUrlForServer } from '../src/net/AnarchyClient';
import { GUEST_STORAGE_KEY, withGuestScopeLock, writeGuestCredential, type GuestStorage } from '../src/net/guestIdentityStorage';
import { PROTOCOL_VERSION } from '../shared/config';

function memoryStore(initial: Record<string, string> = {}): GuestStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null; },
    setItem(key, value) { data[key] = value; },
    removeItem(key) { delete data[key]; },
  };
}

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  readyState = 1;
  url: string;
  private listeners = new Map<string, Array<(event?: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  addEventListener(type: string, fn: (event?: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  emit(type: string, event?: { data?: string }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  welcome(worldId: string, sessionToken: string, playerId = '11111111-1111-4111-8111-111111111111'): void {
    this.emit('message', {
      data: JSON.stringify({
        type: 'welcome',
        protocol: PROTOCOL_VERSION,
        playerId,
        sessionToken,
        name: 'Ada',
        seed: 'seed',
        worldId,
        timeOfDay: 0,
        spawn: [0, 64, 0],
        you: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 20, gamemode: 'survival', selectedSlot: 0 },
        inventory: { slots: [] },
        players: [],
        modifications: {},
        blockStates: {},
        furnacesLit: {},
        online: 1,
        maxPlayers: 8,
        serverName: 'test',
        holograms: [],
        buyers: [],
        serverNow: 1,
        inClan: false,
      }),
    });
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

afterEach(() => {
  FakeSocket.instances = [];
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

function installSocket(): void {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
}

function statusFetch(mode: string, world: string, seen: string[]) {
  return async (url: string) => {
    seen.push(url);
    return { ok: true, ready: true, mode, world };
  };
}

describe('guest connect routing', () => {
  it('uses the selected Survival status and token, not the Anarchy record', async () => {
    installSocket();
    const seen: string[] = [];
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, 'anarchy-token');
    writeGuestCredential(durable, { deployment: 'local', mode: 'survival', worldId: 'survival' }, 'survival-token');
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2568', 'Ada', undefined, {
      targetServer: 'survival',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
      fetchStatus: statusFetch('survival', 'survival', seen),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = FakeSocket.instances[0];
    expect(socket).toBeTruthy();
    const join = JSON.parse(socket!.sent[0] ?? '{}') as { sessionToken?: string };
    expect(join.sessionToken).toBe('survival-token');
    expect(seen).toEqual([statusUrlForServer('survival', '')]);
    expect(seen.some((url) => url.includes(':2567'))).toBe(false);
    socket!.welcome('survival', 'survival-token');
    const welcome = await pending;
    expect(welcome.playerId).toBe('11111111-1111-4111-8111-111111111111');
    const raw = JSON.parse(durable.data[GUEST_STORAGE_KEY] ?? '{}') as { records: Record<string, { sessionToken: string }> };
    expect(raw.records['local|anarchy|anarchy']?.sessionToken).toBe('anarchy-token');
    expect(raw.records['local|survival|survival']?.sessionToken).toBe('survival-token');
    client.disconnect();
  });

  it('uses the selected Peaceful status and does not send the Anarchy token', async () => {
    installSocket();
    const seen: string[] = [];
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, 'anarchy-token');
    writeGuestCredential(durable, { deployment: 'local', mode: 'peaceful', worldId: 'peaceful' }, 'peaceful-token');
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2569', 'Ada', undefined, {
      targetServer: 'peaceful',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
      fetchStatus: statusFetch('peaceful', 'peaceful', seen),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const join = JSON.parse(FakeSocket.instances[0]!.sent[0] ?? '{}') as { sessionToken?: string };
    expect(join.sessionToken).toBe('peaceful-token');
    expect(seen).toEqual([statusUrlForServer('peaceful', '')]);
    FakeSocket.instances[0]!.welcome('peaceful', 'peaceful-token');
    await pending;
    client.disconnect();
  });

  it('rejects a status mode that is not the selected server before sending a token', async () => {
    installSocket();
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'survival', worldId: 'survival' }, 'survival-token');
    const client = new AnarchyClient();
    await expect(client.connect('ws://127.0.0.1:2568', 'Ada', undefined, {
      targetServer: 'survival',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' }),
    })).rejects.toMatchObject({ code: 'mode_mismatch' });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(durable.data[GUEST_STORAGE_KEY]).toContain('survival-token');
    client.disconnect();
  });

  it('does not create a player when the same mode reports a different world', async () => {
    installSocket();
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'world-a' }, 'token-a');
    const client = new AnarchyClient();
    await expect(client.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'world-b' }),
    })).rejects.toMatchObject({ code: 'world_changed' });
    expect(FakeSocket.instances).toHaveLength(0);
    const raw = durable.data[GUEST_STORAGE_KEY] ?? '';
    expect(raw).toContain('token-a');
    expect(raw).not.toContain('world-b');
    client.disconnect();
  });

  it('does not open a socket for a connection that was replaced during status', async () => {
    installSocket();
    let release: (value: { ok: boolean; ready: boolean; mode: string; world: string }) => void = () => {};
    const gate = new Promise<{ ok: boolean; ready: boolean; mode: string; world: string }>((resolve) => {
      release = resolve;
    });
    const client = new AnarchyClient();
    const first = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable: memoryStore(),
      legacy: memoryStore(),
      fetchStatus: () => gate,
    });
    const second = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable: memoryStore(),
      legacy: memoryStore(),
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' }),
    });
    release({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' });
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0]!;
    expect(JSON.parse(socket.sent[0] ?? '{}')).not.toHaveProperty('sessionToken');
    socket.welcome('anarchy', 'fresh-token', '22222222-2222-4222-8222-222222222222');
    await expect(second).resolves.toMatchObject({ playerId: '22222222-2222-4222-8222-222222222222' });
    client.disconnect();
  });

  it('does not open a socket when disconnect happens before status returns', async () => {
    installSocket();
    let release: (value: { ok: boolean; ready: boolean; mode: string; world: string }) => void = () => {};
    const gate = new Promise<{ ok: boolean; ready: boolean; mode: string; world: string }>((resolve) => {
      release = resolve;
    });
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable: memoryStore(),
      legacy: memoryStore(),
      fetchStatus: () => gate,
    });
    client.disconnect();
    release({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('does not store a welcome whose world does not match the checked status', async () => {
    installSocket();
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'world-a' }, 'token-a');
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'world-a' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    FakeSocket.instances[0]!.welcome('world-b', 'token-a');
    await expect(pending).rejects.toMatchObject({ code: 'world_mismatch' });
    expect(durable.data[GUEST_STORAGE_KEY]).toContain('world-a');
    expect(durable.data[GUEST_STORAGE_KEY]).not.toContain('world-b');
    client.disconnect();
  });

  it('does not send a saved token when the socket is not the canonical endpoint', async () => {
    installSocket();
    const durable = memoryStore();
    writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, 'secret-token');
    const client = new AnarchyClient();
    const pending = client.connect('ws://attacker.test:9', 'Ada', undefined, {
      targetServer: 'anarchy',
      search: '',
      hostname: '127.0.0.1',
      durable,
      legacy: memoryStore(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = FakeSocket.instances[0];
    expect(socket?.url).toBe('ws://attacker.test:9');
    const join = JSON.parse(socket?.sent[0] ?? '{}') as { sessionToken?: string };
    expect(join.sessionToken).toBeUndefined();
    expect(JSON.stringify(join)).not.toContain('secret-token');
    socket?.close();
    await expect(pending).rejects.toThrow();
    client.disconnect();
  });

  it('lets a second tab reuse the token the first tab saved under a lock', async () => {
    const durable = memoryStore();
    let queue = Promise.resolve();
    const lock = <T>(_scope: unknown, body: () => Promise<T>): Promise<T> => {
      const run = queue.then(body, body);
      queue = run.then(() => undefined, () => undefined);
      return run;
    };
    let registrations = 0;
    async function register(playerId: string): Promise<void> {
      await withGuestScopeLock({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, async () => {
        const read = readStored(durable);
        if (read) return;
        registrations += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        writeGuestCredential(durable, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, `token-${playerId}`);
      }, { request: (_name, callback) => lock(undefined, callback) });
    }
    await Promise.all([register('one'), register('two')]);
    expect(registrations).toBe(1);
    const raw = JSON.parse(durable.data[GUEST_STORAGE_KEY] ?? '{}') as { records: Record<string, { sessionToken: string }> };
    expect(Object.keys(raw.records)).toEqual(['local|anarchy|anarchy']);
  });
});

function readStored(store: GuestStorage & { data: Record<string, string> }): string | undefined {
  const raw = store.data[GUEST_STORAGE_KEY];
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { records?: Record<string, { sessionToken?: string }> };
  return parsed.records?.['local|anarchy|anarchy']?.sessionToken;
}
