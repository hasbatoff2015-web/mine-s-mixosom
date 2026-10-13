import { formatMegacoinAmount } from '../shared/megacoins';

type Screen = 'home' | 'players' | 'player' | 'economy' | 'antidupe' | 'journal' | 'server';

interface Session {
  adminId: string;
  csrfToken: string;
  serverMode: string;
  worldId: string;
}

interface PlayerRow {
  playerId: string;
  name: string;
  online: boolean;
  gamemode: string;
}

const NAV: Array<{ id: Screen; label: string }> = [
  { id: 'players', label: 'Игроки' },
  { id: 'economy', label: 'Экономика' },
  { id: 'antidupe', label: 'Антидюп' },
  { id: 'journal', label: 'Журнал' },
  { id: 'server', label: 'Сервер' },
];

const requestIds = new Map<string, string>();
let session: Session | null = null;
let screen: Screen = 'home';
let selectedId = '';
let detailGen = 0;
let busy = false;
let pollTimer = 0;

export function createAdminApp(root: HTMLElement, fetchImpl: typeof fetch = fetch): void {
  const call = fetchImpl;
  void boot();

  async function boot(): Promise<void> {
    try {
      session = await api<Session>('/admin/api/me');
      screen = 'home';
    } catch {
      session = null;
    }
    render();
  }

  function render(): void {
    root.replaceChildren();
    const wrap = el('div', 'wrap');
    const panel = el('section', 'panel');
    const title = el('h1', undefined, 'МЕГАКРАФТ ОНЛАЙН');
    const mark = document.createElement('img');
    mark.className = 'mark';
    mark.alt = '';
    mark.src = '/admin/icons/icon_spawn.png';
    const head = el('div', 'row');
    head.append(mark, title);
    panel.append(head);
    if (!session) panel.append(loginForm());
    else {
      panel.append(el('p', 'muted', `Администратор: ${session.adminId}. Режим: ${session.serverMode}.`));
      panel.append(nav());
      panel.append(view());
    }
    wrap.append(panel);
    root.append(wrap);
    schedulePoll();
  }

  function loginForm(): HTMLElement {
    const form = document.createElement('form');
    const sub = el('h2', undefined, 'Панель администратора');
    const label = document.createElement('label');
    label.append(el('span', undefined, 'Секретный ключ'));
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.maxLength = 200;
    label.append(input);
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Войти';
    const message = el('p', 'bad');
    form.append(sub, label, button, message);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      button.disabled = true;
      void api<Session>('/admin/api/login', {
        method: 'POST',
        body: JSON.stringify({ secret: input.value }),
      }).then((next) => {
        input.value = '';
        session = next;
        screen = 'home';
        render();
      }).catch((error: unknown) => {
        message.textContent = error instanceof SessionEnded
          ? 'Сессия завершена. Войдите снова.'
          : 'Не удалось получить данные';
        button.disabled = false;
      });
    });
    return form;
  }

  function nav(): HTMLElement {
    const bar = el('div', 'nav');
    for (const item of NAV) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      if (screen === item.id) button.className = 'selected';
      button.addEventListener('click', () => {
        screen = item.id;
        render();
      });
      bar.append(button);
    }
    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Выход';
    out.addEventListener('click', () => {
      void api('/admin/api/logout', { method: 'POST', body: '{}' }).then(() => {
        session = null;
        screen = 'home';
        render();
      }).catch(() => {
        session = null;
        render();
      });
    });
    bar.append(out);
    return bar;
  }

  function view(): HTMLElement {
    const body = el('div');
    if (screen === 'home') {
      body.append(el('h2', undefined, 'Панель администратора'));
      body.append(el('p', undefined, 'Этот процесс показывает только свой режим. Общей панели на три мира нет.'));
      return body;
    }
    body.append(el('p', 'muted', 'Загрузка...'));
    if (screen === 'players') void loadPlayers(body);
    else if (screen === 'player') void loadPlayer(body);
    else if (screen === 'economy') void loadEconomy(body);
    else if (screen === 'antidupe') void loadAntiDupe(body);
    else if (screen === 'journal') void loadJournal(body);
    else void loadServer(body);
    return body;
  }

  async function loadPlayers(body: HTMLElement): Promise<void> {
    const data = await readJson<{ players: PlayerRow[]; nextCursor?: string }>('/admin/api/players?limit=20');
    if (screen !== 'players') return;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Игроки'));
    const search = document.createElement('input');
    search.placeholder = 'Ник или playerId';
    search.maxLength = 64;
    const list = el('div', 'list');
    const draw = (rows: PlayerRow[]) => {
      list.replaceChildren();
      if (rows.length === 0) list.append(el('p', 'muted', 'Записей пока нет'));
      for (const row of rows) {
        const line = el('div', 'row');
        const main = el('div');
        main.append(el('strong', undefined, row.name));
        main.append(el('div', 'muted', `${row.online ? 'в сети' : 'не в сети'} · ${row.gamemode} · ${row.playerId.slice(0, 8)}`));
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Открыть';
        open.addEventListener('click', () => {
          selectedId = row.playerId;
          screen = 'player';
          render();
        });
        line.append(main, open);
        list.append(line);
      }
    };
    draw(data?.players ?? []);
    search.addEventListener('change', () => {
      const q = encodeURIComponent(search.value.trim());
      void readJson<{ players: PlayerRow[] }>(`/admin/api/players?limit=20&q=${q}`).then((page) => {
        if (screen === 'players') draw(page?.players ?? []);
      });
    });
    body.append(search, list);
  }

  async function loadPlayer(body: HTMLElement): Promise<void> {
    const gen = ++detailGen;
    const data = await readJson<Record<string, unknown>>(`/admin/api/player/${encodeURIComponent(selectedId)}`);
    if (gen !== detailGen || screen !== 'player') return;
    body.replaceChildren();
    body.append(backButton());
    if (!data) {
      body.append(el('p', 'bad', 'Не удалось получить данные'));
      return;
    }
    body.append(el('h2', undefined, String(data.name ?? '')));
    body.append(el('p', undefined, `playerId: ${String(data.playerId ?? '')}`));
    body.append(el('p', undefined, data.online ? 'В сети' : 'Не в сети'));
    body.append(el('p', undefined, `Режим: ${String(data.gamemode ?? '')}`));
    body.append(el('p', undefined, `Баланс: ${formatMegacoinAmount(Number(data.balance ?? 0))}`));
    if (typeof data.health === 'number') body.append(el('p', undefined, `Здоровье: ${data.health}`));
    const position = data.position as { x?: number; y?: number; z?: number } | undefined;
    if (position) body.append(el('p', undefined, `Координаты: ${position.x}, ${position.y}, ${position.z}`));
    body.append(el('p', undefined, `Ревизия инвентаря: ${String(data.inventoryRevision ?? 'Нет данных')}`));
    if (data.containerKind) body.append(el('p', undefined, `Контейнер: ${String(data.containerKind)}`));
    const stacks = stackLines(data.inventory);
    const items = el('div', 'list');
    if (stacks.length === 0) items.append(el('p', 'muted', 'Записей пока нет'));
    for (const line of stacks) items.append(el('div', 'meta', line));
    body.append(items);
    body.append(moderation(String(data.playerId ?? ''), Boolean(data.online)));
  }

  function moderation(playerId: string, online: boolean): HTMLElement {
    const box = el('div');
    const reason = document.createElement('input');
    reason.placeholder = 'Причина';
    reason.maxLength = 200;
    const actions = el('div', 'actions');
    if (online) actions.append(actionButton('Кикнуть', 'danger', `kick:${playerId}`, () => postPlayer(playerId, 'kick', reason.value)));
    actions.append(actionButton('Бан по playerId', 'danger', `ban:${playerId}`, () => postPlayer(playerId, 'ban', reason.value)));
    actions.append(actionButton('Снять бан', '', `unban:${playerId}`, () => postPlayer(playerId, 'unban', reason.value)));
    const note = el('p', 'muted', 'Бан привязан к playerId этого мира. Новый session token создаёт другой id. Это не запрет по нику и не запрет по IP.');
    box.append(reason, actions, note);
    return box;
  }

  async function loadEconomy(body: HTMLElement): Promise<void> {
    body.replaceChildren();
    body.append(el('h2', undefined, 'Экономика'));
    const id = document.createElement('input');
    id.placeholder = 'playerId';
    id.maxLength = 64;
    const target = document.createElement('input');
    target.placeholder = 'Новый баланс';
    target.inputMode = 'numeric';
    const reason = document.createElement('input');
    reason.placeholder = 'Причина';
    reason.maxLength = 200;
    const out = el('div');
    const show = document.createElement('button');
    show.type = 'button';
    show.textContent = 'Показать';
    show.addEventListener('click', () => {
      void readJson<{ balance: number; backend: string; entries: Array<Record<string, unknown>> }>(
        `/admin/api/economy?playerId=${encodeURIComponent(id.value.trim())}`,
      ).then((page) => {
        out.replaceChildren();
        if (!page) {
          out.append(el('p', 'bad', 'Не удалось получить данные'));
          return;
        }
        out.append(el('p', undefined, `Баланс: ${formatMegacoinAmount(page.balance)}. Источник: ${page.backend}.`));
        if (page.entries.length === 0) out.append(el('p', 'muted', 'Записей пока нет'));
        for (const entry of page.entries) {
          out.append(el('div', 'meta', `${String(entry.reason ?? '')} ${String(entry.amount ?? '')} → ${String(entry.balanceAfter ?? '')}`));
        }
      });
    });
    const apply = actionButton('Установить баланс', 'ok', 'adjust', async () => {
      const balance = Number(target.value);
      const playerId = id.value.trim();
      if (!window.confirm(`Установить баланс ${playerId} на ${balance}?`)) return;
      const result = await api<{ ok?: boolean; balance?: number }>('/admin/api/economy/adjust', {
        method: 'POST',
        body: JSON.stringify({
          playerId,
          balance,
          reason: reason.value.trim(),
          requestId: requestIdFor(`adjust:${playerId}:${balance}:${reason.value.trim()}`),
        }),
      });
      requestIds.delete(`adjust:${playerId}:${balance}:${reason.value.trim()}`);
      out.append(el('p', 'ok-text', `Баланс: ${formatMegacoinAmount(Number(result.balance ?? balance))}`));
    });
    body.append(id, target, reason, el('div', 'actions', ''), show, apply, out);
    body.querySelector('.actions')?.append(show, apply);
  }

  async function loadAntiDupe(body: HTMLElement): Promise<void> {
    const incidents = await readJson<{ incidents: Array<Record<string, unknown>> }>('/admin/api/incidents');
    const resources = await readJson<{
      knownGaps: string[];
      scanned: boolean;
      resources: Array<Record<string, unknown>>;
      anomalies: Array<Record<string, unknown>>;
    }>('/admin/api/resources');
    if (screen !== 'antidupe') return;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Антидюп'));
    body.append(el('p', 'muted', 'Это наблюдения, не приговор. Автоматического изъятия и бана нет.'));
    const gaps = resources?.knownGaps ?? [];
    body.append(el('p', undefined, gaps.length ? `Известные пробелы: ${gaps.join(', ')}` : 'Известные пробелы: Нет данных'));
    const list = el('div', 'list');
    const rows = incidents?.incidents ?? [];
    if (rows.length === 0) list.append(el('p', 'muted', 'Записей пока нет'));
    for (const row of rows) {
      const resolved = row.resolvedAt ? 'решено' : 'открыто';
      list.append(el('div', 'meta', `${String(row.category ?? '')} · ${resolved} · ${String(row.itemInstanceId ?? '')}`));
    }
    for (const row of resources?.resources ?? []) {
      const current = row.current === null || row.current === undefined ? 'Нет данных' : String(row.current);
      list.append(el('div', 'meta', `${String(row.itemId)} ожидается ${String(row.expected)} сейчас ${current}`));
    }
    for (const row of resources?.anomalies ?? []) {
      list.append(el('div', 'meta', `${String(row.status)} ${String(row.itemId)} +${String(row.unexplained)}`));
    }
    const button = actionButton('Проверить сейчас', '', 'recheck', async () => {
      await api('/admin/api/resources/recheck', {
        method: 'POST',
        body: JSON.stringify({ reason: 'ручная проверка', requestId: requestIdFor('recheck') }),
      });
      requestIds.delete('recheck');
      if (screen === 'antidupe') render();
    });
    body.append(list, button);
  }

  async function loadJournal(body: HTMLElement): Promise<void> {
    const page = await readJson<{ entries: Array<Record<string, unknown>> }>('/admin/api/audit?limit=20');
    if (screen !== 'journal') return;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Журнал'));
    const rows = page?.entries ?? [];
    if (rows.length === 0) {
      body.append(el('p', 'muted', 'Записей пока нет'));
      return;
    }
    for (const row of rows) {
      body.append(el('div', 'meta', `${String(row.createdAt ?? '')} ${String(row.adminId ?? '')} ${String(row.action ?? '')} ${row.success ? 'успех' : 'ошибка'} ${String(row.reason ?? '')}`));
    }
  }

  async function loadServer(body: HTMLElement): Promise<void> {
    const page = await readJson<Record<string, unknown>>('/admin/api/server');
    if (screen !== 'server') return;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Сервер'));
    if (!page) {
      body.append(el('p', 'bad', 'Не удалось получить данные'));
      return;
    }
    const measured = typeof page.measuredTickMs === 'number' ? `${page.measuredTickMs} мс` : 'Нет данных';
    const lines = [
      `Режим: ${String(page.serverMode)}`,
      `Мир: ${String(page.worldId)}`,
      `В сети: ${String(page.online)} / ${String(page.maxPlayers)}`,
      `Заданный тик: ${String(page.configuredTickRate)}`,
      `Измеренный тик: ${measured}`,
      `Аптайм, с: ${String(page.uptimeSeconds)}`,
      `PostgreSQL: ${page.postgres ? 'включена' : 'выключена'}`,
      `Релиз: ${page.release ? String(page.release) : 'Нет данных'}`,
      'Последнее предупреждение: Нет данных',
    ];
    for (const line of lines) body.append(el('p', undefined, line));
  }

  function backButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Назад';
    button.addEventListener('click', () => {
      screen = 'players';
      render();
    });
    return button;
  }

  function actionButton(label: string, className: string, key: string, run: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      void run().catch((error: unknown) => {
        const message = error instanceof SessionEnded
          ? 'Сессия завершена. Войдите снова.'
          : 'Не удалось получить данные';
        button.insertAdjacentElement('afterend', el('p', 'bad', message));
      }).finally(() => {
        busy = false;
        button.disabled = false;
      });
    });
    void key;
    return button;
  }

  async function postPlayer(playerId: string, action: 'kick' | 'ban' | 'unban', reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error('reason');
    if (!window.confirm(`${action} ${playerId}?`)) return;
    const key = `${action}:${playerId}:${trimmed}`;
    await api(`/admin/api/player/${encodeURIComponent(playerId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason: trimmed, requestId: requestIdFor(key) }),
    });
    requestIds.delete(key);
  }

  async function readJson<T>(path: string): Promise<T | null> {
    try {
      return await api<T>(path);
    } catch (error) {
      if (error instanceof SessionEnded) {
        session = null;
        render();
      }
      return null;
    }
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('Content-Type', 'application/json');
    if (session && init?.method && init.method !== 'GET') headers.set('X-CSRF-Token', session.csrfToken);
    const response = await call(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      session = null;
      screen = 'home';
      render();
      throw new SessionEnded();
    }
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'failed');
    return payload;
  }

  function schedulePoll(): void {
    window.clearInterval(pollTimer);
    if (!session || screen !== 'server') return;
    pollTimer = window.setInterval(() => {
      if (document.hidden || screen !== 'server') return;
      void loadServer(root.querySelector('.panel > div') ?? root);
    }, 15_000);
  }
}

class SessionEnded extends Error {}

function requestIdFor(key: string): string {
  const existing = requestIds.get(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  requestIds.set(key, created);
  return created;
}

function stackLines(inventory: unknown): string[] {
  if (!inventory || typeof inventory !== 'object') return [];
  const slots = (inventory as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return [];
  const lines: string[] = [];
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue;
    const item = slot as { itemId?: unknown; count?: unknown };
    if (typeof item.itemId !== 'string' || typeof item.count !== 'number') continue;
    lines.push(`${item.itemId} × ${item.count}`);
    if (lines.length >= 36) break;
  }
  return lines;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector<HTMLElement>('#admin-app');
  if (root) createAdminApp(root);
}
