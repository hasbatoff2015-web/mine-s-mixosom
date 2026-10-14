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
import {
  confirmGuestWelcome,
  guestScopeKey,
  isGuestToken,
  legacySessionStorageKey,
  planGuestJoin,
  readGuestStore,
  withGuestScopeLock,
  type GuestIdentityScope,
  type GuestJoinPlan,
  type GuestStorage,
} from './guestIdentityStorage';

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
  return legacySessionStorageKey(url, defaultWsUrl());
}

function stripGuestOverrides(search?: string): string {
  const params = new URLSearchParams(search ?? '');
  params.delete('anarchyUrl');
  params.delete('anarchyHost');
  params.delete('anarchyPort');
  const text = params.toString();
  return text ? `?${text}` : '';
}

function normalizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** A saved guest token is sent only when the socket is the canonical endpoint for that menu card. */
export function guestEndpointTrusted(connectUrl: string, target: LocalServerName, search?: string): boolean {
  const canonical = clientUrlForServer(target, stripGuestOverrides(search));
  return normalizeEndpoint(connectUrl) === normalizeEndpoint(canonical);
}

function browserStore(kind: 'local' | 'session'): GuestStorage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    if (!store) return null;
    return store;
  } catch {
    return null;
  }
}

async function fetchIdentityStatus(
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; ready?: boolean; mode?: string; world?: string }> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return { ok: false };
    const json = await response.json() as { ready?: unknown; mode?: unknown; world?: unknown };
    if (json.ready !== true || typeof json.mode !== 'string' || typeof json.world !== 'string' || json.world.trim() === '') {
      return { ok: false };
    }
    return { ok: true, ready: true, mode: json.mode, world: json.world };
  } catch {
    return { ok: false };
  }
}

export interface GuestConnectOptions {
  readonly freshGuest?: boolean;
  readonly allowEphemeral?: boolean;
  readonly search?: string;
  readonly hostname?: string;
  readonly targetServer?: LocalServerName;
  readonly fetchStatus?: (url: string, signal: AbortSignal) => Promise<{ ok: boolean; ready?: boolean; mode?: string; world?: string }>;
  readonly durable?: GuestStorage | null;
  readonly legacy?: GuestStorage | null;
  readonly scopeLock?: <T>(scope: GuestIdentityScope, body: () => Promise<T>) => Promise<T>;
}

function cancelledJoin(): Error {
  return Object.assign(new Error('Подключение отменено'), { code: 'cancelled' });
}

function browserLocks(): { request<T>(name: string, callback: () => Promise<T>): Promise<T> } | undefined {
  const locks = (globalThis as { navigator?: { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } } }).navigator?.locks;
  return locks;
}

export type AnarchyMessageHandler = (message: ServerMessage) => void;

