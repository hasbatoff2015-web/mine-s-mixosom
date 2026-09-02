import { describe, expect, it } from 'vitest';
import { resolveAnarchyHost, resolveAnarchyStatusUrl, resolveAnarchyWsUrl } from '../src/net/anarchyUrls';

describe('Anarchy client URL', () => {
  it('keeps localhost / 127.0.0.1 on 127.0.0.1:2567', () => {
    expect(resolveAnarchyWsUrl()).toBe('ws://127.0.0.1:2567');
    expect(resolveAnarchyWsUrl({ pageHostname: 'localhost', isDev: true })).toBe('ws://127.0.0.1:2567');
    expect(resolveAnarchyWsUrl({ pageHostname: '127.0.0.1', isDev: true })).toBe('ws://127.0.0.1:2567');
    expect(resolveAnarchyStatusUrl()).toBe('http://127.0.0.1:2567/status');
  });

  it('does not follow a production page host', () => {
    expect(resolveAnarchyWsUrl({
      pageHostname: 'app.s3.yandex.net',
      isDev: false,
    })).toBe('ws://127.0.0.1:2567');
  });

  it('uses the Vite DEV page hostname for LAN / Radmin', () => {
    expect(resolveAnarchyHost({ pageHostname: '26.10.20.30', isDev: true })).toBe('26.10.20.30');
    expect(resolveAnarchyWsUrl({ pageHostname: '26.10.20.30', isDev: true })).toBe('ws://26.10.20.30:2567');
    expect(resolveAnarchyStatusUrl({ pageHostname: '26.10.20.30', isDev: true }))
      .toBe('http://26.10.20.30:2567/status');
  });

  it('lets query overrides win', () => {
    expect(resolveAnarchyWsUrl({
      search: '?anarchyHost=26.1.2.3&anarchyPort=2567',
      pageHostname: '127.0.0.1',
      isDev: true,
    })).toBe('ws://26.1.2.3:2567');
    expect(resolveAnarchyWsUrl({
      search: '?anarchyUrl=ws://26.1.2.3:2567',
    })).toBe('ws://26.1.2.3:2567');
    expect(resolveAnarchyWsUrl({ envUrl: 'ws://10.0.0.8:2567' })).toBe('ws://10.0.0.8:2567');
  });
});
