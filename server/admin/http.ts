import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { serverLog } from '../log';
import { adminAssetIndex, readAdminAsset } from './assets';
import { PanelHttpError, type AdminPanelApi } from './panelHost';
import { AdminControlDisabledError, AdminIdentityError } from './errors';
import {
  resolveAdminCredential,
  type AdminCredential,
} from './credentials';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_IDLE_MS,
  AdminSessionStore,
  type AdminSession,
} from './session';
import type { AdminPlayerSnapshot } from './inspection';

const MAX_BODY_BYTES = 4096;
const LOGIN_FAILURE_LIMIT = 8;
const LOGIN_WINDOW_MS = 60_000;
const LOG_INTERVAL_MS = 60_000;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface AdminHttpOptions {
  readonly port: number;
  readonly credentials: readonly [AdminCredential, AdminCredential];
  readonly inspect: (adminId: string, playerId: string) => AdminPlayerSnapshot | null;
  readonly describe: () => { readonly serverMode: string; readonly worldId: string };
  readonly assetsRoot?: string;
  readonly panel?: AdminPanelApi;
  readonly startedAt?: number;
  readonly now?: () => number;
  readonly idleMs?: number;
  readonly absoluteMs?: number;
  readonly maxSessions?: number;
  readonly loginFailureLimit?: number;
  readonly loginWindowMs?: number;
}

interface BoundAddress {
  readonly address: string;
  readonly port: number;
}

class HttpReply {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {}
}

/** One process-wide counter. Loopback has no useful client address. */
export class LoginRateLimit {
  private readonly failures: number[] = [];

  constructor(
    private readonly limit = LOGIN_FAILURE_LIMIT,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  allow(now: number): boolean {
    this.prune(now);
    return this.failures.length < this.limit;
  }

  recordFailure(now: number): void {
    this.prune(now);
    if (this.failures.length >= this.limit) return;
    this.failures.push(now);
  }

  get retained(): number {
    return this.failures.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.failures.length > 0 && (this.failures[0] ?? 0) < cutoff) this.failures.shift();
  }
}

/**
 * Private admin HTTP. The constructor does not listen. Call start() to bind
 * 127.0.0.1 only. Gameplay HTTP is a different server.
 */
export class AdminHttpServer {
  private http?: HttpServer;
  private closed = false;
  private bound: BoundAddress | null = null;
  private readonly now: () => number;
  private readonly sessions: AdminSessionStore;
  private readonly limiter: LoginRateLimit;
  private readonly credentials: readonly [AdminCredential, AdminCredential];
  private readonly logAt = new Map<string, { at: number; suppressed: number; logged: boolean }>();

  constructor(private readonly options: AdminHttpOptions) {
    assertCredentials(options.credentials);
    this.credentials = options.credentials;
    this.now = options.now ?? Date.now;
    this.sessions = new AdminSessionStore(
      this.now,
      options.idleMs,
      options.absoluteMs,
      options.maxSessions,
    );
    this.limiter = new LoginRateLimit(options.loginFailureLimit, options.loginWindowMs);
  }

