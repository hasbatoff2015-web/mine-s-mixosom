import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnarchyClient, statusUrlForServer } from '../src/net/AnarchyClient';
import { GUEST_STORAGE_KEY, guestScopeKey, guestScopeStorageKey, withGuestScopeLock, writeGuestCredential, type GuestScopeLock, type GuestStorage } from '../src/net/guestIdentityStorage';
import { PROTOCOL_VERSION } from '../shared/config';

function memoryStore(initial: Record<string, string> = {}): GuestStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null; },
    setItem(key, value) { data[key] = value; },
    removeItem(key) { delete data[key]; },
    keys() { return Object.keys(data); },
  };
}

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  static holdOpen = false;
  readonly sent: string[] = [];
  readyState = 1;
  url: string;
  private listeners = new Map<string, Array<(event?: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeSocket.holdOpen ? FakeSocket.CONNECTING : FakeSocket.OPEN;
    FakeSocket.instances.push(this);
    if (!FakeSocket.holdOpen) queueMicrotask(() => this.emit('open'));
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
    if (type === 'open') this.readyState = FakeSocket.OPEN;
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
  FakeSocket.holdOpen = false;
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
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })]).toContain('anarchy-token');
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'survival', worldId: 'survival' })]).toContain('survival-token');
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
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'survival', worldId: 'survival' })]).toContain('survival-token');
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
    const raw = durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'world-a' })] ?? '';
    expect(raw).toContain('token-a');
    expect(JSON.stringify(durable.data)).not.toContain('world-b');
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
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'world-a' })]).toContain('token-a');
    expect(JSON.stringify(durable.data)).not.toContain('world-b');
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
      }, { request: (_name, _options, callback) => lock(undefined, callback) });
    }
    await Promise.all([register('one'), register('two')]);
    expect(registrations).toBe(1);
    expect(readStored(durable)).toBe('token-one');
    expect(durable.data[GUEST_STORAGE_KEY]).toBeUndefined();
  });
});

function readStored(store: GuestStorage & { data: Record<string, string> }): string | undefined {
  const raw = store.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })];
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { sessionToken?: string };
  return parsed.sessionToken;
}

class ScopeLocks implements GuestScopeLock {
  private tails = new Map<string, Promise<void>>();

  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let opened = false;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = () => {
        if (opened) return;
        opened = true;
        resolve();
      };
    });
    this.tails.set(name, previous.then(() => gate, () => gate));
    return new Promise((resolve, reject) => {
      let started = false;
      const cancel = (): void => {
        if (started) return;
        releaseGate();
        reject(Object.assign(new Error('Подключение отменено'), { code: 'cancelled' }));
      };
      if (options.signal?.aborted) {
        cancel();
        return;
      }
      options.signal?.addEventListener('abort', cancel, { once: true });
      previous.then(() => {
        if (options.signal?.aborted) return;
        started = true;
        options.signal?.removeEventListener('abort', cancel);
        return callback().then(resolve, reject);
      }).catch(reject).finally(() => releaseGate());
    });
  }
}

function clientOptions(
  durable: GuestStorage,
  fetchStatus: GuestConnectOptionsFetch,
  extra: Record<string, unknown> = {},
) {
  return {
    targetServer: 'anarchy' as const,
    search: '',
    hostname: '127.0.0.1',
    durable,
    legacy: memoryStore(),
    fetchStatus,
    ...extra,
  };
}

type GuestConnectOptionsFetch = (url: string, signal: AbortSignal) => Promise<{ ok: boolean; ready?: boolean; mode?: string; world?: string }>;

