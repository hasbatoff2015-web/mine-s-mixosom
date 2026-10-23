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
const STATUS_TIMEOUT_MS = 1500;

export type ServerReachFailure = 'timeout' | 'network' | 'http' | 'invalid_response' | 'not_ready';

/** Result of one status probe. `aborted` is internal and must not be shown. */
export type ServerCardStatus =
  | { phase: 'checking' }
  | { phase: 'available'; online: number; maxPlayers: number; name?: string }
  | { phase: 'unavailable'; reason: ServerReachFailure }
  | { phase: 'not_configured' }
  | { phase: 'aborted' };

export type ServerStatusMap = Record<LocalServerName, ServerCardStatus>;

const PUBLIC_URL_ENV: Record<LocalServerName, 'VITE_ANARCHY_URL' | 'VITE_SURVIVAL_URL' | 'VITE_PEACEFUL_URL'> = {
  anarchy: 'VITE_ANARCHY_URL',
  survival: 'VITE_SURVIVAL_URL',
  peaceful: 'VITE_PEACEFUL_URL',
};

export function checkingServerStatuses(): ServerStatusMap {
  return {
    anarchy: { phase: 'checking' },
    survival: { phase: 'checking' },
    peaceful: { phase: 'checking' },
  };
}

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

function readPublicUrl(server: LocalServerName): string | undefined {
  if (typeof import.meta === 'undefined') return undefined;
  const value = import.meta.env?.[PUBLIC_URL_ENV[server]];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Dev presets stay only when this client has no public endpoint at all. */
function localPresetsAllowed(): boolean {
  if (import.meta.env.PROD) return false;
  return (Object.keys(PUBLIC_URL_ENV) as LocalServerName[]).every((server) => readPublicUrl(server) === undefined);
}

/**
 * `?anarchyUrl=`, `?anarchyHost=` and `?anarchyPort=` override only the card
 * selected by `?server=` (Anarchy when that param is absent). `?server=` by
 * itself only picks the initial card.
 */
function explicitCardOverride(server: LocalServerName, search?: string): string | undefined {
  const params = readConnectParams(search);
  if (!params || server !== selectedLocalServer(search)) return undefined;
  const queryUrl = params.get('anarchyUrl');
  if (queryUrl) return queryUrl;
  if (!hasExplicitEndpoint(params)) return undefined;
  const endpoint = endpointFromParams(params);
  return defaultWsUrl(endpoint.host, endpoint.port);
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

export function anarchyClientUrl(search?: string): string | undefined {
  return clientUrlForServer('anarchy', search);
}

export function anarchyStatusUrl(search?: string): string | undefined {
  return statusUrlForServer('anarchy', search);
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

/** Dev-only loopback status. Production cards never fall through to this. */
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
 * WebSocket for one menu card.
 * Order: explicit developer override for that card, then its public env URL,
 * then the dev loopback preset. A public client with no URL for this card
 * returns undefined so the menu can show "not configured" instead of localhost.
 */
export function clientUrlForServer(server: LocalServerName, search?: string): string | undefined {
  const override = explicitCardOverride(server, search);
  if (override) return override;
  const configured = readPublicUrl(server);
  if (configured) return configured;
  if (!localPresetsAllowed()) return undefined;
  return localServerClientUrl(server);
}

/**
 * Status URL for the same card as `clientUrlForServer`.
 * `?anarchyStatus=` replaces it. `?anarchyUrl=` still overrides only the socket:
 * status stays on the host/port endpoint unless `?anarchyStatus=` is set.
 * Undefined means the card has no public endpoint and must not be fetched.
 */
export function statusUrlForServer(server: LocalServerName, search?: string): string | undefined {
  const params = readConnectParams(search);
  if (params && server === selectedLocalServer(search)) {
    const statusOverride = params.get('anarchyStatus');
    if (statusOverride) return statusOverride;
    if (params.get('anarchyUrl')) {
      const endpoint = endpointFromParams(params);
      return defaultStatusUrl(endpoint.host, endpoint.port);
    }
  }
  const wsUrl = clientUrlForServer(server, search);
  if (!wsUrl) return undefined;
  return statusUrlFromAnarchyWs(wsUrl);
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
    if (!url) {
      this.state = 'error';
      this.lastError = 'not_configured';
      return Promise.reject(new Error('Сервер недоступен'));
    }
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

/** Present, finite, non-negative integer. Missing values are not treated as zero. */
function readPlayerCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * `GET /status` from AnarchyServer.handleHttp.
 * Available only when the world is ready and both counts are present integers.
 */
function statusFromBody(json: unknown): ServerCardStatus {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { phase: 'unavailable', reason: 'invalid_response' };
  }
  const body = json as { ready?: unknown; online?: unknown; maxPlayers?: unknown; name?: unknown };
  if (body.ready === false) return { phase: 'unavailable', reason: 'not_ready' };
  if (body.ready !== true) return { phase: 'unavailable', reason: 'invalid_response' };
  const online = readPlayerCount(body.online);
  const maxPlayers = readPlayerCount(body.maxPlayers);
  if (online === undefined || maxPlayers === undefined || maxPlayers <= 0 || online > maxPlayers) {
    return { phase: 'unavailable', reason: 'invalid_response' };
  }
  return {
    phase: 'available',
    online,
    maxPlayers,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
  };
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  const name = String(error.name);
  return name === 'AbortError' || name === 'TimeoutError';
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * One HTTP status check.
 * HTTP 200 is available only for `{ ready: true, online, maxPlayers }` with integer counts.
 * `ready: false` is `not_ready`. A caller abort returns `aborted` and is not a player-facing error.
 */
export async function fetchStatusAt(
  url: string,
  signal?: AbortSignal,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<ServerCardStatus> {
  if (signal?.aborted) return { phase: 'aborted' };
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { signal: combineAbortSignals([timeoutSignal, ...(signal ? [signal] : [])]) });
    if (signal?.aborted) return { phase: 'aborted' };
    if (!response.ok) return { phase: 'unavailable', reason: 'http' };
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { phase: 'unavailable', reason: 'invalid_response' };
    }
    return statusFromBody(json);
  } catch (error) {
    if (signal?.aborted) return { phase: 'aborted' };
    if (timeoutSignal.aborted || (isAbortLike(error) && (error as { name?: string }).name === 'TimeoutError')) {
      return { phase: 'unavailable', reason: 'timeout' };
    }
    if (isAbortLike(error)) return { phase: 'aborted' };
    return { phase: 'unavailable', reason: 'network' };
  }
}

export async function fetchAnarchyStatus(signal?: AbortSignal): Promise<ServerCardStatus> {
  const url = anarchyStatusUrl();
  if (!url) return { phase: 'not_configured' };
  return fetchStatusAt(url, signal);
}

export async function fetchLocalServerStatuses(
  search?: string,
  signal?: AbortSignal,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<ServerStatusMap> {
  if (signal?.aborted) {
    return {
      anarchy: { phase: 'aborted' },
      survival: { phase: 'aborted' },
      peaceful: { phase: 'aborted' },
    };
  }
  const names = Object.keys(LOCAL_SERVER_PRESETS) as LocalServerName[];
  const pairs = await Promise.all(names.map(async (id) => {
    const url = statusUrlForServer(id, search);
    if (!url) return [id, { phase: 'not_configured' } as const] as const;
    return [id, await fetchStatusAt(url, signal, timeoutMs)] as const;
  }));
  return Object.fromEntries(pairs) as ServerStatusMap;
}

/** One in-flight status probe. A newer load or cancel makes the old result unusable. */
export class ServerStatusSession {
  private generation = 0;
  private controller: AbortController | undefined;

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = undefined;
  }

  /**
   * Fetches all three cards. Aborts the previous load.
   * Returns undefined when this load is no longer current, including abort.
   */
  async load(search?: string, timeoutMs = STATUS_TIMEOUT_MS): Promise<ServerStatusMap | undefined> {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const statuses = await fetchLocalServerStatuses(search, controller.signal, timeoutMs);
    if (generation !== this.generation || controller.signal.aborted) return undefined;
    if ((Object.values(statuses) as ServerCardStatus[]).some((status) => status.phase === 'aborted')) return undefined;
    return statuses;
  }
}

/**
 * Opens one socket attempt. The caller paints loading and, on failure, a screen
 * whose retry callback starts a new attempt. There is no automatic reconnect loop.
 */
export async function runOnlineConnectAttempt(options: {
  url: string;
  connect: (url: string) => Promise<void>;
  onLoading: (url: string) => void;
  onFailure: (retry: () => void) => void;
}): Promise<boolean> {
  options.onLoading(options.url);
  try {
    await options.connect(options.url);
    return true;
  } catch {
    options.onFailure(() => {
      void runOnlineConnectAttempt(options);
    });
    return false;
  }
}
