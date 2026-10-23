/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameUI } from '../src/ui/GameUI';
import {
  ONLINE_CONNECT_ERROR,
  ONLINE_STARTING_LABEL,
  ONLINE_STATUS_ERROR,
  ONLINE_UNAVAILABLE_LABEL,
  ONLINE_UNCONFIGURED_LABEL,
} from '../src/ui/menuModel';
import {
  AnarchyClient,
  ServerStatusSession,
  checkingServerStatuses,
  fetchLocalServerStatuses,
  fetchStatusAt,
  runOnlineConnectAttempt,
  type ServerStatusMap,
} from '../src/net/AnarchyClient';
import type { WorldSummary } from '../src/save/types';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function ok(online: number, maxPlayers = 300, ready = true) {
  return { ok: true, json: async () => ({ ready, online, maxPlayers }) };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  return { root, ui };
}

function actions(retry = () => undefined) {
  return {
    back: () => undefined,
    connect: () => undefined,
    retry,
    saveNickname: (raw: string) => ({ ok: true as const, name: raw }),
  };
}

function label(root: HTMLElement, id: string): string {
  return root.querySelector(`[data-server-id="${id}"] .server-online`)?.textContent ?? '';
}

describe('status probe results', () => {
  it('accepts a ready server with zero players', async () => {
    vi.stubGlobal('fetch', async () => ok(0));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'available',
      online: 0,
      maxPlayers: 300,
    });
  });

  it('accepts a ready server with a positive player count', async () => {
    vi.stubGlobal('fetch', async () => ok(25));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toMatchObject({
      phase: 'available',
      online: 25,
      maxPlayers: 300,
    });
  });

  it.each([
    ['empty object', {}],
    ['ready only', { ready: true }],
    ['missing maxPlayers', { ready: true, online: 0 }],
    ['missing online', { ready: true, maxPlayers: 300 }],
    ['null body', null],
    ['string online', { ready: true, online: '3', maxPlayers: 300 }],
    ['string maxPlayers', { ready: true, online: 1, maxPlayers: '300' }],
    ['negative online', { ready: true, online: -1, maxPlayers: 300 }],
    ['NaN online', { ready: true, online: Number.NaN, maxPlayers: 300 }],
    ['fractional online', { ready: true, online: 1.5, maxPlayers: 300 }],
    ['infinite online', { ready: true, online: Number.POSITIVE_INFINITY, maxPlayers: 300 }],
    ['zero maxPlayers', { ready: true, online: 0, maxPlayers: 0 }],
    ['online above maxPlayers', { ready: true, online: 301, maxPlayers: 300 }],
    ['missing ready', { online: 1, maxPlayers: 300 }],
    ['string ready', { ready: 'true', online: 1, maxPlayers: 300 }],
  ] as const)('rejects %s as an invalid status', async (_name, body) => {
    vi.stubGlobal('fetch', async () => jsonResponse(body));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('keeps a world that is still starting out of the available state', async () => {
    vi.stubGlobal('fetch', async () => ok(0, 300, false));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'unavailable',
      reason: 'not_ready',
    });
  });

  it('keeps an HTTP 500 from looking like an empty server', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({ online: 9, maxPlayers: 300 }) }));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'unavailable',
      reason: 'http',
    });
  });

  it('classifies a rejected fetch as a network failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'unavailable',
      reason: 'network',
    });
  });

  it('leaves checking when the status request times out', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      });
    }));
    const started = Date.now();
    await expect(fetchStatusAt('https://example.test/status', undefined, 30)).resolves.toEqual({
      phase: 'unavailable',
      reason: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not crash on invalid JSON', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    }));
    await expect(fetchStatusAt('https://example.test/status')).resolves.toEqual({
      phase: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('keeps the other cards when one server fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes(':2568/')) throw new TypeError('down');
      const online = String(url).includes(':2569/') ? 4 : 2;
      return ok(online);
    });
    const statuses = await fetchLocalServerStatuses('');
    expect(statuses.anarchy).toEqual({ phase: 'available', online: 2, maxPlayers: 300 });
    expect(statuses.survival).toEqual({ phase: 'unavailable', reason: 'network' });
    expect(statuses.peaceful).toEqual({ phase: 'available', online: 4, maxPlayers: 300 });
  });

  it('does not report a caller abort as a player-facing failure', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', (_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));
    const pending = fetchStatusAt('https://example.test/status', controller.signal, 5000);
    controller.abort();
    await expect(pending).resolves.toEqual({ phase: 'aborted' });
  });
});

