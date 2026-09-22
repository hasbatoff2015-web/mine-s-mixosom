import { describe, expect, it, vi } from 'vitest';
import { LOCAL_SERVER_PRESETS } from '../shared/config';
import {
  clientSessionStorageKey,
  clientUrlForServer,
  fetchLocalServerStatuses,
  selectedLocalServer,
  statusUrlForServer,
} from '../src/net/AnarchyClient';
import { onlineServerRows, renderOnlineServerRows } from '../src/ui/menuModel';
import gameUiSource from '../src/ui/GameUI.ts?raw';

describe('online server menu', () => {
  it('selects Anarchy when the query is missing or names Anarchy', () => {
    expect(selectedLocalServer('')).toBe('anarchy');
    expect(selectedLocalServer('?server=anarchy')).toBe('anarchy');
    expect(clientUrlForServer('anarchy', '')).toBe('ws://127.0.0.1:2567');
    expect(clientUrlForServer('anarchy', '?server=anarchy')).toBe('ws://127.0.0.1:2567');
  });

  it('selects Survival and connects that card to :2568', () => {
    expect(selectedLocalServer('?server=survival')).toBe('survival');
    expect(clientUrlForServer('survival', '?server=survival')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('anarchy', '?server=survival')).toBe('ws://127.0.0.1:2567');
  });

  it('selects Peaceful and connects that card to :2569', () => {
    expect(selectedLocalServer('?server=peaceful')).toBe('peaceful');
    expect(clientUrlForServer('peaceful', '?server=peaceful')).toBe('ws://127.0.0.1:2569');
    expect(clientUrlForServer('survival', '?server=peaceful')).toBe('ws://127.0.0.1:2568');
  });

  it('keeps legacy anarchy overrides on the addressed server only', () => {
    expect(clientUrlForServer('anarchy', '?anarchyUrl=ws://example.test:9')).toBe('ws://example.test:9');
    expect(clientUrlForServer('survival', '?anarchyUrl=ws://example.test:9')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('anarchy', '?anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
    expect(clientUrlForServer('peaceful', '?anarchyPort=2700')).toBe('ws://127.0.0.1:2569');
    expect(clientSessionStorageKey('ws://127.0.0.1:2567')).toBe('fc.anarchy.sessionToken');
    expect(clientSessionStorageKey('ws://127.0.0.1:2568')).toBe('fc.session.ws://127.0.0.1:2568');
  });

  it('renders exactly the three preset servers and no unavailable stub', () => {
    const html = renderOnlineServerRows({
      anarchy: { reachable: true, online: 0, maxPlayers: 300 },
      survival: { reachable: true, online: 0, maxPlayers: 300 },
      peaceful: { reachable: true, online: 0, maxPlayers: 300 },
    }, 'anarchy');
    expect(html.match(/data-server-id="/g)).toHaveLength(3);
    expect(html).toContain('data-server-id="anarchy"');
    expect(html).toContain('data-server-id="survival"');
    expect(html).toContain('data-server-id="peaceful"');
    expect(html).toContain('Анархия PvP');
    expect(html).toContain('Выживание PvP');
    expect(html).toContain('Мирный');
    expect(html).toContain('class="server-row selected" data-server-id="anarchy"');
    expect(html).not.toContain('пока недоступно');
    expect(html).not.toContain('PvP</strong><small>Выживание без PvP');
    expect(gameUiSource).not.toContain('пока недоступно');
    expect(Object.keys(LOCAL_SERVER_PRESETS)).toEqual(['anarchy', 'survival', 'peaceful']);
  });

  it.each([
    ['survival', 'peaceful'],
    ['peaceful', 'anarchy'],
    ['anarchy', 'survival'],
  ] as const)('marks only %s offline', (offline, selected) => {
    const statuses = {
      anarchy: { reachable: offline !== 'anarchy', online: 1, maxPlayers: 300 },
      survival: { reachable: offline !== 'survival', online: 2, maxPlayers: 300 },
      peaceful: { reachable: offline !== 'peaceful', online: 3, maxPlayers: 300 },
    };
    const rows = onlineServerRows(statuses, selected);
    expect(rows.find((row) => row.id === offline)?.label).toBe('оффлайн');
    expect(rows.find((row) => row.id === offline)?.reachable).toBe(false);
    for (const row of rows) {
      if (row.id === offline) continue;
      expect(row.label).toBe(`${statuses[row.id].online} / 300`);
      expect(row.reachable).toBe(true);
    }
    expect(rows.find((row) => row.id === selected)?.selected).toBe(true);
    const html = renderOnlineServerRows(statuses, selected);
    expect(html).toContain(`class="server-row selected" data-server-id="${selected}"`);
    expect(html.match(/is-offline/g)).toHaveLength(1);
  });

  it('fetches each server status from its own preset', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url));
      if (String(url).includes(':2568/')) return { ok: false };
      const online = String(url).includes(':2569/') ? 4 : 1;
      return { ok: true, json: async () => ({ online, maxPlayers: 300 }) };
    });
    try {
      const statuses = await fetchLocalServerStatuses('');
      expect(seen).toEqual([
        statusUrlForServer('anarchy', ''),
        statusUrlForServer('survival', ''),
        statusUrlForServer('peaceful', ''),
      ]);
      expect(statuses.anarchy).toEqual({ reachable: true, online: 1, maxPlayers: 300 });
      expect(statuses.survival.reachable).toBe(false);
      expect(statuses.peaceful).toEqual({ reachable: true, online: 4, maxPlayers: 300 });
      const rows = onlineServerRows(statuses, 'survival');
      expect(rows.find((row) => row.id === 'survival')?.label).toBe('оффлайн');
      expect(rows.find((row) => row.id === 'anarchy')?.label).toBe('1 / 300');
      expect(rows.find((row) => row.id === 'peaceful')?.label).toBe('4 / 300');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
