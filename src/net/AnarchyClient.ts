import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  LOCAL_SERVER_PRESETS,
  PROTOCOL_VERSION,
  defaultStatusUrl,
  defaultWsUrl,
  type LocalServerName,
} from '../../shared/config';
import {
  decodeJson,
  encodeMessage,
  parseServerMessage,
  type ClientJoinMessage,
  type ClientMessage,
  type ConnectionState,
  type PlayerAppearance,
  type ServerMessage,
  type ServerWelcomeMessage,
} from '../../shared/protocol';
import { sanitizePlayerName } from '../../shared/playerName';

const SESSION_KEY = 'fc.anarchy.sessionToken';

function readConnectParams(search?: string): URLSearchParams | null {
  if (search !== undefined) return new URLSearchParams(search);
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search);
}

function endpointFromParams(params: URLSearchParams | null): { host: string; port: number } {
  const named = params?.get('server')?.trim().toLowerCase();
  const presetPort = named && named in LOCAL_SERVER_PRESETS
    ? LOCAL_SERVER_PRESETS[named as LocalServerName].port
    : undefined;
  const host = params?.get('anarchyHost') ?? DEFAULT_SERVER_HOST;
  const portRaw = params?.get('anarchyPort');
  const parsed = portRaw == null || portRaw === '' ? undefined : Number(portRaw);
  const port = parsed !== undefined && Number.isFinite(parsed) ? parsed : (presetPort ?? DEFAULT_SERVER_PORT);
  return { host, port };
}

/** Non-empty `anarchyHost` / numeric `anarchyPort` replace the configured default. */
function hasExplicitEndpoint(params: URLSearchParams | null): boolean {
  if (!params) return false;
  const host = params.get('anarchyHost');
  if (host != null && host !== '') return true;
  const portRaw = params.get('anarchyPort');
  return portRaw != null && portRaw !== '' && Number.isFinite(Number(portRaw));
}

/**
 * `VITE_ANARCHY_URL` is the production WebSocket default (`vite build` loads
 * `.env.production`). `npm run dev` does not set it. A missing or empty search
 * uses that default. A non-empty search (`?server=`, `?anarchyHost=`,
 * `?anarchyPort=`) keeps the local presets.
 */
function configuredAnarchyUrl(search: string | undefined): string | undefined {
  if ((search !== undefined && search !== '') || typeof import.meta === 'undefined') return undefined;
  const value = import.meta.env?.VITE_ANARCHY_URL;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `ws://` / `wss://` endpoint → `http://` / `https://` `/status` on the same origin. */
export function statusUrlFromAnarchyWs(wsUrl: string): string {
  let url: URL;
  try {
    url = new URL(wsUrl);
  } catch {
    return defaultStatusUrl();
  }
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  else return defaultStatusUrl();
  url.pathname = '/status';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function anarchyClientUrl(search?: string): string {
  const params = readConnectParams(search);
  const queryUrl = params?.get('anarchyUrl');
  if (queryUrl) return queryUrl;
  if (!hasExplicitEndpoint(params)) {
    const configured = configuredAnarchyUrl(search);
    if (configured) return configured;
  }
  const endpoint = endpointFromParams(params);
  return defaultWsUrl(endpoint.host, endpoint.port);
}

export function anarchyStatusUrl(search?: string): string {
  const params = readConnectParams(search);
  const statusOverride = params?.get('anarchyStatus');
  if (statusOverride) return statusOverride;
  // `?anarchyUrl=` still overrides only the socket. Status stays on host/port
  // unless that query, or `?anarchyStatus=`, says otherwise.
  if (!params?.get('anarchyUrl') && !hasExplicitEndpoint(params)) {
    const configured = configuredAnarchyUrl(search);
    if (configured) return statusUrlFromAnarchyWs(configured);
  }
  const endpoint = endpointFromParams(params);
  return defaultStatusUrl(endpoint.host, endpoint.port);
}

export function isLocalServerName(value: string): value is LocalServerName {
  return Object.prototype.hasOwnProperty.call(LOCAL_SERVER_PRESETS, value);
}

/** Page `?server=` picks the initial card. Unknown or missing values stay on Anarchy. */
export function selectedLocalServer(search?: string): LocalServerName {
  const named = readConnectParams(search)?.get('server')?.trim().toLowerCase();
  return named && isLocalServerName(named) ? named : 'anarchy';
}

export function localServerClientUrl(server: LocalServerName): string {
  return defaultWsUrl(DEFAULT_SERVER_HOST, LOCAL_SERVER_PRESETS[server].port);
}

/**
 * Survival and Peaceful have no production reverse proxy. Their presets stay
 * `127.0.0.1:2568` and `:2569` even when `VITE_ANARCHY_URL` points Anarchy at wss.
 */
export function localServerStatusUrl(server: LocalServerName): string {
  return defaultStatusUrl(DEFAULT_SERVER_HOST, LOCAL_SERVER_PRESETS[server].port);
}

/** Menu badge and loading detail. Local binds stay "localhost"; a public host is shown as itself. */
export function endpointLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') return 'localhost';
    return host;
  } catch {
    return 'localhost';
  }
}

/**
 * Connect URL for one menu card.
 * `?anarchyUrl=`, `?anarchyHost=`, and `?anarchyPort=` override the card that
 * `?server=` (or the Anarchy default) addresses, ahead of `VITE_ANARCHY_URL`.
 * The other cards keep their local presets.
 */
export function clientUrlForServer(server: LocalServerName, search?: string): string {
  if (server === selectedLocalServer(search)) return anarchyClientUrl(search);
  return localServerClientUrl(server);
}

export function statusUrlForServer(server: LocalServerName, search?: string): string {
  if (server === selectedLocalServer(search)) return anarchyStatusUrl(search);
  return localServerStatusUrl(server);
}