  get port(): number {
    return this.bound?.port ?? 0;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  get retainedLoginFailures(): number {
    return this.limiter.retained;
  }

  boundAddress(): BoundAddress | null {
    return this.bound;
  }

  async start(): Promise<void> {
    if (this.http) throw new Error('admin http is already listening');
    if (this.options.assetsRoot && !existsSync(adminAssetIndex(this.options.assetsRoot))) {
      throw new Error(
        `admin ui bundle is missing (${adminAssetIndex(this.options.assetsRoot)}). Run npm run build:admin before enabling FC_ADMIN_PORT.`,
      );
    }
    this.closed = false;
    const http = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.http = http;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        http.once('error', onError);
        http.listen(this.options.port, '127.0.0.1', () => {
          http.off('error', onError);
          http.on('error', () => {
            serverLog('admin http socket error', 'error');
          });
          const address = http.address();
          if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
            reject(new Error('admin http refused to bind 127.0.0.1'));
            return;
          }
          this.bound = { address: address.address, port: address.port };
          resolve();
        });
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.sessions.clear();
    this.bound = null;
    const http = this.http;
    this.http = undefined;
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (this.closed || !this.bound) throw new HttpReply(503, 'unavailable');
      this.requireHost(req);
      const method = req.method ?? 'GET';
      const path = requestPath(req);
      if (path === '/admin/api/login') {
        if (method !== 'POST') throw new HttpReply(405, 'method not allowed');
        await this.login(req, res);
        return;
      }
      if (path === '/admin/api/logout') {
        if (method !== 'POST') throw new HttpReply(405, 'method not allowed');
        await this.logout(req, res);
        return;
      }
      if (path === '/admin/api/me') {
        if (method !== 'GET') throw new HttpReply(405, 'method not allowed');
        this.me(req, res);
        return;
      }
      if (path.startsWith('/admin/api/player/')) {
        await this.playerRoute(req, res, method, path);
        return;
      }
      if (this.options.panel && await this.panelRoute(req, res, method, path)) return;
      if (method === 'GET' && this.serveAsset(res, path)) return;
      if (method !== 'GET' && method !== 'POST') throw new HttpReply(405, 'method not allowed');
      throw new HttpReply(404, 'not found');
    } catch (error) {
      if (error instanceof PanelHttpError) {
        if (!res.headersSent) sendJson(res, error.status, { error: error.code });
        return;
      }
      if (error instanceof HttpReply) {
        if (!res.headersSent) sendJson(res, error.status, { error: error.error });
        if (error.status === 413) req.resume();
        return;
      }
      if (!res.headersSent) sendJson(res, 500, { error: 'unavailable' });
      serverLog('admin http failed', 'error');
    }
  }

  private async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requireOrigin(req, false);
    const body = await readJson(req);
    if (!this.limiter.allow(this.now())) {
      this.note('login-rejected');
      throw new HttpReply(429, 'too many attempts');
    }
    const secret = typeof body.secret === 'string' ? body.secret : '';
    const adminId = resolveAdminCredential(this.credentials, secret);
    if (!adminId) {
      this.limiter.recordFailure(this.now());
      this.note('login-rejected');
      throw new HttpReply(401, 'authentication failed');
    }
    const session = this.sessions.create(adminId);
    this.note('login-ok', adminId);
    this.writeSession(req, res, session);
  }

  private async logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requireOrigin(req, true);
    await readBody(req);
    const session = this.requireSession(req);
    const csrf = headerOne(req, 'x-csrf-token');
    if (!csrf || !sameToken(csrf, session.csrfToken)) {
      this.note('denied');
      throw new HttpReply(403, 'forbidden');
    }
    this.sessions.revoke(session.id);
    this.note('logout', session.adminId);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(isTls(req)) });
  }

  private me(req: IncomingMessage, res: ServerResponse): void {
    this.requireOrigin(req, false);
    const session = this.requireSession(req);
    this.writeSession(req, res, session);
  }

  private async playerRoute(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
    const match = /^\/admin\/api\/player\/([^/]+)(?:\/(kick|ban|unban))?$/.exec(path);
    if (!match) throw new HttpReply(404, 'not found');
    const playerId = decodePlayerId(match[1] ?? '');
    const action = match[2];
    if (!action) {
      if (method !== 'GET') throw new HttpReply(405, 'method not allowed');
      this.player(req, res, `/admin/api/player/${playerId}`);
      return;
    }
    if (method !== 'POST') throw new HttpReply(405, 'method not allowed');
    const panel = this.options.panel;
    if (!panel) throw new HttpReply(404, 'not found');
    const session = this.requireMutation(req);
    const body = await readJson(req);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const result = action === 'kick'
      ? await panel.kick(session.adminId, playerId, reason, requestId)
      : action === 'ban'
        ? await panel.ban(session.adminId, playerId, reason, requestId)
        : await panel.unban(session.adminId, playerId, reason, requestId);
    sendJson(res, 200, result);
  }

  private async panelRoute(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    path: string,
  ): Promise<boolean> {
    const panel = this.options.panel;
    if (!panel) return false;
    if (method === 'GET') this.requireOrigin(req, false);
    if (path === '/admin/api/overview' && method === 'GET') {
      this.requireSession(req);
      sendJson(res, 200, panel.overview());
      return true;
    }
    if (path === '/admin/api/players' && method === 'GET') {
      this.requireSession(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const limit = boundLimit(url.searchParams.get('limit'));
      const cursor = boundText(url.searchParams.get('cursor'), 80);
      const q = boundText(url.searchParams.get('q'), 64) ?? '';
      sendJson(res, 200, panel.players(q, cursor, limit));
      return true;
    }
    if (path === '/admin/api/economy' && method === 'GET') {
      this.requireSession(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const playerId = boundText(url.searchParams.get('playerId'), 64);
      if (!playerId) throw new HttpReply(400, 'invalid request');
      sendJson(res, 200, await panel.economy(playerId));
      return true;
    }
    if (path === '/admin/api/economy/adjust' && method === 'POST') {
      const session = this.requireMutation(req);
      const body = await readJson(req);
      const playerId = typeof body.playerId === 'string' ? body.playerId : '';
      const balance = typeof body.balance === 'number' ? body.balance : Number.NaN;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      sendJson(res, 200, await panel.adjust(session.adminId, playerId, balance, reason, requestId));
      return true;
    }
    if (path === '/admin/api/incidents' && method === 'GET') {
      this.requireSession(req);
      sendJson(res, 200, panel.incidents());
      return true;
    }
    if (path === '/admin/api/resources' && method === 'GET') {
      this.requireSession(req);
      sendJson(res, 200, panel.resources());
      return true;
    }
    if (path === '/admin/api/resources/recheck' && method === 'POST') {
      const session = this.requireMutation(req);
      const body = await readJson(req);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : 'проверка';
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      sendJson(res, 200, await panel.recheck(session.adminId, requestId, reason));
      return true;
    }
    if (path === '/admin/api/audit' && method === 'GET') {
      this.requireSession(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const limit = boundLimit(url.searchParams.get('limit'));
      const cursor = boundText(url.searchParams.get('cursor'), 96);
      const before = cursor ? parseAuditCursor(cursor) : null;
      sendJson(res, 200, await panel.audit(limit, before));
      return true;
    }
    if (path === '/admin/api/server' && method === 'GET') {
      this.requireSession(req);
      sendJson(res, 200, panel.serverStatus(this.options.startedAt ?? this.now()));
      return true;
    }
    return false;
  }

  private requireMutation(req: IncomingMessage) {
    this.requireOrigin(req, true);
    const session = this.requireSession(req);
    const csrf = headerOne(req, 'x-csrf-token');
    if (!csrf || !sameToken(csrf, session.csrfToken)) {
      this.note('denied');
      throw new HttpReply(403, 'forbidden');
    }
    return session;
  }

  private serveAsset(res: ServerResponse, path: string): boolean {
    const root = this.options.assetsRoot;
    if (!root) return false;
    if (path !== '/admin' && path !== '/admin/' && !path.startsWith('/admin/assets/')
      && !path.startsWith('/admin/fonts/') && !path.startsWith('/admin/icons/')
      && path !== '/admin/index.html') {
      return false;
    }
    const asset = readAdminAsset(root, path);
    if (!asset) throw new HttpReply(404, 'not found');
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Length': asset.body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    });
    res.end(asset.body);
    return true;
  }

  private player(req: IncomingMessage, res: ServerResponse, path: string): void {
    this.requireOrigin(req, false);
    const session = this.requireSession(req);
    const playerId = playerIdFromPath(path);
    let snapshot: AdminPlayerSnapshot | null;
    try {
      snapshot = this.options.inspect(session.adminId, playerId);
    } catch (error) {
      if (error instanceof AdminIdentityError || error instanceof AdminControlDisabledError) {
        this.note('denied');
        throw new HttpReply(403, 'forbidden');
      }
      throw new HttpReply(400, 'invalid request');
    }
    if (!snapshot) throw new HttpReply(404, 'not found');
    sendJson(res, 200, snapshot);
  }

  private requireSession(req: IncomingMessage): AdminSession {
    const raw = readCookie(req.headers.cookie, ADMIN_COOKIE_NAME);
    if (!raw || !SESSION_ID.test(raw)) throw new HttpReply(401, 'authentication failed');
    const session = this.sessions.read(raw);
    if (!session) {
      this.note('expired');
      throw new HttpReply(401, 'authentication failed');
    }
    this.sessions.touch(session);
    return session;
  }

  private writeSession(req: IncomingMessage, res: ServerResponse, session: AdminSession): void {
    const info = this.options.describe();
    const idleMs = this.options.idleMs ?? ADMIN_IDLE_MS;
    const idleExpiresAt = Math.min(session.expiresAt, session.lastActivityAt + idleMs);
    const maxAge = Math.max(1, Math.ceil((session.expiresAt - this.now()) / 1000));
    sendJson(res, 200, {
      adminId: session.adminId,
      expiresAt: session.expiresAt,
      idleExpiresAt,
      csrfToken: session.csrfToken,
      serverMode: info.serverMode,
      worldId: info.worldId,
    }, {
      'Set-Cookie': sessionCookie(session.id, isTls(req), maxAge),
    });
  }

  private requireHost(req: IncomingMessage): void {
    const bound = this.bound;
    if (!bound) throw new HttpReply(503, 'unavailable');
    const host = headerOne(req, 'host')?.trim().toLowerCase() ?? '';
    const allowed = host === `127.0.0.1:${bound.port}` || host === `localhost:${bound.port}`;
    if (!allowed) {
      this.note('denied');
      throw new HttpReply(403, 'forbidden');
    }
  }

  private requireOrigin(req: IncomingMessage, required: boolean): void {
    const origin = headerOne(req, 'origin');
    if (!origin) {
      if (required) {
        this.note('denied');
        throw new HttpReply(403, 'forbidden');
      }
      return;
    }
    const bound = this.bound;
    if (!bound) throw new HttpReply(503, 'unavailable');
    const scheme = isTls(req) ? 'https' : 'http';
    const allowed = origin === `${scheme}://127.0.0.1:${bound.port}`
      || origin === `${scheme}://localhost:${bound.port}`;
    if (!allowed) {
      this.note('denied');
      throw new HttpReply(403, 'forbidden');
    }
  }

  private note(kind: 'login-ok' | 'login-rejected' | 'logout' | 'expired' | 'denied', adminId?: string): void {
    if (kind === 'login-ok' || kind === 'logout') {
      serverLog(`admin ${kind}${adminId ? ` id=${adminId}` : ''}`);
      return;
    }
    const now = this.now();
    const slot = this.logAt.get(kind) ?? { at: now, suppressed: 0, logged: false };
    if (slot.logged && now - slot.at < LOG_INTERVAL_MS) {
      slot.suppressed += 1;
      this.logAt.set(kind, slot);
      return;
    }
    const extra = slot.suppressed > 0 ? ` suppressed=${slot.suppressed}` : '';
    serverLog(`admin ${kind}${extra}`);
    this.logAt.set(kind, { at: now, suppressed: 0, logged: true });
  }
}

function assertCredentials(credentials: readonly [AdminCredential, AdminCredential]): void {
  const [first, second] = credentials;
  if (!first || !second) throw new Error('admin http requires two credentials');
  if (first.adminId === second.adminId) throw new Error('admin http requires two different admin ids');
  if (first.digest.length !== 32 || second.digest.length !== 32) {
    throw new Error('admin http credentials must be SHA-256 digests');
  }
  if (first.digest.equals(second.digest)) throw new Error('admin http credentials must be unique');
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    throw new HttpReply(400, 'invalid request');
  }
}

function boundLimit(value: string | null): number {
  const parsed = value === null ? 20 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 40) throw new HttpReply(400, 'invalid request');
  return parsed;
}