describe('connection attempt lifecycle', () => {
  it('A cancels during status before a socket exists', async () => {
    installSocket();
    const durable = memoryStore();
    const before = JSON.stringify(durable.data);
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, () => new Promise(() => undefined)));
    client.disconnect();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(JSON.stringify(durable.data)).toBe(before);
    expect(client.lastError).toBeUndefined();
  });

  it('B cancels while the socket is still connecting', async () => {
    installSocket();
    FakeSocket.holdOpen = true;
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0]!;
    client.disconnect();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(socket.sent).toHaveLength(0);
    expect(readStored(durable)).toBeUndefined();
  });

  it('C cancels after open and ignores a late welcome', async () => {
    installSocket();
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = FakeSocket.instances[0]!;
    expect(socket.sent).toHaveLength(1);
    client.disconnect();
    socket.welcome('anarchy', 'late-token', '22222222-2222-4222-8222-222222222222');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(readStored(durable)).toBeUndefined();
    expect(client.lastWelcome).toBeUndefined();
  });

  it('D lets a replacement connection ignore the previous socket', async () => {
    installSocket();
    FakeSocket.holdOpen = true;
    const durable = memoryStore();
    const client = new AnarchyClient();
    const first = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stale = FakeSocket.instances[0]!;
    FakeSocket.holdOpen = false;
    const second = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const live = FakeSocket.instances[1]!;
    live.welcome('anarchy', 'token-b', '33333333-3333-4333-8333-333333333333');
    stale.welcome('anarchy', 'token-a', '22222222-2222-4222-8222-222222222222');
    stale.emit('error');
    stale.close();
    const welcome = await second;
    expect(welcome.playerId).toBe('33333333-3333-4333-8333-333333333333');
    expect(welcome.sessionToken).toBe('token-b');
    expect(readStored(durable)).toBe('token-b');
    expect(client.state).toBe('connected');
    client.disconnect();
    expect(readStored(durable)).toBe('token-b');
  });

  it('E settles once when timeout and cancel overlap', async () => {
    installSocket();
    FakeSocket.holdOpen = true;
    vi.useFakeTimers();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(memoryStore(), statusFetch('anarchy', 'anarchy', [])));
    const settled = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.instances[0]!;
    await vi.advanceTimersByTimeAsync(5000);
    client.disconnect();
    await settled;
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(client.state === 'error' || client.state === 'disconnected').toBe(true);
    vi.useRealTimers();
  });

  it('F keeps a resolved connect resolved after a normal disconnect', async () => {
    installSocket();
    const durable = memoryStore();
    const client = new AnarchyClient();
    let disconnected = 0;
    client.onDisconnect(() => { disconnected += 1; });
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    FakeSocket.instances[0]!.welcome('anarchy', 'kept-token');
    const welcome = await pending;
    client.disconnect();
    await expect(Promise.resolve(welcome)).resolves.toMatchObject({ sessionToken: 'kept-token' });
    expect(readStored(durable)).toBe('kept-token');
    expect(disconnected).toBe(0);
    expect(client.state).toBe('disconnected');
  });

  it('G times out a hanging status request', async () => {
    installSocket();
    vi.useFakeTimers();
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, () => new Promise(() => undefined)));
    const settled = expect(pending).rejects.toMatchObject({ code: 'status_timeout' });
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    expect(FakeSocket.instances).toHaveLength(0);
    expect(readStored(durable)).toBeUndefined();
    vi.useRealTimers();
  });

  it('H still times out when fetch ignores abort', async () => {
    installSocket();
    vi.useFakeTimers();
    let finish: ((value: { ok: boolean; ready: boolean; mode: string; world: string }) => void) | undefined;
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, () => new Promise((resolve) => { finish = resolve; })));
    const settled = expect(pending).rejects.toMatchObject({ code: 'status_timeout' });
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    finish?.({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' });
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(readStored(durable)).toBeUndefined();
    vi.useRealTimers();
  });

  it('I reports cancel rather than status timeout', async () => {
    installSocket();
    vi.useFakeTimers();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(memoryStore(), () => new Promise(() => undefined)));
    client.disconnect();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeSocket.instances).toHaveLength(0);
    vi.useRealTimers();
  });

  it('J completes a fast status preflight', async () => {
    installSocket();
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    FakeSocket.instances[0]!.welcome('anarchy', 'fast-token');
    await expect(pending).resolves.toMatchObject({ sessionToken: 'fast-token' });
    expect(readStored(durable)).toBe('fast-token');
    client.disconnect();
  });

  it('K does not create a guest when status mode does not match', async () => {
    installSocket();
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('survival', 'survival', [])));
    await expect(pending).rejects.toMatchObject({ code: 'mode_mismatch' });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(Object.keys(durable.data)).toHaveLength(0);
  });
});

