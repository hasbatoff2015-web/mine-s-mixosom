import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  defaultStatusUrl,
  defaultWsUrl,
} from '../../shared/config';
import {
  decodeJson,
  encodeMessage,
  parseServerMessage,
  type ClientMessage,
  type ConnectionState,
  type ServerMessage,
  type ServerWelcomeMessage,
} from '../../shared/protocol';

const SESSION_KEY = 'fc.anarchy.sessionToken';

export function anarchyClientUrl(): string {
  const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
  const override = params?.get('anarchyUrl')
    ?? (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ANARCHY_URL as string | undefined : undefined);
  if (override) return override;
  const host = params?.get('anarchyHost') ?? DEFAULT_SERVER_HOST;
  const port = Number(params?.get('anarchyPort') ?? DEFAULT_SERVER_PORT);
  return defaultWsUrl(host, Number.isFinite(port) ? port : DEFAULT_SERVER_PORT);
}

export function anarchyStatusUrl(): string {
  const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
  const override = params?.get('anarchyStatus');
  if (override) return override;
  const host = params?.get('anarchyHost') ?? DEFAULT_SERVER_HOST;
  const port = Number(params?.get('anarchyPort') ?? DEFAULT_SERVER_PORT);
  return defaultStatusUrl(host, Number.isFinite(port) ? port : DEFAULT_SERVER_PORT);
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

  connect(url = anarchyClientUrl(), name?: string): Promise<ServerWelcomeMessage> {
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
      socket.addEventListener('open', () => {
        if (this.generation !== generation || this.socket !== socket) return;
        const sessionToken = sessionStorage.getItem(SESSION_KEY) ?? undefined;
        this.send({
          type: 'join',
          protocol: 1,
          ...(name ? { name } : {}),
          ...(sessionToken ? { sessionToken } : {}),
        });
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
          sessionStorage.setItem(SESSION_KEY, payload.sessionToken);
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

export async function fetchAnarchyStatus(): Promise<{
  reachable: boolean;
  online: number;
  maxPlayers: number;
  name?: string;
}> {
  try {
    const response = await fetch(anarchyStatusUrl(), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { reachable: false, online: 0, maxPlayers: 300 };
    const json = await response.json() as { online?: number; maxPlayers?: number; name?: string };
    return {
      reachable: true,
      online: Number(json.online) || 0,
      maxPlayers: Number(json.maxPlayers) || 300,
      name: json.name,
    };
  } catch {
    return { reachable: false, online: 0, maxPlayers: 300 };
  }
}