describe('online server screen', () => {
  function wire(ui: GameUI, session = new ServerStatusSession()) {
    const pull = async (): Promise<ServerStatusMap | undefined> => {
      const statuses = await session.load('', 1500);
      if (!statuses || !ui.isShowingOnlineServers()) return undefined;
      ui.applyOnlineServerStatuses(statuses);
      return statuses;
    };
    ui.showOnlineServers({
      ...actions(() => {
        if (ui.isOnlineStatusPending()) return;
        ui.applyOnlineServerStatuses(checkingServerStatuses());
        void pull();
      }),
    }, checkingServerStatuses(), 'anarchy', 'Steve');
    return { session, pull };
  }

  it('moves a card from checking to the reported player count', async () => {
    vi.stubGlobal('fetch', async () => ok(3, 20));
    const { root, ui } = mount();
    const { pull } = wire(ui);
    expect(label(root, 'anarchy')).toBe('Проверка…');
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(true);
    await pull();
    expect(label(root, 'anarchy')).toBe('3 / 20');
    expect(root.querySelector('[data-server-id="anarchy"]')?.getAttribute('data-server-phase')).toBe('available');
    expect(root.querySelector('[data-server-note]')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
  });

  it('leaves the responding cards available when only one server fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes(':2568/')) throw new TypeError('down');
      return ok(String(url).includes(':2569/') ? 4 : 2);
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    expect(label(root, 'anarchy')).toBe('2 / 300');
    expect(label(root, 'survival')).toBe(ONLINE_UNAVAILABLE_LABEL);
    expect(label(root, 'peaceful')).toBe('4 / 300');
    expect(root.querySelector('[data-server-id="anarchy"]')?.getAttribute('data-server-phase')).toBe('available');
    expect(root.querySelector('[data-server-id="peaceful"]')?.getAttribute('data-server-phase')).toBe('available');
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-server-id="peaceful"]')?.click();
    expect(root.querySelector('[data-server-id="peaceful"]')?.classList.contains('selected')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
  });

  it('shows a visible explanation and an enabled retry button after a network failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    expect(label(root, 'survival')).toBe(ONLINE_UNAVAILABLE_LABEL);
    expect(root.textContent).toContain(ONLINE_STATUS_ERROR);
    expect(root.textContent).not.toContain('оффлайн');
    expect(root.textContent).not.toContain('CORS');
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
    expect(root.querySelector('[data-server-note]')?.hasAttribute('hidden')).toBe(false);
  });

  it('returns to checking and then to available when retry succeeds', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', async () => {
      attempt += 1;
      if (attempt <= 3) throw new TypeError('offline');
      return ok(6);
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    expect(label(root, 'anarchy')).toBe(ONLINE_UNAVAILABLE_LABEL);
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    expect(label(root, 'anarchy')).toBe('Проверка…');
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(true);
    await vi.waitFor(() => {
      expect(label(root, 'anarchy')).toBe('6 / 300');
    });
    expect(root.querySelector('[data-server-note]')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
  });

  it('keeps the error and re-enables retry when the next attempt also fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('still down');
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
    });
    expect(label(root, 'peaceful')).toBe(ONLINE_UNAVAILABLE_LABEL);
    expect(root.textContent).toContain(ONLINE_STATUS_ERROR);
  });

  it('ignores a second retry click while a check is already running', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return new Promise(() => undefined);
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    void pull();
    await vi.waitFor(() => expect(calls).toBe(3));
    const retry = root.querySelector<HTMLButtonElement>('[data-action="retry"]');
    retry?.click();
    retry?.click();
    await Promise.resolve();
    expect(calls).toBe(3);
    expect(retry?.disabled).toBe(true);
  });

  it('does not let an older response replace a newer one', async () => {
    const pending: Array<(value: unknown) => void> = [];
    vi.stubGlobal('fetch', () => new Promise((resolve) => {
      pending.push(resolve);
    }));
    const session = new ServerStatusSession();
    const first = session.load('');
    expect(pending).toHaveLength(3);
    const second = session.load('');
    expect(pending).toHaveLength(6);
    for (const resolve of pending.splice(0, 3)) resolve(ok(1));
    for (const resolve of pending) resolve(ok(8));
    await expect(first).resolves.toBeUndefined();
    const latest = await second;
    expect(latest?.anarchy).toEqual({ phase: 'available', online: 8, maxPlayers: 300 });
    expect(latest?.survival).toEqual({ phase: 'available', online: 8, maxPlayers: 300 });
  });

  it('does not reopen the server list after the player has left', async () => {
    const pendingFetches: Array<(value: unknown) => void> = [];
    vi.stubGlobal('fetch', () => new Promise((resolve) => {
      pendingFetches.push(resolve);
    }));
    const { root, ui } = mount();
    const session = new ServerStatusSession();
    ui.showOnlineServers(actions(), checkingServerStatuses(), 'anarchy', 'Steve');
    const pending = session.load('').then((statuses) => {
      if (!statuses || !ui.isShowingOnlineServers()) return statuses;
      ui.applyOnlineServerStatuses(statuses);
      return statuses;
    });
    await vi.waitFor(() => expect(pendingFetches.length).toBe(3));
    session.cancel();
    let loaded = false;
    ui.showWorldList([{
      id: 'home',
      name: 'Дом',
      seed: '1',
      mode: 'survival',
      createdAt: 1,
      updatedAt: 1,
      playTimeSeconds: 10,
    }], {
      load: () => { loaded = true; },
      create: () => undefined,
      delete: () => undefined,
      back: () => undefined,
    });
    for (const resolve of pendingFetches) resolve(ok(4));
    await pending;
    expect(root.querySelector('.server-list')).toBeNull();
    expect(root.textContent).toContain('Одиночная игра');
    expect(root.textContent).toContain('Дом');
    root.querySelector<HTMLButtonElement>('[data-action="play-world"]')?.click();
    expect(loaded).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-action="create"]')?.click();
  });

  it('keeps the typed nickname and the selected card across a status refresh', async () => {
    vi.stubGlobal('fetch', async () => ok(1));
    const { root, ui } = mount();
    const { pull } = wire(ui);
    const input = root.querySelector<HTMLInputElement>('#online-nickname');
    input!.value = 'Alex';
    input!.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('[data-server-id="peaceful"]')?.click();
    await pull();
    expect(input!.value).toBe('Alex');
    expect(root.querySelector('[data-server-id="peaceful"]')?.classList.contains('selected')).toBe(true);
    expect(root.querySelector('[data-server-id="anarchy"]')?.classList.contains('selected')).toBe(false);
    expect(ui.onlineNicknameDraft()).toBe('Alex');
    expect(ui.onlineServerSelection()).toBe('peaceful');
  });

  it('disables connect for a card without a public endpoint and leaves the others usable', async () => {
    vi.stubEnv('VITE_ANARCHY_URL', 'wss://megacraft.agariobrainrot.ru');
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('megacraft')) return ok(2);
      throw new TypeError('unexpected');
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    expect(label(root, 'anarchy')).toBe('2 / 300');
    expect(label(root, 'survival')).toBe(ONLINE_UNCONFIGURED_LABEL);
    expect(label(root, 'peaceful')).toBe(ONLINE_UNCONFIGURED_LABEL);
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-server-id="survival"]')?.click();
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(true);
    let connected = 0;
    ui.showOnlineServers({
      ...actions(),
      connect: () => { connected += 1; },
    }, {
      anarchy: { phase: 'available', online: 2, maxPlayers: 300 },
      survival: { phase: 'not_configured' },
      peaceful: { phase: 'not_configured' },
    }, 'survival');
    root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-server-id="survival"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(connected).toBe(0);
    root.querySelector<HTMLButtonElement>('[data-server-id="anarchy"]')?.click();
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
  });

  it('keeps the focused server button when statuses arrive', () => {
    const { root, ui } = mount();
    wire(ui);
    const anarchy = root.querySelector<HTMLButtonElement>('[data-server-id="anarchy"]');
    expect(anarchy).toBeTruthy();
    anarchy!.focus();
    ui.applyOnlineServerStatuses({
      anarchy: { phase: 'available', online: 5, maxPlayers: 300 },
      survival: { phase: 'unavailable', reason: 'network' },
      peaceful: { phase: 'not_configured' },
    });
    expect(root.querySelector('[data-server-id="anarchy"]')).toBe(anarchy);
    expect(document.activeElement).toBe(anarchy);
    expect(anarchy!.querySelector('.server-online')?.textContent).toBe('5 / 300');
    expect(anarchy!.getAttribute('data-server-phase')).toBe('available');

    const survival = root.querySelector<HTMLButtonElement>('[data-server-id="survival"]');
    survival!.focus();
    ui.applyOnlineServerStatuses(checkingServerStatuses());
    expect(document.activeElement).toBe(survival);
    expect(survival!.querySelector('.server-online')?.textContent).toBe('Проверка…');
    ui.applyOnlineServerStatuses({
      anarchy: { phase: 'unavailable', reason: 'not_ready' },
      survival: { phase: 'available', online: 2, maxPlayers: 300 },
      peaceful: { phase: 'checking' },
    });
    expect(root.querySelector('[data-server-id="survival"]')).toBe(survival);
    expect(document.activeElement).toBe(survival);
    expect(label(root, 'survival')).toBe('2 / 300');
    expect(label(root, 'anarchy')).toBe(ONLINE_STARTING_LABEL);
    expect(root.querySelector('[data-server-id="anarchy"]')?.classList.contains('is-starting')).toBe(true);
  });

  it('keeps the nickname, selection, and a single dblclick listener across updates', () => {
    const { root, ui } = mount();
    let connects = 0;
    ui.showOnlineServers({
      ...actions(),
      connect: () => { connects += 1; },
    }, checkingServerStatuses(), 'anarchy', 'Steve');
    const input = root.querySelector<HTMLInputElement>('#online-nickname');
    input!.value = 'Alex';
    root.querySelector<HTMLButtonElement>('[data-server-id="survival"]')?.click();
    const survival = root.querySelector<HTMLButtonElement>('[data-server-id="survival"]');
    ui.applyOnlineServerStatuses({
      anarchy: { phase: 'available', online: 1, maxPlayers: 300 },
      survival: { phase: 'unavailable', reason: 'timeout' },
      peaceful: { phase: 'available', online: 0, maxPlayers: 300 },
    });
    ui.applyOnlineServerStatuses({
      anarchy: { phase: 'available', online: 4, maxPlayers: 300 },
      survival: { phase: 'available', online: 8, maxPlayers: 300 },
      peaceful: { phase: 'not_configured' },
    });
    expect(input!.value).toBe('Alex');
    expect(root.querySelector('[data-server-id="survival"]')).toBe(survival);
    expect(survival!.classList.contains('selected')).toBe(true);
    expect(label(root, 'survival')).toBe('8 / 300');
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(false);
    survival!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(connects).toBe(1);
  });

  it('shows a starting server as not ready and still allows another check', () => {
    const { root, ui } = mount();
    let retries = 0;
    ui.showOnlineServers({
      ...actions(() => { retries += 1; }),
    }, {
      anarchy: { phase: 'unavailable', reason: 'not_ready' },
      survival: { phase: 'not_configured' },
      peaceful: { phase: 'not_configured' },
    }, 'anarchy');
    expect(label(root, 'anarchy')).toBe(ONLINE_STARTING_LABEL);
    expect(root.textContent).not.toContain(ONLINE_STATUS_ERROR);
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    expect(retries).toBe(1);
  });
});

