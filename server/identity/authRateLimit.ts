const WINDOW_MS = 5 * 60 * 1000;
const SOCKET_LIMIT = 8;
const SOURCE_LIMIT = 40;
const SUBJECT_LIMIT = 6;
const PROOF_LIMIT = 6;
const GLOBAL_LIMIT = 300;
const GLOBAL_WINDOW_MS = 60 * 1000;
const MAX_KEYS = 1024;

interface StampList {
  at: number[];
  seen: number;
}

/**
 * Auth attempts are limited per socket, per direct TCP peer, per verified
 * Yandex subject, per proof fingerprint, and by a process-wide budget.
 * A loopback peer is not a player identity: behind a local reverse proxy
 * every connection can share 127.0.0.1. Forwarded headers are read only when
 * that peer is listed in `trustedProxies`.
 */
export class AuthRateLimiter {
  private readonly bySocket = new WeakMap<object, number[]>();
  private readonly bySource = new Map<string, StampList>();
  private readonly bySubject = new Map<string, StampList>();
  private readonly byProof = new Map<string, StampList>();
  private global: number[] = [];

  allowConnection(socket: object, sourceKey: string | undefined, now = Date.now()): boolean {
    if (!this.allowList(this.socketList(socket), SOCKET_LIMIT, WINDOW_MS, now)) return false;
    if (!this.allowGlobal(now)) return false;
    if (sourceKey && !this.allowKeyed(this.bySource, sourceKey, SOURCE_LIMIT, WINDOW_MS, now)) return false;
    return true;
  }

  /** Limit for the HMAC-verified provider user id. A new proof does not reset it. */
  allowVerifiedSubject(providerUserId: string, now = Date.now()): boolean {
    if (!isSubjectKey(providerUserId)) return false;
    return this.allowKeyed(this.bySubject, providerUserId, SUBJECT_LIMIT, WINDOW_MS, now);
  }

  /** Limit for one canonical proof fingerprint. This is not the player id. */
  allowProof(proofHash: string, now = Date.now()): boolean {
    if (!/^[0-9a-f]{64}$/.test(proofHash)) return false;
    return this.allowKeyed(this.byProof, proofHash, PROOF_LIMIT, WINDOW_MS, now);
  }

  private socketList(socket: object): number[] {
    const existing = this.bySocket.get(socket);
    if (existing) return existing;
    const created: number[] = [];
    this.bySocket.set(socket, created);
    return created;
  }

  private allowGlobal(now: number): boolean {
    this.global = this.global.filter((at) => now - at < GLOBAL_WINDOW_MS);
    if (this.global.length >= GLOBAL_LIMIT) return false;
    this.global.push(now);
    return true;
  }

  private allowList(list: number[], limit: number, windowMs: number, now: number): boolean {
    const kept = list.filter((at) => now - at < windowMs);
    list.length = 0;
    list.push(...kept);
    if (list.length >= limit) return false;
    list.push(now);
    return true;
  }

  private allowKeyed(
    map: Map<string, StampList>,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): boolean {
    this.evict(map, now, windowMs);
    if (!map.has(key) && map.size >= MAX_KEYS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    const entry = map.get(key) ?? { at: [], seen: now };
    entry.at = entry.at.filter((at) => now - at < windowMs);
    entry.seen = now;
    if (entry.at.length >= limit) {
      map.set(key, entry);
      return false;
    }
    entry.at.push(now);
    map.set(key, entry);
    return true;
  }

  private evict(map: Map<string, StampList>, now: number, windowMs: number): void {
    if (map.size < MAX_KEYS) return;
    for (const [key, entry] of map) {
      if (now - entry.seen > windowMs) map.delete(key);
    }
  }
}

function isSubjectKey(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function parseTrustedProxies(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const token = normalizePeer(part.trim());
    if (!token || !isPlausibleIp(token)) {
      throw new Error('FC_TRUSTED_PROXIES must be a comma-separated list of IP addresses.');
    }
    out.push(token);
  }
  return out;
}

/**
 * Direct TCP peer, or the client address appended by a trusted proxy.
 * Loopback without a trusted-proxy rule is omitted so it cannot become one
 * shared bucket for every player. Client-supplied forwarding headers are
 * ignored unless the TCP peer itself is trusted.
 */
export function socketPeerKey(
  socket: object,
  request?: { headers?: { readonly [key: string]: string | string[] | undefined } },
  trustedProxies?: readonly string[],
): string | undefined {
  const peer = tcpPeer(socket);
  if (!peer) return undefined;
  const trusted = new Set((trustedProxies ?? []).map((item) => normalizePeer(item)).filter((item): item is string => Boolean(item)));
  if (trusted.has(peer)) return forwardedClient(request?.headers?.['x-forwarded-for'], trusted);
  if (isLoopback(peer)) return undefined;
  return peer;
}

function tcpPeer(socket: object): string | undefined {
  const raw = (socket as { _socket?: { remoteAddress?: string | null } })._socket?.remoteAddress;
  if (!raw) return undefined;
  return normalizePeer(raw);
}

function forwardedClient(
  header: string | string[] | undefined,
  trusted: ReadonlySet<string>,
): string | undefined {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return undefined;
  const hops = raw.split(',').map((part) => normalizePeer(part.trim())).filter((part): part is string => Boolean(part));
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (!hop || trusted.has(hop) || isLoopback(hop)) continue;
    return isPlausibleIp(hop) ? hop : undefined;
  }
  return undefined;
}

function normalizePeer(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
  return value.length > 0 ? value : undefined;
}

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '0:0:0:0:0:0:0:1';
}

function isPlausibleIp(address: string): boolean {
  if (isLoopback(address)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) return v4.slice(1).every((part) => Number(part) <= 255);
  return address.includes(':') && address.length <= 64 && /^[0-9a-fA-F:.]+$/.test(address);
}
