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
    expect(anarchyStatusUrl('?server=anarchy')).toBe('http://127.0.0.1:2567/status');
    expect(clientUrlForServer('survival')).toBe('ws://127.0.0.1:2568');
    expect(statusUrlForServer('peaceful')).toBe('http://127.0.0.1:2569/status');
  });

  it('uses VITE_ANARCHY_URL for the live Anarchy socket and derives https /status', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl()).toBe(PRODUCTION_WS);
    expect(anarchyStatusUrl()).toBe(PRODUCTION_STATUS);
    expect(statusUrlFromAnarchyWs(PRODUCTION_WS)).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('anarchy')).toBe(PRODUCTION_WS);
    expect(statusUrlForServer('anarchy')).toBe(PRODUCTION_STATUS);
    expect(clientUrlForServer('survival')).toBe('ws://127.0.0.1:2568');
    expect(statusUrlForServer('peaceful')).toBe('http://127.0.0.1:2569/status');
  });

  it('keeps an explicit search on the local presets even when production env is set', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyClientUrl('')).toBe('ws://127.0.0.1:2567');
    expect(anarchyClientUrl('?server=anarchy')).toBe('ws://127.0.0.1:2567');
    expect(anarchyClientUrl('?server=survival')).toBe('ws://127.0.0.1:2568');
    expect(anarchyClientUrl('?server=peaceful')).toBe('ws://127.0.0.1:2569');
    expect(anarchyStatusUrl('?server=peaceful')).toBe('http://127.0.0.1:2569/status');
    expect(anarchyClientUrl('?server=survival&anarchyPort=2700')).toBe('ws://127.0.0.1:2700');
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
    expect(clientUrlForServer('survival', '?anarchyUrl=ws://example.test:9')).toBe('ws://127.0.0.1:2568');
    expect(clientUrlForServer('peaceful', '?anarchyPort=2700')).toBe('ws://127.0.0.1:2569');

    vi.stubGlobal('location', { search: '?anarchyUrl=ws://example.test:9' });
    expect(anarchyClientUrl()).toBe('ws://example.test:9');
    expect(anarchyStatusUrl()).toBe('http://127.0.0.1:2567/status');

    vi.stubGlobal('location', { search: '?anarchyHost=10.0.0.8&anarchyPort=2700' });
    expect(anarchyClientUrl()).toBe('ws://10.0.0.8:2700');
    expect(anarchyStatusUrl()).toBe('http://10.0.0.8:2700/status');
  });

  it('polls production Anarchy status and leaves Survival and Peaceful on local ports', async () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ online: 1, maxPlayers: 300 }) };
    });
    await fetchLocalServerStatuses();
    expect(seen).toEqual([
      PRODUCTION_STATUS,
      'http://127.0.0.1:2568/status',
      'http://127.0.0.1:2569/status',
    ]);
    expect(endpointLabel(clientUrlForServer('anarchy'))).toBe('megacraft.agariobrainrot.ru');
    expect(endpointLabel(clientUrlForServer('survival'))).toBe('localhost');
    expect(endpointLabel(clientUrlForServer('peaceful'))).toBe('localhost');
    expect(endpointLabel('ws://127.0.0.1:2567')).toBe('localhost');
  });

  it('lets anarchyStatus replace the derived production status URL', () => {
    vi.stubEnv('VITE_ANARCHY_URL', PRODUCTION_WS);
    expect(anarchyStatusUrl('?anarchyStatus=http://127.0.0.1:2599/status')).toBe('http://127.0.0.1:2599/status');
    vi.stubGlobal('location', { search: '?anarchyStatus=https://status.example.test/health' });
    expect(anarchyStatusUrl()).toBe('https://status.example.test/health');
    expect(anarchyClientUrl()).toBe(PRODUCTION_WS);
  });
});
