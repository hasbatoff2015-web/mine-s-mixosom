import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '../../shared/config';
import {
  connectableServerHost,
  isWildcardBindHost,
  loadServerConfig,
  resolveServerHost,
} from '../../server/config';

describe('Anarchy server bind host', () => {
  it('defaults to loopback 127.0.0.1', () => {
    expect(resolveServerHost({})).toBe(DEFAULT_SERVER_HOST);
    expect(loadServerConfig({}, '/tmp').host).toBe('127.0.0.1');
    expect(loadServerConfig({}, '/tmp').port).toBe(DEFAULT_SERVER_PORT);
  });

  it('reads FC_SERVER_HOST and keeps 0.0.0.0 as a wildcard bind', () => {
    expect(resolveServerHost({ FC_SERVER_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(isWildcardBindHost('0.0.0.0')).toBe(true);
    expect(connectableServerHost('0.0.0.0')).toBe('127.0.0.1');
  });

  it('prefers FC_SERVER_HOST over FC_HOST and HOST', () => {
    expect(resolveServerHost({
      FC_SERVER_HOST: '0.0.0.0',
      FC_HOST: '10.0.0.2',
      HOST: '192.168.0.2',
    })).toBe('0.0.0.0');
    expect(resolveServerHost({ FC_HOST: '10.0.0.2', HOST: '192.168.0.2' })).toBe('10.0.0.2');
    expect(resolveServerHost({ HOST: '192.168.0.2' })).toBe('192.168.0.2');
  });

  it('trims values and ignores empty Windows-style assignments', () => {
    expect(resolveServerHost({ FC_SERVER_HOST: '  0.0.0.0  ' })).toBe('0.0.0.0');
    expect(resolveServerHost({ FC_SERVER_HOST: '', FC_HOST: '127.0.0.1' })).toBe('127.0.0.1');
    expect(resolveServerHost({ FC_SERVER_HOST: '   ', HOST: '127.0.0.1' })).toBe('127.0.0.1');
  });
});
