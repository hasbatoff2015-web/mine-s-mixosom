import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  defaultStatusUrl,
  defaultWsUrl,
} from '../../shared/config';

const LOOPBACK_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]']);

export interface AnarchyUrlInput {
  readonly search?: string | null;
  readonly pageHostname?: string | null;
  readonly envUrl?: string | null;
  readonly isDev?: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

/**
 * Default Anarchy host for this page.
 * Production/Yandex keeps `127.0.0.1`. Vite DEV opened via a LAN/VPN address
 * uses that page hostname so a second PC does not need `?anarchyHost=`.
 * Query `anarchyHost` always wins.
 */
export function resolveAnarchyHost(input: AnarchyUrlInput = {}): string {
  const params = new URLSearchParams(input.search ?? '');
  const queryHost = params.get('anarchyHost')?.trim();
  if (queryHost) return queryHost;
  const pageHostname = (input.pageHostname ?? '').trim();
  if (input.isDev && pageHostname && !isLoopbackHostname(pageHostname)) {
    return pageHostname;
  }
  return DEFAULT_SERVER_HOST;
}

export function resolveAnarchyPort(search?: string | null): number {
  const params = new URLSearchParams(search ?? '');
  const port = Number(params.get('anarchyPort') ?? DEFAULT_SERVER_PORT);
  return Number.isFinite(port) ? port : DEFAULT_SERVER_PORT;
}

export function resolveAnarchyWsUrl(input: AnarchyUrlInput = {}): string {
  const params = new URLSearchParams(input.search ?? '');
  const override = params.get('anarchyUrl') ?? input.envUrl ?? undefined;
  if (override) return override;
  return defaultWsUrl(resolveAnarchyHost(input), resolveAnarchyPort(input.search));
}

export function resolveAnarchyStatusUrl(input: AnarchyUrlInput = {}): string {
  const params = new URLSearchParams(input.search ?? '');
  const override = params.get('anarchyStatus');
  if (override) return override;
  return defaultStatusUrl(resolveAnarchyHost(input), resolveAnarchyPort(input.search));
}
