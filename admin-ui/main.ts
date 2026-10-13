import { formatMegacoinAmount } from '../shared/megacoins';
import { parseAdminBalance } from './balanceInput';

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
let viewGen = 0;
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
    viewGen += 1;
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
    schedulePoll(viewGen);
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
    const body = el('div', 'admin-screen');
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
    const gen = viewGen;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Игроки'));
    const search = document.createElement('input');
    search.placeholder = 'Ник или playerId';
    search.maxLength = 64;
    const list = el('div', 'list');
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'Показать ещё';
    more.hidden = true;
    let query = '';
    let cursor = '';
    const seen = new Set<string>();
    const draw = (rows: PlayerRow[], append: boolean) => {
      if (!append) {
        list.replaceChildren();
        seen.clear();
      }
      const fresh = rows.filter((row) => !seen.has(row.playerId));
      if (!append && fresh.length === 0) list.append(el('p', 'muted', 'Записей пока нет'));
      for (const row of fresh) {
        seen.add(row.playerId);
        const line = el('div', 'row');
        const main = el('div');
        main.append(el('strong', undefined, row.name));
        main.append(el('div', 'muted', `${row.online ? 'в сети' : 'не в сети'} · ${row.gamemode} · ${row.playerId}`));
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
    const load = async (append: boolean) => {
      const params = new URLSearchParams({ limit: '20' });
      if (query) params.set('q', query);
      if (append && cursor) params.set('cursor', cursor);
      const page = await readJson<{ players: PlayerRow[]; nextCursor?: string }>(`/admin/api/players?${params}`);
      if (gen !== viewGen || screen !== 'players') return;
      if (!page.ok) {
        if (!append) list.replaceChildren(el('p', 'bad', page.message));
        more.hidden = true;
        return;
      }
      draw(page.data.players ?? [], append);
      cursor = page.data.nextCursor ?? '';
      more.hidden = cursor === '';
    };
    search.addEventListener('change', () => {
      query = search.value.trim();
      cursor = '';
      void load(false);
    });
    more.addEventListener('click', () => { void load(true); });
    body.append(search, list, more);
    await load(false);
  }

  async function loadPlayer(body: HTMLElement): Promise<void> {
    const gen = ++detailGen;
    const loaded = await readJson<Record<string, unknown>>(`/admin/api/player/${encodeURIComponent(selectedId)}`);
    if (gen !== detailGen || screen !== 'player') return;
    body.replaceChildren();
    body.append(backButton());
    if (!loaded.ok) {
      body.append(el('p', 'bad', loaded.message));
      return;
    }
    const data = loaded.data;
    body.append(el('h2', undefined, String(data.name ?? '')));
    const ban = data.ban as { banned?: boolean; reason?: string } | undefined;
    body.append(el('p', ban?.banned ? 'bad' : 'ok-text', ban?.banned ? `Бан: ${ban.reason ?? 'да'}` : 'Бан: нет'));
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
    const note = el('p', 'bad');
    const out = el('div');
    let shownId = '';
    let shownBalance: number | undefined;
    const show = document.createElement('button');
    show.type = 'button';
    show.textContent = 'Показать';
    show.addEventListener('click', () => {
      const playerId = id.value.trim();
      void readJson<{ balance: number; backend: string; entries: Array<Record<string, unknown>> }>(
        `/admin/api/economy?playerId=${encodeURIComponent(playerId)}`,
      ).then((page) => {
        out.replaceChildren();
        if (!page.ok) {
          shownBalance = undefined;
          out.append(el('p', 'bad', page.message));
          return;
        }
        shownId = playerId;
        shownBalance = page.data.balance;
        out.append(el('p', undefined, `Баланс: ${formatMegacoinAmount(page.data.balance)}. Источник: ${page.data.backend}. Режим: ${session?.serverMode ?? ''}.`));
        if (page.data.entries.length === 0) out.append(el('p', 'muted', 'Записей пока нет'));
        for (const entry of page.data.entries) {
          const when = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString() : '';
          const signed = entry.type === 'withdraw' ? `-${entry.amount}` : `+${entry.amount}`;
          const related = entry.relatedPlayerId ? ` · ${entry.relatedPlayerId}` : '';
          const op = entry.transactionId ? ` · ${entry.transactionId}` : '';
          out.append(el('div', 'meta', `${when} ${String(entry.reason ?? '')} ${signed} → ${String(entry.balanceAfter ?? '')}${related}${op}`));
        }
      });
    });
    const apply = actionButton('Установить баланс', 'ok', 'adjust', async () => {
      note.textContent = '';
      const playerId = id.value.trim();
      const parsed = parseAdminBalance(target.value);
      const why = reason.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(playerId)) {
        note.textContent = 'Укажите playerId.';
        return;
      }
      if (!parsed.ok) {
        note.textContent = parsed.message;
        return;
      }
      if (why === '' || why.length > 200) {
        note.textContent = 'Укажите причину.';
        return;
      }
      if (shownId !== playerId || shownBalance === undefined) {
        note.textContent = 'Сначала покажите текущий баланс.';
        return;
      }
      const delta = parsed.value - shownBalance;
      const sign = delta > 0 ? `+${delta}` : String(delta);
      const accepted = window.confirm(
        `Игрок: ${playerId}\nРежим: ${session?.serverMode ?? ''}\nТекущий баланс: ${shownBalance}\nНовый баланс: ${parsed.value}\nИзменение: ${sign}\nПричина: ${why}`,
      );
      if (!accepted) return;
      const key = `adjust:${playerId}:${parsed.value}:${why}`;
      const result = await api<{ ok?: boolean; balance?: number }>(`/admin/api/economy/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          playerId,
          balance: parsed.value,
          reason: why,
          requestId: requestIdFor(key),
        }),
      });
      requestIds.delete(key);
      if (typeof result.balance !== 'number') throw new Error('no-balance');
      shownBalance = result.balance;
      out.prepend(el('p', 'ok-text', `Баланс: ${formatMegacoinAmount(result.balance)}`));
    });
    body.append(id, target, reason, note, show, apply, out);
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
    if (!incidents.ok) {
      body.append(el('p', 'bad', incidents.message));
      return;
    }
    if (!resources.ok) {
      body.append(el('p', 'bad', resources.message));
      return;
    }
    body.append(el('p', 'muted', 'Это наблюдения, не приговор. Автоматического изъятия и бана нет.'));
    const gaps = resources.data.knownGaps ?? [];
    body.append(el('p', undefined, gaps.length ? `Известные пробелы: ${gaps.join(', ')}` : 'Известные пробелы: Нет данных'));
    const list = el('div', 'list');
    const rows = incidents.data.incidents ?? [];
    if (rows.length === 0) list.append(el('p', 'muted', 'Записей пока нет'));
    for (const row of rows) {
      const resolved = row.resolvedAt ? 'решено' : 'открыто';
      list.append(el('div', 'meta', `${String(row.category ?? '')} · ${resolved} · ${String(row.itemInstanceId ?? '')}`));
    }
    for (const row of resources.data.resources ?? []) {
      const current = row.current === null || row.current === undefined ? 'Нет данных' : String(row.current);
      list.append(el('div', 'meta', `${String(row.itemId)} ожидается ${String(row.expected)} сейчас ${current}`));
    }
    for (const row of resources.data.anomalies ?? []) {
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
    const gen = viewGen;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Журнал'));
    const list = el('div', 'list');
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'Показать ещё';
    more.hidden = true;
    let cursor = '';
    const paint = (rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        const status = row.success ? 'успех' : 'ошибка';
        list.append(el('div', 'meta', `${String(row.createdAt ?? '')} · ${String(row.adminId ?? '')} · ${String(row.action ?? '')} · ${String(row.targetId ?? '')} · ${status} · ${String(row.reason ?? '')}`));
      }
    };
    const load = async () => {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      const page = await readJson<{ entries: Array<Record<string, unknown>>; nextCursor?: string }>(`/admin/api/audit?${params}`);
      if (gen !== viewGen || screen !== 'journal') return;
      if (!page.ok) {
        list.replaceChildren(el('p', 'bad', page.message));
        more.hidden = true;
        return;
      }
      if (page.data.entries.length === 0 && cursor === '') list.append(el('p', 'muted', 'Записей пока нет'));
      paint(page.data.entries);
      cursor = page.data.nextCursor ?? '';
      more.hidden = cursor === '';
    };
    more.addEventListener('click', () => { void load(); });
    body.append(list, more);
    await load();
  }

  async function loadServer(body: HTMLElement, gen = viewGen): Promise<void> {
    const page = await readJson<Record<string, unknown>>('/admin/api/server');
    if (gen !== viewGen || screen !== 'server') return;
    body.replaceChildren();
    body.append(el('h2', undefined, 'Сервер'));
    if (!page.ok) {
      body.append(el('p', 'bad', page.message));
      return;
    }
    const data = page.data;
    const measured = typeof data.measuredTickMs === 'number' ? `${data.measuredTickMs} мс` : 'Нет данных';
    const lines = [
      `Режим: ${String(data.serverMode)}`,
      `Мир: ${String(data.worldId)}`,
      `В сети: ${String(data.online)} / ${String(data.maxPlayers)}`,
      `Заданный тик: ${String(data.configuredTickRate)}`,
      `Измеренный тик: ${measured}`,
      `Аптайм, с: ${String(data.uptimeSeconds)}`,
      `PostgreSQL: ${data.postgres ? 'включена' : 'выключена'}`,
      `Релиз: ${data.release ? String(data.release) : 'Нет данных'}`,
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
        const message = actionMessage(error);
        if (message) button.insertAdjacentElement('afterend', el('p', 'bad', message));
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
    if (screen === 'player' && selectedId === playerId) render();
  }

  async function readJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
    try {
      return { ok: true, data: await api<T>(path) };
    } catch (error) {
      if (error instanceof SessionEnded) return { ok: false, message: 'Сессия завершена. Войдите снова.' };
      return { ok: false, message: actionMessage(error) };
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

  function schedulePoll(gen: number): void {
    window.clearInterval(pollTimer);
    if (!session || screen !== 'server') return;
    pollTimer = window.setInterval(() => {
      if (document.hidden || gen !== viewGen || screen !== 'server') return;
      const box = root.querySelector<HTMLElement>('.admin-screen');
      if (box) void loadServer(box, gen);
    }, 15_000);
  }
}

function actionMessage(error: unknown): string {
  if (error instanceof SessionEnded) return 'Сессия завершена. Войдите снова.';
  const code = error instanceof Error ? error.message : '';
  if (code === 'postgres-required') return 'PostgreSQL недоступна.';
  if (code === 'offline') return 'Игрок уже не в сети.';
  if (code === 'rejected' || code === 'conflict') return 'Запрос отклонён. Повторите новым действием.';
  if (!code || code === 'failed') return 'Не удалось получить данные';
  return 'Не удалось выполнить действие. Повторите тем же запросом.';
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
