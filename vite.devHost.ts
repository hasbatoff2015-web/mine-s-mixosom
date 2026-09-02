/**
 * Vite client bind. Default stays loopback-only (`localhost`).
 * LAN / Radmin VPN QA: `FC_DEV_HOST=0.0.0.0` (alias `FC_VITE_HOST`).
 * Do not leave this on 0.0.0.0 in production or ordinary local play.
 */
export function resolveViteDevServer(env: NodeJS.ProcessEnv = process.env): {
  host: string | boolean;
  allowedHosts?: true;
} {
  const raw = (env.FC_DEV_HOST || env.FC_VITE_HOST || '').trim();
  if (!raw) {
    return { host: 'localhost' };
  }
  const host: string | boolean = raw === 'true' ? true : raw;
  const bind = host === true ? '0.0.0.0' : String(host);
  const wildcard = host === true || bind === '0.0.0.0' || bind === '::' || bind === '[::]';
  return wildcard ? { host, allowedHosts: true } : { host };
}
