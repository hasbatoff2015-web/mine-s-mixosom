import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { AnarchyClient, yandexCredentialEndpointTrusted } from '../src/net/AnarchyClient';
import type { GuestStorage } from '../src/net/guestIdentityStorage';

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function memoryStorage(): GuestStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()],
  };
}

async function listen(): Promise<{ url: string; messages: string[] }> {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  servers.push(wss);
  const messages: string[] = [];
  wss.on('connection', (socket) => {
    socket.on('message', (data) => messages.push(String(data)));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const address = http.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${address.port}`, messages };
}

describe('yandex proof endpoint trust', () => {
  it('accepts loopback canonical sockets and rejects query overrides and remote ws', () => {
    expect(yandexCredentialEndpointTrusted('ws://127.0.0.1:2567', 'anarchy', '')).toBe(true);
    expect(yandexCredentialEndpointTrusted('ws://127.0.0.1:2568', 'survival', '')).toBe(true);
    expect(yandexCredentialEndpointTrusted('ws://127.0.0.1:2569', 'peaceful', '')).toBe(true);
    expect(yandexCredentialEndpointTrusted('ws://127.0.0.1:9', 'anarchy', '?anarchyUrl=ws://127.0.0.1:9')).toBe(false);
    expect(yandexCredentialEndpointTrusted('ws://evil.test:2567', 'anarchy', '?anarchyHost=evil.test')).toBe(false);
    expect(yandexCredentialEndpointTrusted('ws://127.0.0.1:9', 'anarchy', '?anarchyPort=9')).toBe(false);
    expect(yandexCredentialEndpointTrusted('ws://example.test:443', 'anarchy', '')).toBe(false);
  });

  it('does not send a resume proof or a guest token to an overridden socket', async () => {
    const { url, messages } = await listen();
    const storage = memoryStorage();
    storage.setItem('fc.guest.v2/local/anarchy/anarchy', JSON.stringify({ version: 2, sessionToken: '11111111-1111-4111-8111-111111111111' }));
    const client = new AnarchyClient();
    await expect(client.connect(url, 'Ada', undefined, {
      targetServer: 'anarchy',
      hostname: 'localhost',
      search: `?anarchyUrl=${encodeURIComponent(url)}`,
      durable: storage,
      legacy: storage,
      yandexResume: { proof: 'signed-proof-value' },
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' }),
    })).rejects.toMatchObject({ code: 'untrusted_endpoint' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(messages.join('\n')).not.toContain('signed-proof-value');
    expect(messages.join('\n')).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(storage.getItem('fc.guest.v2/local/anarchy/anarchy')).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('does not send an automatic Yandex proof to an overridden socket', async () => {
    const { url, messages } = await listen();
    const storage = memoryStorage();
    const client = new AnarchyClient();
    await expect(client.connect(url, 'Ada', undefined, {
      targetServer: 'anarchy',
      hostname: 'localhost',
      search: `?anarchyUrl=${encodeURIComponent(url)}`,
      durable: storage,
      legacy: storage,
      yandexResume: { proof: 'automatic-proof-value', mode: 'yandex_auto' },
      fetchStatus: async () => ({ ok: true, ready: true, mode: 'anarchy', world: 'anarchy' }),
    })).rejects.toMatchObject({ code: 'untrusted_endpoint' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(messages.join('\n')).not.toContain('automatic-proof-value');
    expect(storage.keys()).toEqual([]);
  });
});
