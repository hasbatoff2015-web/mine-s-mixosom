import {
  FRIEND_ALREADY_ERROR,
  FRIEND_BUSY_ERROR,
  FRIEND_LIMIT_ERROR,
  FRIEND_MAX,
  FRIEND_MISSING_PLAYER_ERROR,
  FRIEND_NOT_FRIEND_ERROR,
  FRIEND_OFFLINE_ERROR,
  FRIEND_PLUGIN_NAME,
  FRIEND_REQUEST_EXISTS_ERROR,
  FRIEND_REQUEST_MISSING_ERROR,
  FRIEND_SELF_ERROR,
  FRIEND_TARGET_LIMIT_ERROR,
  FRIEND_TELEPORT_DENIED_ERROR,
  sortFriends,
} from '../../shared/friends';
import type { JsonFileStore } from './jsonStore';

export { FRIEND_PLUGIN_NAME, FRIEND_MAX, sortFriends };

export interface FriendRequest {
  readonly fromId: string;
  readonly toId: string;
  readonly createdAt: number;
}

export interface FriendRecord {
  teleportAllowed: boolean;
  friendIds: string[];
}

export interface FriendSnapshotRow {
  readonly playerId: string;
  readonly name: string;
  readonly online: boolean;
  readonly teleportAllowed: boolean;
}

export interface FriendResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface FriendRuntime {
  isOnline(playerId: string): boolean;
  displayName(playerId: string): string;
  lookupPlayer(idOrName: string): { readonly id: string; readonly name: string } | undefined;
  position(playerId: string): { readonly x: number; readonly y: number; readonly z: number } | undefined;
  teleport(playerId: string, x: number, y: number, z: number): { ok: boolean; error?: string };
}

interface FriendFile {
  records: Record<string, unknown>;
  requests: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRecord(value: unknown): FriendRecord {
  if (!isRecord(value)) return { teleportAllowed: false, friendIds: [] };
  const friendIds = Array.isArray(value.friendIds)
    ? value.friendIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    teleportAllowed: value.teleportAllowed === true,
    friendIds: [...new Set(friendIds)],
  };
}

function parseRequest(value: unknown): FriendRequest | undefined {
  if (!isRecord(value) || typeof value.fromId !== 'string' || typeof value.toId !== 'string') return undefined;
  const createdAt = Number(value.createdAt);
  return { fromId: value.fromId, toId: value.toId, createdAt: Number.isFinite(createdAt) ? createdAt : 0 };
}

const emptyRuntime: FriendRuntime = {
  isOnline: () => false,
  displayName: (id) => id.slice(0, 8),
  lookupPlayer: () => undefined,
  position: () => undefined,
  teleport: () => ({ ok: false, error: FRIEND_OFFLINE_ERROR }),
};

export class FriendService {
  private records = new Map<string, FriendRecord>();
  private requests: FriendRequest[] = [];
  private readonly locks = new Set<string>();
  private runtime: FriendRuntime = emptyRuntime;