describe('online connect failure', () => {
  it('replaces the loading screen with a retry and a way back, then tries again', async () => {
    const { root, ui } = mount();
    let attempts = 0;
    const world: WorldSummary = {
      id: 'home',
      name: 'Дом',
      seed: '1',
      mode: 'survival',
      createdAt: 1,
      updatedAt: 1,
      playTimeSeconds: 0,
    };
    await runOnlineConnectAttempt({
      url: 'wss://megacraft.agariobrainrot.ru',
      onLoading: () => ui.showLoading('Подключение к серверу…', 12, 'megacraft.agariobrainrot.ru'),
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('closed');
        ui.showWorldList([world], {
          load: () => undefined,
          create: () => undefined,
          delete: () => undefined,
          back: () => undefined,
        });
      },
      onFailure: (retry) => {
        ui.showOnlineConnectError({
          retry: () => { void retry(); },
          back: () => ui.showWorldList([world], {
            load: () => undefined,
            create: () => undefined,
            delete: () => undefined,
            back: () => undefined,
          }),
        });
      },
    });
    expect(root.querySelector('#loading-screen')).toBeNull();
    expect(root.textContent).toContain(ONLINE_CONNECT_ERROR);
    expect(root.querySelector('.server-connect-error-window')).toBeTruthy();
    expect(root.querySelector('.server-refresh-button')).toBeNull();
    expect(root.textContent).not.toContain('Обновить');
    expect(root.textContent).toContain('Повторить');
    expect(root.textContent).toContain('К списку серверов');
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.click();
    await vi.waitFor(() => expect(attempts).toBe(2));
    expect(root.textContent).toContain('Одиночная игра');
    expect(root.textContent).not.toContain(ONLINE_CONNECT_ERROR);
  });

  it('opens a new socket for a repeated connection attempt', async () => {
    const urls: string[] = [];
    class Socket extends EventTarget {
      constructor(url: string) {
        super();
        urls.push(url);
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
      }

      close(): void {
        this.dispatchEvent(new Event('close'));
      }

      send(): void {
        return undefined;
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    const client = new AnarchyClient();
    await expect(client.connect('wss://one.example')).rejects.toThrow('Сервер недоступен');
    await expect(client.connect('wss://two.example')).rejects.toThrow('Сервер недоступен');
    expect(urls).toEqual(['wss://one.example', 'wss://two.example']);
  });
});

describe('online server menu layout', () => {
  function wire(ui: GameUI, connect: (id: string) => void = () => undefined, session = new ServerStatusSession()) {
    const pull = async (): Promise<ServerStatusMap | undefined> => {
      const statuses = await session.load('', 1500);
      if (!statuses || !ui.isShowingOnlineServers()) return undefined;
      ui.applyOnlineServerStatuses(statuses);
      return statuses;
    };
    ui.showOnlineServers({
      ...actions(() => {
        if (ui.isOnlineStatusPending()) return;
        ui.applyOnlineServerStatuses(checkingServerStatuses());
        void pull();
      }),
      connect,
    }, checkingServerStatuses(), 'anarchy', 'Steve');
    return { session, pull };
  }

  it('puts Обновить in a toolbar and leaves connect and back in the footer', () => {
    const { root, ui } = mount();
    let connected = '';
    let backs = 0;
    ui.showOnlineServers({
      ...actions(),
      connect: (id) => { connected = id; },
      back: () => { backs += 1; },
    }, {
      anarchy: { phase: 'available', online: 2, maxPlayers: 300 },
      survival: { phase: 'not_configured' },
      peaceful: { phase: 'not_configured' },
    }, 'anarchy', 'Steve');

    const panel = root.querySelector('.server-list-panel');
    const toolbar = root.querySelector('.server-list-toolbar');
    const list = root.querySelector('.server-list');
    const footer = root.querySelector('.server-menu-footer');
    const refresh = toolbar?.querySelector<HTMLButtonElement>('.server-refresh-button');
    expect(panel).toBeTruthy();
    expect(toolbar).toBeTruthy();
    expect(toolbar?.textContent).toContain('СЕРВЕРЫ');
    expect(refresh?.textContent?.trim()).toBe('Обновить');
    expect(refresh?.getAttribute('data-action')).toBe('retry');
    expect(refresh?.getAttribute('aria-label')).toBe('Обновить список серверов');
    expect(list?.contains(refresh ?? null)).toBe(false);
    expect(footer?.contains(refresh ?? null)).toBe(false);
    expect(panel?.contains(list ?? null)).toBe(true);
    expect([...root.querySelectorAll('.server-list [data-server-id]')].map((row) => row.getAttribute('data-server-id'))).toEqual([
      'anarchy',
      'survival',
      'peaceful',
    ]);
    expect(root.querySelectorAll('.server-list .server-icon-image')).toHaveLength(3);
    expect(root.textContent).toContain('Играть онлайн');
    expect(root.querySelector<HTMLInputElement>('#online-nickname')?.value).toBe('Steve');
    const footerButtons = [...footer!.querySelectorAll<HTMLButtonElement>('.game-button')];
    expect(footerButtons.map((button) => button.textContent?.trim())).toEqual(['Подключиться', 'Назад']);
    expect(footer?.textContent).not.toContain('Повторить');
    expect(root.querySelectorAll('[data-action="retry"]')).toHaveLength(1);

    footer?.querySelector<HTMLButtonElement>('[data-action="connect"]')?.click();
    expect(connected).toBe('anarchy');
    root.querySelector<HTMLButtonElement>('[data-server-id="survival"]')?.click();
    footer?.querySelector<HTMLButtonElement>('[data-action="connect"]')?.click();
    expect(connected).toBe('anarchy');
    expect(root.querySelector<HTMLButtonElement>('[data-action="connect"]')?.disabled).toBe(true);
    footer?.querySelector<HTMLButtonElement>('[data-action="back"]')?.click();
    expect(backs).toBe(1);
  });

  it('shows the shared status error above the two footer actions', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const { root, ui } = mount();
    const { pull } = wire(ui);
    await pull();
    const footer = root.querySelector('.server-menu-footer');
    const note = footer?.querySelector('[data-server-note]');
    expect(note?.textContent).toBe(ONLINE_STATUS_ERROR);
    expect(note?.hasAttribute('hidden')).toBe(false);
    expect(footer?.querySelector('[data-action="retry"]')).toBeNull();
    expect(root.querySelector('.server-refresh-button')?.hasAttribute('disabled')).toBe(false);
  });

  it('refreshes statuses from Обновить once, keeping the nickname, selection, and focus', async () => {
    let round = 0;
    vi.stubGlobal('fetch', async () => {
      round += 1;
      if (round <= 3) throw new TypeError('down');
      return ok(7, 40);
    });
    const { root, ui } = mount();
    let connects = 0;
    const { pull } = wire(ui, () => { connects += 1; });
    await pull();
    expect(label(root, 'anarchy')).toBe(ONLINE_UNAVAILABLE_LABEL);
    const input = root.querySelector<HTMLInputElement>('#online-nickname')!;
    input.value = 'Mina';
    const peaceful = root.querySelector<HTMLButtonElement>('[data-server-id="peaceful"]')!;
    peaceful.click();
    const refresh = root.querySelector<HTMLButtonElement>('.server-refresh-button')!;
    const cards = [...root.querySelectorAll('[data-server-id]')];
    refresh.focus();
    const before = round;
    refresh.click();
    refresh.click();
    expect(label(root, 'peaceful')).toBe('Проверка…');
    expect(refresh.disabled).toBe(true);
    expect(round - before).toBe(3);
    await vi.waitFor(() => expect(label(root, 'anarchy')).toBe('7 / 40'));
    expect(round - before).toBe(3);
    expect(input.value).toBe('Mina');
    expect(root.querySelector('[data-server-id="peaceful"]')).toBe(peaceful);
    expect(peaceful.classList.contains('selected')).toBe(true);
    expect([...root.querySelectorAll('[data-server-id]')]).toEqual(cards);
    expect(root.querySelector('.server-refresh-button')).toBe(refresh);
    expect(refresh.disabled).toBe(false);
    expect(document.activeElement).toBe(refresh);
    peaceful.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(connects).toBe(1);
  });

  it('does not steal focus from another control when the refresh finishes', () => {
    const { root, ui } = mount();
    ui.showOnlineServers(actions(), checkingServerStatuses(), 'anarchy', 'Steve');
    const refresh = root.querySelector<HTMLButtonElement>('.server-refresh-button')!;
    const input = root.querySelector<HTMLInputElement>('#online-nickname')!;
    refresh.focus();
    ui.applyOnlineServerStatuses(checkingServerStatuses());
    input.focus();
    ui.applyOnlineServerStatuses({
      anarchy: { phase: 'available', online: 1, maxPlayers: 300 },
      survival: { phase: 'available', online: 1, maxPlayers: 300 },
      peaceful: { phase: 'available', online: 1, maxPlayers: 300 },
    });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Steve');
    expect(refresh.disabled).toBe(false);
  });

  it('leaves the server list through Escape', () => {
    // Earlier screens in this file keep their capture listeners. Drain them first.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      if (!event.defaultPrevented) break;
    }
    const { root, ui } = mount();
    let backs = 0;
    ui.showOnlineServers({
      ...actions(),
      back: () => { backs += 1; },
    }, checkingServerStatuses(), 'anarchy', 'Steve');
    expect(root.querySelector('.server-list')).toBeTruthy();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(backs).toBe(1);
  });

  it('keeps connection retry separate from the server-list refresh button', () => {
    const { root, ui } = mount();
    let retried = 0;
    let backs = 0;
    ui.showOnlineConnectError({
      retry: () => { retried += 1; },
      back: () => { backs += 1; },
    });
    expect(root.querySelector('.server-window.server-connect-error-window')).toBeTruthy();
    expect(root.querySelector('.server-list-toolbar')).toBeNull();
    expect(root.querySelector('.server-refresh-button')).toBeNull();
    expect(root.textContent).not.toContain('Обновить');
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.server-menu-actions .game-button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Повторить', 'К списку серверов']);
    buttons[0]?.click();
    expect(retried).toBe(1);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      if (backs > 0 || !event.defaultPrevented) break;
    }
    expect(backs).toBe(1);
    buttons[1]?.click();
    expect(backs).toBe(2);
  });
});
