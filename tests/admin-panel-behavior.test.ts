/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminApp } from '../admin-ui/main';
import { parseAdminBalance } from '../admin-ui/balanceInput';

const session = {
  adminId: 'admin-owner',
  csrfToken: 'csrf-token-value',
  serverMode: 'anarchy',
  worldId: 'anarchy',
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('admin balance input', () => {
  it('rejects empty, blank and fractional values and accepts zero', () => {
    expect(parseAdminBalance('').ok).toBe(false);
    expect(parseAdminBalance('   ').ok).toBe(false);
    expect(parseAdminBalance('1.5').ok).toBe(false);
    expect(parseAdminBalance('-1').ok).toBe(false);
    expect(parseAdminBalance('Infinity').ok).toBe(false);
    expect(parseAdminBalance('0')).toEqual({ ok: true, value: 0 });
    expect(parseAdminBalance(' 800 ')).toEqual({ ok: true, value: 800 });
  });
});

describe('admin panel behavior', () => {
  it('refreshes only the server screen and stops after logout', async () => {
    let serverCalls = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/admin/api/me') return json(session);
      if (url === '/admin/api/logout') return json({ ok: true });
      if (String(url).startsWith('/admin/api/players')) return json({ players: [] });
      if (String(url).startsWith('/admin/api/server')) {
        serverCalls += 1;
        return json({
          serverMode: 'anarchy',
          worldId: 'anarchy',
          online: serverCalls,
          maxPlayers: 8,
          configuredTickRate: 20,
          measuredTickMs: null,
          uptimeSeconds: serverCalls,
          postgres: true,
          release: null,
        });
      }
      return json({ ok: true });
    }));
    const root = document.createElement('div');
    document.body.append(root);
    createAdminApp(root, fetch);
    await flush();
    click(root, 'Сервер');
    await flush();
    expect(root.textContent).toContain('МЕГАКРАФТ ОНЛАЙН');
    expect(root.querySelector('img.mark')).toBeTruthy();
    expect(root.textContent).toContain('Игроки');
    const first = serverCalls;
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(serverCalls).toBeGreaterThan(first);
    expect(root.textContent).toContain('МЕГАКРАФТ ОНЛАЙН');
    expect(root.querySelector('img.mark')).toBeTruthy();
    click(root, 'Игроки');
    await flush();
    const afterLeave = serverCalls;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(serverCalls).toBe(afterLeave);
    click(root, 'Сервер');
    await flush();
    click(root, 'Выход');
    await flush();
    const afterLogout = serverCalls;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(serverCalls).toBe(afterLogout);
  });

  it('does not send an empty balance and keeps the request id after a failed submit', async () => {
    const sent: string[] = [];
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/admin/api/me') return json(session);
      if (String(url).startsWith('/admin/api/economy?')) {
        return json({ balance: 500, backend: 'postgres', entries: [] });
      }
      if (url === '/admin/api/economy/adjust') {
        sent.push(String(init?.body ?? ''));
        return json({ error: 'unavailable' }, 503);
      }
      return json({ players: [] });
    }));
    const root = document.createElement('div');
    document.body.append(root);
    createAdminApp(root, fetch);
    await flush();
    click(root, 'Экономика');
    await flush();
    const inputs = [...root.querySelectorAll('input')];
    const player = inputs[0] as HTMLInputElement;
    const balance = inputs[1] as HTMLInputElement;
    const reason = inputs[2] as HTMLInputElement;
    player.value = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    balance.value = '';
    reason.value = 'коррекция';
    click(root, 'Установить баланс');
    await flush();
    expect(sent).toEqual([]);
    expect(root.textContent).toContain('Введите баланс');
    balance.value = '0';
    click(root, 'Показать');
    await flush();
    click(root, 'Установить баланс');
    await flush();
    expect(sent).toHaveLength(1);
    const first = JSON.parse(sent[0]!) as { requestId: string; balance: number };
    expect(first.balance).toBe(0);
    click(root, 'Установить баланс');
    await flush();
    const second = JSON.parse(sent[1]!) as { requestId: string };
    expect(second.requestId).toBe(first.requestId);
  });

  it('shows an API error instead of an empty journal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/admin/api/me') return json(session);
      if (String(url).startsWith('/admin/api/audit')) return json({ error: 'unavailable' }, 503);
      return json({ ok: true });
    }));
    const root = document.createElement('div');
    document.body.append(root);
    createAdminApp(root, fetch);
    await flush();
    click(root, 'Журнал');
    await flush();
    expect(root.textContent).not.toContain('Записей пока нет');
    expect(root.textContent).toContain('Не удалось');
  });
});

function click(root: HTMLElement, label: string): void {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent === label);
  button?.click();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
