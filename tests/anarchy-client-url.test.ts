import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anarchyClientUrl,
  anarchyStatusUrl,
  clientUrlForServer,
  endpointLabel,
  fetchLocalServerStatuses,
  statusUrlForServer,
  statusUrlFromAnarchyWs,
} from '../src/net/AnarchyClient';

const PRODUCTION_WS = 'wss://megacraft.agariobrainrot.ru';
const PRODUCTION_STATUS = 'https://megacraft.agariobrainrot.ru/status';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('anarchy client endpoints', () => {
  it('uses the local Anarchy socket and status when no production env is set', () => {
    vi.stubEnv('VITE_ANARCHY_URL', '');
    expect(anarchyClientUrl()).toBe('ws://127.0.0.1:2567');
    expect(anarchyStatusUrl()).toBe('http://127.0.0.1:2567/status');
    expect(anarchyClientUrl('')).toBe('ws://127.0.0.1:2567');
    expect(anarchyStatusUrl('')).toBe('http://127.0.0.1:2567/status');
    expect(anarchyStatusUrl('?server=anarchy')).toBe('http://127.0.0.1:2567/status');
    expect(clientUrlForServer('survival')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('survival', '')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('peaceful', '')).toBe('ws://127.0.0.1:2569');
    expect(statusUrlForServer('peaceful')).toBe('http://127.0.0.1:2569/status');
    expect(statusUrlForServer('peaceful', '')).toBe('http://127.0.0.1:2569/status');
  });

  it('uses VITE_ANARCHY_URL for the live Anarchy socket and derives https /status', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl()).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl()).toBe(PRODUCTION_STATUS);
    expect(statusUrlFromAnarchyWs(PRODUCTION_WS)).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('anarchy')).toBe(PRODUCTION_WS);
    expect(statusUrlForServer('anarchy')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('survival')).toBeUndefined();
    expect(statusUrlForServer('survival')).toBeUndefined();
    expect(clientUrlForServer('peaceful')).toBeUndefined();
    expect(statusUrlForServer('peaceful')).toBeUndefined();
    expect(endpointLabel(clientUrlForServer('anarchy')!)).toBe('megacraft.agariobrainrot.ru');
  });

  it('treats an empty search as no query and uses the production Anarchy endpoint', async () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl('')).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl('')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('anarchy', '')).toBe(PRODUCTION_WS);
    expect(statusUrlForServer('anarchy', '')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('survival', '')).toBeUndefined();
    expect(statusUrlForServer('survival', '')).toBeUndefined();
    expect(clientUrlForServer('peaceful', '')).toBeUndefined();
    expect(statusUrlForServer('peaceful', '')).toBeUndefined();

    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ online: 0, maxPlayers: 300 }) };
    });
    const statuses = await fetchLocalServerStatuses('');
    expect(seen).toEqual([PRODUCTION_STATUS]);
    expect(statuses.anarchy).toEqual({ phase: 'available', online: 0, maxPlayers: 300 });
    expect(statuses.survival).toEqual({ phase: 'not_configured' });
    expect(statuses.peaceful).toEqual({ phase: 'not_configured' });
  });

  it('does not let ?server= replace a public card with localhost', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl('?server=anarchy')).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl('?server=anarchy')).toBe(PRODUCTION_STATUS);
    expect(anarchyClientUrl('?server=survival')).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl('?server=survival')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('survival', '?server=survival')).toBeUndefined();
    expect(clientUrlForServer('anarchy', '?server=survival')).toBe(PRODUCTION_WS);
    expect(clientUrlForServer('survival', '?server=survival')).not.toBe(PRODUCTION_WS);
    expect(anarchyClientUrl('?server=peaceful')).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl('?server=peaceful')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('survival', '?server=survival&anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
    expect(clientUrlForServer('anarchy', '?server=survival&anarchyPort=2700')).toBe(PRODUCTION_WS);
  });

  it('lets anarchyUrl, anarchyHost, and anarchyPort beat VITE_ANARCHY_URL', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl('?anarchyUrl=ws://example.test:9')).toBe('ws://example.test:9');
    expect(anarchyStatusUrl('?anarchyUrl=ws://example.test:9')).toBe('http://127.0.0.1:2567/status');
    expect(anarchyClientUrl('?anarchyHost=10.0.0.8')).toBe('ws://10.0.0.8:2567');
    expect(anarchyStatusUrl('?anarchyHost=10.0.0.8')).toBe('http://10.0.0.8:2567/status');
    expect(anarchyClientUrl('?anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
    expect(anarchyStatusUrl('?anarchyPort=2700')).toBe('http://127.0.0.1:2700/status');
    expect(clientUrlForServer('anarchy', '?anarchyUrl=ws://example.test:9')).toBe('ws://example.test:9');
    expect(clientUrlForServer('survival', '?anarchyUrl=ws://example.test:9')).toBeUndefined();
    expect(clientUrlForServer('peaceful', '?anarchyPort=2700')).toBeUndefined();

    vi.stubGlobal('location', { search: '?anarchyUrl=ws://example.test:9' });
    expect(anarchyClientUrl()).toBe('ws://example.test:9');
    expect(anarchyStatusUrl()).toBe('http://127.0.0.1:2567/status');

    vi.stubGlobal('location', { search: '?anarchyHost=10.0.0.8&anarchyPort=2700' });
    expect(anarchyClientUrl()).toBe('ws://10.0.0.8:2700');
    expect(anarchyStatusUrl()).toBe('http://10.0.0.8:2700/status');
  });

  it('polls only configured public status urls', async () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    vi.stubEnv('VITE_PEACEFUL_URL', 'wss://peaceful.example.test');
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ online: 1, maxPlayers: 300 }) };
    });
    const statuses = await fetchLocalServerStatuses();
    expect(seen).toEqual([
      PRODUCTION_STATUS,
      'https://peaceful.example.test/status',
    ]);
    expect(statuses.survival).toEqual({ phase: 'not_configured' });
    expect(endpointLabel(clientUrlForServer('anarchy')!)).toBe('megacraft.agariobrainrot.ru');
    expect(clientUrlForServer('survival')).toBeUndefined();
    expect(endpointLabel(clientUrlForServer('peaceful')!)).toBe('peaceful.example.test');
    expect(endpointLabel('ws://127.0.0.1:2567')).toBe('localhost');
    expect(seen.join(' ')).not.toContain('127.0.0.1');
  });

  it('lets anarchyStatus replace the derived production status URL', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyStatusUrl('?anarchyStatus=http://127.0.0.1:2599/status')).toBe('http://127.0.0.1:2599/status');
    vi.stubGlobal('location', { search: '?anarchyStatus=https://status.example.test/health' });
    expect(anarchyStatusUrl()).toBe('https://status.example.test/health');
    expect(anarchyClientUrl()).toBe(PRODUCTION_WS);
  });
});