describe('two AnarchyClient registrations', () => {
  it('X coordinates two fresh clients onto one uuid', async () => {
    installSocket();
    const durable = memoryStore();
    const locks = new ScopeLocks();
    const scopeLock = (scope: { deployment: string; mode: string; worldId: string }, signal: AbortSignal, body: () => Promise<void>) => withGuestScopeLock(scope, body, locks, signal);
    const first = new AnarchyClient();
    const second = new AnarchyClient();
    const options = clientOptions(durable, statusFetch('anarchy', 'anarchy', []), { scopeLock });
    const pendingA = first.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    const pendingB = second.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(1);
    const joinA = JSON.parse(FakeSocket.instances[0]!.sent[0] ?? '{}') as { freshGuest?: boolean; sessionToken?: string };
    expect(joinA.sessionToken).toBeUndefined();
    FakeSocket.instances[0]!.welcome('anarchy', 'token-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(2);
    const joinB = JSON.parse(FakeSocket.instances[1]!.sent[0] ?? '{}') as { freshGuest?: boolean; sessionToken?: string };
    expect(joinB.sessionToken).toBe('token-a');
    expect(joinB.freshGuest).toBeFalsy();
    FakeSocket.instances[1]!.welcome('anarchy', 'token-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const [welcomeA, welcomeB] = await Promise.all([pendingA, pendingB]);
    expect(welcomeA.playerId).toBe(welcomeB.playerId);
    expect(readStored(durable)).toBe('token-a');
    first.disconnect();
    second.disconnect();
  });

  it('Y cancels a client waiting for the registration lock', async () => {
    installSocket();
    const durable = memoryStore();
    const locks = new ScopeLocks();
    const scopeLock = (scope: { deployment: string; mode: string; worldId: string }, signal: AbortSignal, body: () => Promise<void>) => withGuestScopeLock(scope, body, locks, signal);
    const options = clientOptions(durable, statusFetch('anarchy', 'anarchy', []), { scopeLock });
    const holder = new AnarchyClient();
    const waiter = new AnarchyClient();
    const pendingHold = holder.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    const pendingWait = waiter.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(1);
    waiter.disconnect();
    await expect(pendingWait).rejects.toMatchObject({ code: 'cancelled' });
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0]!.welcome('anarchy', 'token-hold');
    await expect(pendingHold).resolves.toMatchObject({ sessionToken: 'token-hold' });
    holder.disconnect();
  });

  it('Z releases the lock when the holder is cancelled', async () => {
    installSocket();
    const durable = memoryStore();
    const locks = new ScopeLocks();
    const scopeLock = (scope: { deployment: string; mode: string; worldId: string }, signal: AbortSignal, body: () => Promise<void>) => withGuestScopeLock(scope, body, locks, signal);
    const options = clientOptions(durable, statusFetch('anarchy', 'anarchy', []), { scopeLock });
    const holder = new AnarchyClient();
    const next = new AnarchyClient();
    const pendingHold = holder.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    const pendingNext = next.connect('ws://127.0.0.1:2567', 'Ada', undefined, options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stale = FakeSocket.instances[0]!;
    holder.disconnect();
    await expect(pendingHold).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2);
    const live = FakeSocket.instances[FakeSocket.instances.length - 1]!;
    live.welcome('anarchy', 'token-next', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    stale.welcome('anarchy', 'token-stale', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    await expect(pendingNext).resolves.toMatchObject({ playerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(readStored(durable)).toBe('token-next');
    next.disconnect();
  });

  it('AA resumes or rejects when storage changes while waiting', async () => {
    installSocket();
    const cases: Array<{ name: string; mutate: (store: ReturnType<typeof memoryStore>) => void; code?: string; token?: string }> = [
      {
        name: 'token',
        mutate: (store) => writeGuestCredential(store, { deployment: 'local', mode: 'anarchy', worldId: 'anarchy' }, 'planted-token'),
        token: 'planted-token',
      },
      {
        name: 'corrupt',
        mutate: (store) => { store.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })] = '{'; },
        code: 'storage_corrupt',
      },
      {
        name: 'unsupported',
        mutate: (store) => {
          store.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })] = JSON.stringify({ version: 9, sessionToken: 'x' });
        },
        code: 'storage_unsupported',
      },
      {
        name: 'unavailable',
        mutate: (store) => { store.getItem = () => { throw new Error('blocked'); }; },
        code: 'storage_unavailable',
      },
    ];
    for (const item of cases) {
      FakeSocket.instances = [];
      const durable = memoryStore();
      const locks = new ScopeLocks();
      let release!: () => void;
      const held = locks.request(`fc-guest:${guestScopeKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })}`, {}, () => new Promise<void>((resolve) => { release = resolve; }));
      const client = new AnarchyClient();
      const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', []), {
        scopeLock: (scope: { deployment: string; mode: string; worldId: string }, signal: AbortSignal, body: () => Promise<void>) => withGuestScopeLock(scope, body, locks, signal),
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      item.mutate(durable);
      release();
      await held;
      if (item.token) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const socket = FakeSocket.instances[0]!;
        const join = JSON.parse(socket.sent[0] ?? '{}') as { sessionToken?: string; freshGuest?: boolean };
        expect(join.sessionToken, item.name).toBe(item.token);
        expect(join.freshGuest, item.name).toBeFalsy();
        socket.welcome('anarchy', item.token);
        await expect(pending).resolves.toMatchObject({ sessionToken: item.token });
      } else {
        await expect(pending, item.name).rejects.toMatchObject({ code: item.code });
        expect(FakeSocket.instances, item.name).toHaveLength(0);
      }
      client.disconnect();
    }
  });

  it('AB keeps Anarchy and Survival credentials independent', async () => {
    installSocket();
    const durable = memoryStore();
    const locks = new ScopeLocks();
    const scopeLock = (scope: { deployment: string; mode: string; worldId: string }, signal: AbortSignal, body: () => Promise<void>) => withGuestScopeLock(scope, body, locks, signal);
    const anarchy = new AnarchyClient();
    const survival = new AnarchyClient();
    const pendingA = anarchy.connect('ws://127.0.0.1:2567', 'Ada', undefined, {
      ...clientOptions(durable, statusFetch('anarchy', 'anarchy', []), { scopeLock }),
      targetServer: 'anarchy',
    });
    const pendingS = survival.connect('ws://127.0.0.1:2568', 'Ada', undefined, {
      ...clientOptions(durable, statusFetch('survival', 'survival', []), { scopeLock }),
      targetServer: 'survival',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeSocket.instances).toHaveLength(2);
    const anarchySocket = FakeSocket.instances.find((socket) => socket.url.includes('2567'))!;
    const survivalSocket = FakeSocket.instances.find((socket) => socket.url.includes('2568'))!;
    anarchySocket.welcome('anarchy', 'token-anarchy', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    survivalSocket.welcome('survival', 'token-survival', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await Promise.all([pendingA, pendingS]);
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'anarchy', worldId: 'anarchy' })]).toContain('token-anarchy');
    expect(durable.data[guestScopeStorageKey({ deployment: 'local', mode: 'survival', worldId: 'survival' })]).toContain('token-survival');
    const survivalJoin = JSON.parse(survivalSocket.sent[0] ?? '{}') as { sessionToken?: string };
    expect(survivalJoin.sessionToken).toBeUndefined();
    expect(JSON.stringify(survivalSocket.sent)).not.toContain('token-anarchy');
    anarchy.disconnect();
    survival.disconnect();
  });

  it('AC still joins when the browser has no Web Locks', async () => {
    installSocket();
    const durable = memoryStore();
    const client = new AnarchyClient();
    const pending = client.connect('ws://127.0.0.1:2567', 'Ada', undefined, clientOptions(durable, statusFetch('anarchy', 'anarchy', [])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    FakeSocket.instances[0]!.welcome('anarchy', 'solo-token');
    await expect(pending).resolves.toMatchObject({ sessionToken: 'solo-token' });
    expect(readStored(durable)).toBe('solo-token');
    client.disconnect();
  });
});
