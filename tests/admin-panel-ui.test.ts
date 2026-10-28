/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminApp } from '../admin-ui/main';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('admin panel text', () => {
  it('shows a hostile nickname as text and keeps the remove request id', async () => {
    const sent: Array<{ url: string; body?: string }> = [];
    const session = {
      adminId: 'admin-owner',
      csrfToken: 'csrf-token-value',
      serverMode: 'anarchy',
      worldId: 'anarchy',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url === '/admin/api/me') return json(session);
      if (String(url).startsWith('/admin/api/players')) {
        return json({
          players: [{
            playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: '<script>alert(1)</script>',
            online: true,
            gamemode: 'survival',
          }],
        });
      }
      return json({ ok: true });
    }));
    vi.stubGlobal('confirm', () => true);
    const root = document.createElement('div');
    document.body.append(root);
    createAdminApp(root, fetch);
    await flush();
    const players = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Игроки');
    players?.click();
    await flush();
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.querySelector('script')).toBeNull();
    const open = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Открыть');
    expect(open).toBeTruthy();
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
