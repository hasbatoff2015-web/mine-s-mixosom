import { describe, expect, it } from 'vitest';
import { resolveViteDevServer } from '../vite.devHost';

describe('Vite dev host', () => {
  it('defaults to localhost and does not open all interfaces', () => {
    expect(resolveViteDevServer({})).toEqual({ host: 'localhost' });
    expect(resolveViteDevServer({ FC_DEV_HOST: '', FC_VITE_HOST: '  ' })).toEqual({ host: 'localhost' });
  });

  it('opts into 0.0.0.0 and allows non-localhost Host headers', () => {
    expect(resolveViteDevServer({ FC_DEV_HOST: '0.0.0.0' })).toEqual({
      host: '0.0.0.0',
      allowedHosts: true,
    });
    expect(resolveViteDevServer({ FC_VITE_HOST: 'true' })).toEqual({
      host: true,
      allowedHosts: true,
    });
  });

  it('prefers FC_DEV_HOST and trims PowerShell-style values', () => {
    expect(resolveViteDevServer({
      FC_DEV_HOST: '  0.0.0.0  ',
      FC_VITE_HOST: '127.0.0.1',
    })).toEqual({
      host: '0.0.0.0',
      allowedHosts: true,
    });
    expect(resolveViteDevServer({ FC_DEV_HOST: '127.0.0.1' })).toEqual({ host: '127.0.0.1' });
  });
});