  constructor(
    private readonly store: JsonFileStore,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  setRuntime(runtime: FriendRuntime): void {
    this.runtime = runtime;
  }

  load(): void {
    const file = this.store.load<FriendFile>(`${FRIEND_PLUGIN_NAME}/friends`, { records: {}, requests: [] });
    this.records.clear();
    if (isRecord(file.records)) {
      for (const [id, value] of Object.entries(file.records)) {
        this.records.set(id, parseRecord(value));
      }
    }
    this.requests = Array.isArray(file.requests)
      ? file.requests.map(parseRequest).filter((row): row is FriendRequest => Boolean(row))
      : [];
  }

  persist(): void {
    const records: Record<string, FriendRecord> = {};
    for (const [id, record] of this.records) records[id] = record;
    this.store.save(`${FRIEND_PLUGIN_NAME}/friends`, { records, requests: this.requests });
  }

  ensure(playerId: string): FriendRecord {
    const existing = this.records.get(playerId);
    if (existing) return existing;
    const created: FriendRecord = { teleportAllowed: false, friendIds: [] };
    this.records.set(playerId, created);
    return created;
  }

  areFriends(a: string, b: string): boolean {
    return this.ensure(a).friendIds.includes(b) && this.ensure(b).friendIds.includes(a);
  }

  incoming(playerId: string): FriendRequest[] {
    return this.requests.filter((request) => request.toId === playerId);
  }

  outgoing(playerId: string): FriendRequest[] {
    return this.requests.filter((request) => request.fromId === playerId);
  }

  list(playerId: string): FriendSnapshotRow[] {
    const record = this.ensure(playerId);
    const rows = record.friendIds.map((id) => {
      const other = this.ensure(id);
      return {
        playerId: id,
        name: this.runtime.displayName(id),
        online: this.runtime.isOnline(id),
        teleportAllowed: other.teleportAllowed,
      };
    });
    return sortFriends(rows);
  }

  setTeleportAllowed(playerId: string, allowed: boolean): FriendResult {
    return this.withLock(playerId, () => {
      this.ensure(playerId).teleportAllowed = allowed === true;
      this.persist();
      return { ok: true };
    });
  }

  request(fromId: string, targetRaw: string): FriendResult {
    const target = this.runtime.lookupPlayer(targetRaw);
    if (!target) return { ok: false, error: FRIEND_MISSING_PLAYER_ERROR };
    if (target.id === fromId) return { ok: false, error: FRIEND_SELF_ERROR };
    if (this.areFriends(fromId, target.id)) return { ok: false, error: FRIEND_ALREADY_ERROR };
    if (this.requests.some((row) => row.fromId === fromId && row.toId === target.id)) {
      return { ok: false, error: FRIEND_REQUEST_EXISTS_ERROR };
    }
    if (this.requests.some((row) => row.fromId === target.id && row.toId === fromId)) {
      return this.accept(fromId, target.id);
    }
    return this.withLock(fromId, () => {
      if (this.ensure(fromId).friendIds.length >= FRIEND_MAX) return { ok: false, error: FRIEND_LIMIT_ERROR };
      if (this.ensure(target.id).friendIds.length >= FRIEND_MAX) return { ok: false, error: FRIEND_TARGET_LIMIT_ERROR };
      if (this.requests.some((row) => row.fromId === fromId && row.toId === target.id)) {
        return { ok: false, error: FRIEND_REQUEST_EXISTS_ERROR };
      }
      this.requests.push({ fromId, toId: target.id, createdAt: this.now() });
      this.persist();
      return { ok: true };
    });
  }

  accept(playerId: string, fromId: string): FriendResult {
    return this.withLocks(playerId, fromId, () => {
      const index = this.requests.findIndex((row) => row.toId === playerId && row.fromId === fromId);
      if (index < 0) return { ok: false, error: FRIEND_REQUEST_MISSING_ERROR };
      const self = this.ensure(playerId);
      const other = this.ensure(fromId);
      if (self.friendIds.length >= FRIEND_MAX || other.friendIds.length >= FRIEND_MAX) {
        return { ok: false, error: FRIEND_LIMIT_ERROR };
      }
      this.requests.splice(index, 1);
      this.requests = this.requests.filter((row) => !(
        (row.fromId === playerId && row.toId === fromId) || (row.fromId === fromId && row.toId === playerId)
      ));
      if (!self.friendIds.includes(fromId)) self.friendIds.push(fromId);
      if (!other.friendIds.includes(playerId)) other.friendIds.push(playerId);
      this.persist();
      return { ok: true };
    });
  }

  reject(playerId: string, fromId: string): FriendResult {
    return this.withLock(playerId, () => {
      const next = this.requests.filter((row) => !(row.toId === playerId && row.fromId === fromId));
      if (next.length === this.requests.length) return { ok: false, error: FRIEND_REQUEST_MISSING_ERROR };
      this.requests = next;
      this.persist();
      return { ok: true };
    });
  }

  remove(playerId: string, otherId: string): FriendResult {
    return this.withLocks(playerId, otherId, () => {
      const self = this.ensure(playerId);
      const other = this.ensure(otherId);
      if (!self.friendIds.includes(otherId)) return { ok: false, error: FRIEND_NOT_FRIEND_ERROR };
      self.friendIds = self.friendIds.filter((id) => id !== otherId);
      other.friendIds = other.friendIds.filter((id) => id !== playerId);
      this.persist();
      return { ok: true };
    });
  }

  teleport(fromId: string, toId: string): FriendResult {
    return this.withLocks(fromId, toId, () => {
      if (!this.areFriends(fromId, toId)) return { ok: false, error: FRIEND_NOT_FRIEND_ERROR };
      if (!this.runtime.isOnline(toId)) return { ok: false, error: FRIEND_OFFLINE_ERROR };
      if (!this.ensure(toId).teleportAllowed) return { ok: false, error: FRIEND_TELEPORT_DENIED_ERROR };
      const pos = this.runtime.position(toId);
      if (!pos) return { ok: false, error: FRIEND_OFFLINE_ERROR };
      return this.runtime.teleport(fromId, pos.x, pos.y, pos.z);
    });
  }

  incomingRows(playerId: string): { readonly playerId: string; readonly name: string }[] {
    return this.incoming(playerId).map((request) => ({
      playerId: request.fromId,
      name: this.runtime.displayName(request.fromId),
    }));
  }

  private withLock(playerId: string, fn: () => FriendResult): FriendResult {
    if (this.locks.has(playerId)) return { ok: false, error: FRIEND_BUSY_ERROR };
    this.locks.add(playerId);
    try {
      return fn();
    } finally {
      this.locks.delete(playerId);
    }
  }

  private withLocks(a: string, b: string, fn: () => FriendResult): FriendResult {
    const first = a < b ? a : b;
    const second = a < b ? b : a;
    if (this.locks.has(first) || this.locks.has(second)) return { ok: false, error: FRIEND_BUSY_ERROR };
    this.locks.add(first);
    this.locks.add(second);
    try {
      return fn();
    } finally {
      this.locks.delete(second);
      this.locks.delete(first);
    }
  }
}
