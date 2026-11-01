import { randomBytes } from 'node:crypto';

export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const ADMIN_MAX_SESSIONS = 16;
export const ADMIN_COOKIE_NAME = 'fc_admin_session';

/** Server-owned identity. Stage 5 writes must take this, not a client adminId. */
export interface AuthenticatedAdmin {
  readonly adminId: string;
  readonly sessionId: string;
}

export interface AdminSession {
  readonly id: string;
  readonly adminId: string;
  readonly csrfToken: string;
  readonly createdAt: number;
  lastActivityAt: number;
  readonly expiresAt: number;
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly idleMs = ADMIN_IDLE_MS,
    private readonly absoluteMs = ADMIN_ABSOLUTE_MS,
    private readonly maxSessions = ADMIN_MAX_SESSIONS,
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  create(adminId: string): AdminSession {
    this.purge();
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.oldest();
      if (!oldest) break;
      this.sessions.delete(oldest.id);
    }
    const createdAt = this.now();
    const session: AdminSession = {
      id: randomBytes(32).toString('base64url'),
      adminId,
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt,
      lastActivityAt: createdAt,
      expiresAt: createdAt + this.absoluteMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Expired rows are dropped. A live row is not touched; the caller decides that. */
  read(sessionId: string): AdminSession | null {
    this.purge();
    const session = this.sessions.get(sessionId);
    if (!session || !this.fresh(session)) {
      if (session) this.sessions.delete(session.id);
      return null;
    }
    return session;
  }

  touch(session: AdminSession): void {
    session.lastActivityAt = this.now();
  }

  revoke(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  private fresh(session: AdminSession): boolean {
    const now = this.now();
    if (now >= session.expiresAt) return false;
    if (now - session.lastActivityAt >= this.idleMs) return false;
    return true;
  }

  private purge(): void {
    for (const session of this.sessions.values()) {
      if (!this.fresh(session)) this.sessions.delete(session.id);
    }
  }

  private oldest(): AdminSession | undefined {
    let oldest: AdminSession | undefined;
    for (const session of this.sessions.values()) {
      if (!oldest || session.createdAt < oldest.createdAt) oldest = session;
    }
    return oldest;
  }
}
