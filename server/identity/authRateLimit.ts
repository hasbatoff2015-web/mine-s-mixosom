const WINDOW_MS = 5 * 60 * 1000;
const SOCKET_LIMIT = 8;
const SOURCE_LIMIT = 40;
const SUBJECT_LIMIT = 6;
const GLOBAL_LIMIT = 300;
const GLOBAL_WINDOW_MS = 60 * 1000;
const MAX_KEYS = 1024;

interface StampList {
  at: number[];
  seen: number;
}

/**
 * Auth attempts are limited per socket, per TCP peer, per verified subject,
 * and by a small process-wide budget. The peer address is the socket's own
 * remote address, never a client-supplied forwarding header.
 */
export class AuthRateLimiter {
  private readonly bySocket = new WeakMap<object, number[]>();
  private readonly bySource = new Map<string, StampList>();
  private readonly bySubject = new Map<string, StampList>();
  private global: number[] = [];

  allowConnection(socket: object, sourceKey: string | undefined, now = Date.now()): boolean {
    if (!this.allowList(this.socketList(socket), SOCKET_LIMIT, WINDOW_MS, now)) return false;
    if (!this.allowGlobal(now)) return false;
    if (sourceKey && !this.allowKeyed(this.bySource, sourceKey, SOURCE_LIMIT, WINDOW_MS, now)) return false;
    return true;
  }

  allowSubject(subjectKey: string, now = Date.now()): boolean {
    return this.allowKeyed(this.bySubject, subjectKey, SUBJECT_LIMIT, WINDOW_MS, now);
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
    while (map.size > MAX_KEYS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}

export function socketPeerKey(socket: object): string | undefined {
  const raw = (socket as { _socket?: { remoteAddress?: string | null } })._socket?.remoteAddress;
  if (!raw) return undefined;
  return raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
}