export function clientSessionStorageKey(url: string): string {
  return url === defaultWsUrl() ? SESSION_KEY : `fc.session.${url}`;
}

export type AnarchyMessageHandler = (message: ServerMessage) => void;

export class AnarchyClient {
  private socket: WebSocket | null = null;
  private handler: AnarchyMessageHandler | null = null;
  private disconnectHandler: (() => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private intentionalClose = false;
  private generation = 0;
  state: ConnectionState = 'idle';
  lastWelcome: ServerWelcomeMessage | undefined;
  lastError: string | undefined;

  onMessage(handler: AnarchyMessageHandler): void {
    this.handler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  connect(url = anarchyClientUrl(), name?: string, appearance?: PlayerAppearance): Promise<ServerWelcomeMessage> {
    this.disconnect();
    this.state = 'connecting';
    this.lastError = undefined;
    this.intentionalClose = false;
    this.generation += 1;
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const timeout = window.setTimeout(() => {
        if (this.generation !== generation || this.socket !== socket) return;
        this.lastError = 'timeout';
        this.state = 'error';
        socket.close();
        reject(new Error('Сервер недоступен'));
      }, 5000);
      const fail = (message: string): void => {
        if (this.generation !== generation || this.socket !== socket) return;
        window.clearTimeout(timeout);
        this.lastError = message;
        this.state = 'error';
        reject(new Error(message));
      };
      const sessionKey = clientSessionStorageKey(url);
      socket.addEventListener('open', () => {
        if (this.generation !== generation || this.socket !== socket) return;
        const sessionToken = sessionStorage.getItem(sessionKey) ?? undefined;
        this.send(buildAnarchyJoinMessage(name, sessionToken, appearance));
      });
      socket.addEventListener('message', (event) => {
        if (this.generation !== generation || this.socket !== socket) return;
        const parseStart = performance.now();
        const rawText = String(event.data);
        let payload: ServerMessage;
        try {
          const parsed = parseServerMessage(decodeJson(rawText));
          if ('error' in parsed) {
            console.warn('[anarchy] invalid server message:', parsed.error);
            return;
          }
          payload = parsed;
        } catch {
          console.warn('[anarchy] invalid server JSON');
          return;
        }
        const parseMs = performance.now() - parseStart;
        if (payload.type === 'welcome') {
          window.clearTimeout(timeout);
          this.lastWelcome = payload;
          this.state = 'connected';
          sessionStorage.setItem(sessionKey, payload.sessionToken);
          this.startPing();
          if (typeof console !== 'undefined') {
            console.info(
              `[reconnectLoad] welcome parse=${parseMs.toFixed(1)}ms bytes=${rawText.length} `
              + `modChunks=${Object.keys(payload.modifications ?? {}).length}`,
            );
          }
          resolve(payload);
        } else if (payload.type === 'error' && this.state === 'connecting') {
          fail(payload.message || 'Сервер недоступен');
          return;
        }
        this.handler?.(payload);
      });
      socket.addEventListener('error', () => {
        if (this.generation !== generation || this.socket !== socket) return;
        if (this.state === 'connecting') fail('Сервер недоступен');
        else this.state = 'error';
      });
      socket.addEventListener('close', () => {
        if (this.generation !== generation) return;
        this.stopPing();
        if (this.state === 'connecting') fail('Сервер недоступен');
        else if (this.state === 'connected') {
          this.state = 'disconnected';
          if (!this.intentionalClose) this.disconnectHandler?.();
        }
      });
    });
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(message));
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopPing();
    this.generation += 1;
    this.handler = null;
    this.disconnectHandler = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (this.state === 'connected') this.state = 'disconnected';
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', t: performance.now() });
    }, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}

export function buildAnarchyJoinMessage(
  name?: string,
  sessionToken?: string,
  appearance?: PlayerAppearance,
): ClientJoinMessage {
  const sanitized = sanitizePlayerName(name);
  return {
    type: 'join',
    protocol: PROTOCOL_VERSION,
    ...(sanitized ? { name: sanitized } : {}),
    ...(sessionToken ? { sessionToken } : {}),
    ...(appearance ? {
      appearance: {
        skinId: appearance.skinId,
        model: appearance.model,
        layers: appearance.layers,
      },
    } : {}),
  };
}

export async function fetchStatusAt(url: string): Promise<{
  reachable: boolean;
  online: number;
  maxPlayers: number;
  name?: string;
}> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { reachable: false, online: 0, maxPlayers: 0 };
    const json = await response.json() as { online?: number; maxPlayers?: number; name?: string };
    return {
      reachable: true,
      online: Number(json.online) || 0,
      maxPlayers: Number(json.maxPlayers) || 0,
      name: json.name,
    };
  } catch {
    return { reachable: false, online: 0, maxPlayers: 0 };
  }
}

export async function fetchAnarchyStatus(): Promise<{
  reachable: boolean;
  online: number;
  maxPlayers: number;
  name?: string;
}> {
  return fetchStatusAt(anarchyStatusUrl());
}

export async function fetchLocalServerStatuses(
  search?: string,
): Promise<Record<LocalServerName, { reachable: boolean; online: number; maxPlayers: number }>> {
  const names = Object.keys(LOCAL_SERVER_PRESETS) as LocalServerName[];
  const pairs = await Promise.all(names.map(async (id) => {
    // Anarchy follows VITE_ANARCHY_URL. Survival and Peaceful stay on their local ports.
    const status = await fetchStatusAt(statusUrlForServer(id, search));
    return [id, { reachable: status.reachable, online: status.online, maxPlayers: status.maxPlayers }] as const;
  }));
  return Object.fromEntries(pairs) as Record<LocalServerName, { reachable: boolean; online: number; maxPlayers: number }>;
}