export class AnarchyClient {
  private socket: WebSocket | null = null;
  private handler: AnarchyMessageHandler | null = null;
  private disconnectHandler: (() => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private intentionalClose = false;
  private generation = 0;
  private identityAbort: AbortController | null = null;
  state: ConnectionState = 'idle';
  lastWelcome: ServerWelcomeMessage | undefined;
  lastError: string | undefined;
  lastErrorCode: string | undefined;
  identityWarning: 'storage' | 'other-world' | undefined;
  identityPersisted = false;

  onMessage(handler: AnarchyMessageHandler): void {
    this.handler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  connect(
    url = anarchyClientUrl(),
    name?: string,
    appearance?: PlayerAppearance,
    options?: GuestConnectOptions,
  ): Promise<ServerWelcomeMessage> {
    this.disconnect();
    this.state = 'connecting';
    this.lastError = undefined;
    this.lastErrorCode = undefined;
    this.identityWarning = undefined;
    this.identityPersisted = false;
    this.intentionalClose = false;
    this.generation += 1;
    const generation = this.generation;
    const abort = new AbortController();
    this.identityAbort = abort;
    const search = options?.search ?? (typeof location === 'undefined' ? '' : location.search);
    const hostname = options?.hostname ?? (typeof location === 'undefined' ? 'localhost' : location.hostname);
    const target = options?.targetServer ?? selectedLocalServer(search);
    const durable = options?.durable === undefined ? browserStore('local') : options.durable;
    const legacy = options?.legacy === undefined ? browserStore('session') : options.legacy;
    return this.planJoin(url, search, hostname, target, Boolean(options?.freshGuest), Boolean(options?.allowEphemeral), generation, abort.signal, options?.fetchStatus, durable, legacy)
      .then((plan) => {
        if (this.generation !== generation) return Promise.reject(cancelledJoin());
        if (plan.outcome === 'cancelled') return Promise.reject(cancelledJoin());
        if (plan.outcome !== 'ready_existing' && plan.outcome !== 'ready_new' && plan.outcome !== 'untrusted') {
          const message = 'message' in plan ? plan.message : 'Подключение остановлено';
          this.lastError = message;
          this.lastErrorCode = plan.outcome;
          this.state = 'error';
          return Promise.reject(Object.assign(new Error(message), { code: plan.outcome }));
        }
        const open = (): Promise<ServerWelcomeMessage> => this.openSocket(url, name, appearance, plan, generation, durable, legacy);
        if (plan.outcome === 'ready_new' && plan.scope && !plan.ephemeral) {
          const lock = options?.scopeLock
            ?? ((scope, body) => withGuestScopeLock(scope, body, browserLocks()));
          return lock(plan.scope, async () => {
            if (this.generation !== generation) throw cancelledJoin();
            const reread = durable ? readGuestStore(durable) : { kind: 'absent' as const };
            if (reread.kind === 'valid') {
              const row = reread.file.records[guestScopeKey(plan.scope!)];
              if (row && isGuestToken(row.sessionToken)) {
                return this.openSocket(url, name, appearance, {
                  ...plan,
                  outcome: 'ready_existing',
                  sendToken: row.sessionToken,
                  freshGuest: false,
                }, generation, durable, legacy);
              }
            }
            return open();
          });
        }
        return open();
      });
  }

  private openSocket(
    url: string,
    name: string | undefined,
    appearance: PlayerAppearance | undefined,
    plan: Extract<GuestJoinPlan, { outcome: 'ready_existing' | 'ready_new' | 'untrusted' }>,
    generation: number,
    durable: GuestStorage | null,
    legacy: GuestStorage | null,
  ): Promise<ServerWelcomeMessage> {
    if (this.generation !== generation) return Promise.reject(cancelledJoin());
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const timeout = globalThis.setTimeout(() => {
        if (this.generation !== generation || this.socket !== socket) return;
        this.lastError = 'timeout';
        this.lastErrorCode = 'timeout';
        this.state = 'error';
        socket.close();
        reject(new Error('Сервер недоступен'));
      }, 5000);
      const fail = (message: string, code?: string): void => {
        if (this.generation !== generation || this.socket !== socket) return;
        globalThis.clearTimeout(timeout);
        this.lastError = message;
        this.lastErrorCode = code;
        this.state = 'error';
        reject(Object.assign(new Error(message), code ? { code } : {}));
      };
      socket.addEventListener('open', () => {
        if (this.generation !== generation || this.socket !== socket) return;
        this.send(buildAnarchyJoinMessage(name, plan.outcome === 'untrusted' ? undefined : plan.sendToken, appearance, plan.outcome === 'ready_new' && plan.freshGuest));
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
          globalThis.clearTimeout(timeout);
          if (plan.outcome !== 'untrusted' && plan.scope && payload.worldId !== plan.scope.worldId) {
            fail('Сервер открыл другой мир. Прежний ключ не записан.', 'world_mismatch');
            socket.close();
            return;
          }
          this.lastWelcome = payload;
          this.state = 'connected';
          if (plan.outcome !== 'untrusted' && plan.scope && !plan.ephemeral) {
            const saved = confirmGuestWelcome(durable, legacy, plan.scope, payload.sessionToken, plan.legacyKeys);
            this.identityPersisted = saved.persisted;
            if (!saved.persisted) this.identityWarning = 'storage';
          }
          this.startPing();
          if (typeof console !== 'undefined') {
            console.info(
              `[reconnectLoad] welcome parse=${parseMs.toFixed(1)}ms bytes=${rawText.length} `
              + `modChunks=${Object.keys(payload.modifications ?? {}).length}`,
            );
          }
          resolve(payload);
        } else if (payload.type === 'error' && this.state === 'connecting') {
          fail(payload.message || 'Сервер недоступен', payload.code);
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

  private async planJoin(
    url: string,
    search: string,
    hostname: string,
    target: LocalServerName,
    freshGuest: boolean,
    allowEphemeral: boolean,
    generation: number,
    signal: AbortSignal,
    fetchStatus: GuestConnectOptions['fetchStatus'],
    durable: GuestStorage | null,
    legacy: GuestStorage | null,
  ): Promise<GuestJoinPlan | { outcome: 'cancelled' }> {
    if (this.generation !== generation) return { outcome: 'cancelled' };
    const trusted = guestEndpointTrusted(url, target, search);
    if (!trusted) {
      return planGuestJoin({
        trusted: false,
        freshGuest,
        allowEphemeral,
        targetMode: target,
        hostname,
        status: { ok: false },
        durable: null,
        legacy: null,
        legacyKeys: [],
      });
    }
    const statusUrl = statusUrlForServer(target, search);
    const status = fetchStatus
      ? await fetchStatus(statusUrl, signal)
      : await fetchIdentityStatus(statusUrl, signal);
    if (this.generation !== generation || signal.aborted) return { outcome: 'cancelled' };
    const canonical = clientUrlForServer(target, stripGuestOverrides(search));
    const legacyKeys = [...new Set([
      legacySessionStorageKey(url, defaultWsUrl()),
      legacySessionStorageKey(canonical, defaultWsUrl()),
    ])];
    return planGuestJoin({
      trusted: true,
      freshGuest,
      allowEphemeral,
      targetMode: target,
      hostname,
      status,
      durable,
      legacy,
      legacyKeys,
    });
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(message));
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.identityAbort?.abort();
    this.identityAbort = null;
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
  freshGuest?: boolean,
): ClientJoinMessage {
  const sanitized = sanitizePlayerName(name);
  return {
    type: 'join',
    protocol: PROTOCOL_VERSION,
    ...(sanitized ? { name: sanitized } : {}),
    ...(freshGuest ? { freshGuest: true } : {}),
    ...(!freshGuest && sessionToken ? { sessionToken } : {}),
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