function boundText(value: string | null, max: number): string | undefined {
  if (value === null || value === '') return undefined;
  if (value.length > max) throw new HttpReply(400, 'invalid request');
  return value;
}

function parseAuditCursor(value: string): { createdAt: string; eventId: string } {
  const split = value.indexOf('|');
  if (split <= 0) throw new HttpReply(400, 'invalid request');
  return { createdAt: value.slice(0, split), eventId: value.slice(split + 1) };
}

function decodePlayerId(raw: string): string {
  let playerId: string;
  try {
    playerId = decodeURIComponent(raw);
  } catch {
    throw new HttpReply(400, 'invalid request');
  }
  if (!PLAYER_ID.test(playerId)) throw new HttpReply(400, 'invalid request');
  return playerId;
}

function playerIdFromPath(path: string): string {
  const raw = path.slice('/admin/api/player/'.length);
  if (raw.length === 0 || raw.includes('/')) throw new HttpReply(400, 'invalid request');
  let playerId: string;
  try {
    playerId = decodeURIComponent(raw);
  } catch {
    throw new HttpReply(400, 'invalid request');
  }
  if (!PLAYER_ID.test(playerId)) throw new HttpReply(400, 'invalid request');
  return playerId;
}

function headerOne(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return undefined;
  return value;
}

function isTls(req: IncomingMessage): boolean {
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return trimmed.slice(eq + 1);
  }
  return null;
}

function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sessionCookie(id: string, secure: boolean, maxAge: number): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${id}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(secure: boolean): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = headerOne(req, 'content-length');
  if (declared !== undefined) {
    if (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BODY_BYTES) {
      return Promise.reject(new HttpReply(413, 'request too large'));
    }
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        if (!failed) {
          failed = true;
          reject(new HttpReply(413, 'request too large'));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!failed) {
        failed = true;
        reject(new HttpReply(400, 'invalid request'));
      }
    });
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.length === 0) throw new HttpReply(400, 'invalid request');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpReply(400, 'invalid request');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpReply(400, 'invalid request');
  }
  return parsed as Record<string, unknown>;
}
