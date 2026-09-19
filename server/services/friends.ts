import type { JsonFileStore } from './jsonStore';
import {
  FRIENDS_ALREADY_ERROR,
  FRIENDS_DUPLICATE_REQUEST_ERROR,
  FRIENDS_LIMIT_ERROR,
  FRIENDS_MAX,
  FRIENDS_NOT_FRIEND_ERROR,
  FRIENDS_PLUGIN_NAME,
  FRIENDS_REQUEST_MISSING_ERROR,
  FRIENDS_SELF_ERROR,
  type FriendRecord,
  type FriendRequest,
  type FriendsPlayerState,
  type FriendsStore,
} from '../../shared/friends';

export { FRIENDS_PLUGIN_NAME, FRIENDS_MAX };

export interface FriendsResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly request?: FriendRequest;
  readonly affected?: readonly string[];
}

export interface FriendsRuntime {
  isOnline(playerId: string): boolean;
  displayName(playerId: string): string;
  lookupPlayer(idOrName: string): { id: string; name: string; connected: boolean } | undefined;
  sendMessage(playerId: string, text: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migrateFriend(raw: unknown): FriendRecord | undefined {
  if (!isRecord(raw) || typeof raw.playerId !== 'string') return undefined;
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  return { playerId: raw.playerId, createdAt };
}

function migrateRequest(raw: unknown): FriendRequest | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.requestId !== 'string' || typeof raw.fromPlayerId !== 'string' || typeof raw.toPlayerId !== 'string') {
    return undefined;
  }
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  return {
    requestId: raw.requestId,
    fromPlayerId: raw.fromPlayerId,
    toPlayerId: raw.toPlayerId,
    createdAt,
  };
}

function emptyState(): FriendsPlayerState {
  return { friends: [], allowFriendTeleport: false };
}

export class FriendsService {
  private store: FriendsStore = { players: {}, requests: [] };
  private runtime: FriendsRuntime = {
    isOnline: () => false,
    displayName: (id) => id.slice(0, 8),
    lookupPlayer: () => undefined,
    sendMessage: () => undefined,
  };
  private nextId = 1;

  constructor(private readonly files: JsonFileStore) {}

  setRuntime(runtime: FriendsRuntime): void {
    this.runtime = runtime;
  }

  load(): void {
    const raw = this.files.load<unknown>(`${FRIENDS_PLUGIN_NAME}/friends`, { players: {}, requests: [] });
    const players: Record<string, FriendsPlayerState> = {};
    if (isRecord(raw) && isRecord(raw.players)) {
      for (const [id, value] of Object.entries(raw.players)) {
        if (!isRecord(value)) continue;
        const friends = Array.isArray(value.friends)
          ? value.friends.map(migrateFriend).filter((entry): entry is FriendRecord => Boolean(entry))
          : [];
        players[id] = {
          friends,
          allowFriendTeleport: value.allowFriendTeleport === true,
        };
      }
    }
    const requests = isRecord(raw) && Array.isArray(raw.requests)
      ? raw.requests.map(migrateRequest).filter((entry): entry is FriendRequest => Boolean(entry))
      : [];
    this.store = { players, requests };
    this.nextId = requests.reduce((max, request) => {
      const match = /^fr-(\d+)$/.exec(request.requestId);
      return match ? Math.max(max, Number(match[1]) + 1) : max;
    }, 1);
  }

  persist(): void {
    this.files.save(`${FRIENDS_PLUGIN_NAME}/friends`, this.store);
  }

  state(playerId: string): FriendsPlayerState {
    return this.store.players[playerId] ?? emptyState();
  }

  isFriend(a: string, b: string): boolean {
    return this.state(a).friends.some((entry) => entry.playerId === b);
  }

  incomingRequests(playerId: string): FriendRequest[] {
    return this.store.requests.filter((request) => request.toPlayerId === playerId);
  }

  outgoingRequests(playerId: string): FriendRequest[] {
    return this.store.requests.filter((request) => request.fromPlayerId === playerId);
  }

  setAllowTeleport(playerId: string, allow: boolean): void {
    const state = this.ensure(playerId);
    state.allowFriendTeleport = allow;
    this.persist();
  }

  request(fromPlayerId: string, targetRaw: string): FriendsResult {
    const target = this.runtime.lookupPlayer(targetRaw.trim());
    if (!target) return { ok: false, error: 'Игрок с таким ником не найден.' };
    if (target.id === fromPlayerId) return { ok: false, error: FRIENDS_SELF_ERROR };
    if (this.isFriend(fromPlayerId, target.id)) return { ok: false, error: FRIENDS_ALREADY_ERROR };
    if (this.store.requests.some((request) => request.fromPlayerId === fromPlayerId && request.toPlayerId === target.id)) {
      return { ok: false, error: FRIENDS_DUPLICATE_REQUEST_ERROR };
    }
    const reverse = this.store.requests.find((request) => request.fromPlayerId === target.id && request.toPlayerId === fromPlayerId);
    if (reverse) return this.accept(fromPlayerId, reverse.requestId);
    if (this.state(fromPlayerId).friends.length >= FRIENDS_MAX) return { ok: false, error: FRIENDS_LIMIT_ERROR };
    const request: FriendRequest = {
      requestId: `fr-${this.nextId++}`,
      fromPlayerId,
      toPlayerId: target.id,
      createdAt: Date.now(),
    };
    this.store.requests.push(request);
    this.persist();
    this.runtime.sendMessage(target.id, `${this.runtime.displayName(fromPlayerId)} хочет добавить вас в друзья.`);
    return { ok: true, request, affected: [fromPlayerId, target.id] };
  }

  accept(playerId: string, requestId: string): FriendsResult {
    const request = this.store.requests.find((entry) => entry.requestId === requestId && entry.toPlayerId === playerId);
    if (!request) return { ok: false, error: FRIENDS_REQUEST_MISSING_ERROR };
    if (this.state(playerId).friends.length >= FRIENDS_MAX || this.state(request.fromPlayerId).friends.length >= FRIENDS_MAX) {
      return { ok: false, error: FRIENDS_LIMIT_ERROR };
    }
    this.link(request.fromPlayerId, playerId);
    this.store.requests = this.store.requests.filter((entry) => (
      entry.requestId !== requestId
      && !(entry.fromPlayerId === request.fromPlayerId && entry.toPlayerId === playerId)
      && !(entry.fromPlayerId === playerId && entry.toPlayerId === request.fromPlayerId)
    ));
    this.persist();
    this.runtime.sendMessage(request.fromPlayerId, `${this.runtime.displayName(playerId)} добавил вас в друзья.`);
    return { ok: true, request, affected: [playerId, request.fromPlayerId] };
  }

  cancelOutgoing(playerId: string, targetPlayerId: string): FriendsResult {
    const before = this.store.requests.length;
    this.store.requests = this.store.requests.filter(
      (entry) => !(entry.fromPlayerId === playerId && entry.toPlayerId === targetPlayerId),
    );
    if (this.store.requests.length === before) return { ok: false, error: FRIENDS_REQUEST_MISSING_ERROR };
    this.persist();
    return { ok: true, affected: [playerId, targetPlayerId] };
  }

  relation(viewerId: string, targetId: string): 'self' | 'friend' | 'outgoing' | 'none' {
    if (viewerId === targetId) return 'self';
    if (this.isFriend(viewerId, targetId)) return 'friend';
    if (this.outgoingRequests(viewerId).some((request) => request.toPlayerId === targetId)) return 'outgoing';
    return 'none';
  }

  reject(playerId: string, requestId: string): FriendsResult {
    const before = this.store.requests.length;
    this.store.requests = this.store.requests.filter((entry) => !(entry.requestId === requestId && entry.toPlayerId === playerId));
    if (this.store.requests.length === before) return { ok: false, error: FRIENDS_REQUEST_MISSING_ERROR };
    this.persist();
    return { ok: true, affected: [playerId] };
  }

  remove(playerId: string, friendId: string): FriendsResult {
    if (!this.isFriend(playerId, friendId)) return { ok: false, error: FRIENDS_NOT_FRIEND_ERROR };
    this.unlink(playerId, friendId);
    this.persist();
    return { ok: true, affected: [playerId, friendId] };
  }

  canTeleportTo(fromPlayerId: string, toPlayerId: string): FriendsResult {
    if (!this.isFriend(fromPlayerId, toPlayerId)) return { ok: false, error: FRIENDS_NOT_FRIEND_ERROR };
    if (!this.runtime.isOnline(toPlayerId)) return { ok: false, error: 'Игрок не в сети.' };
    if (!this.state(toPlayerId).allowFriendTeleport) {
      return { ok: false, error: 'Этот игрок запретил телепортацию друзей.' };
    }
    return { ok: true };
  }

  clearPlayer(playerId: string): void {
    this.store.requests = this.store.requests.filter((entry) => entry.fromPlayerId !== playerId && entry.toPlayerId !== playerId);
  }

  sortedFriends(playerId: string): Array<{
    readonly playerId: string;
    readonly name: string;
    readonly online: boolean;
    readonly canTeleport: boolean;
    readonly createdAt: number;
  }> {
    const rows = this.state(playerId).friends.map((friend) => {
      const online = this.runtime.isOnline(friend.playerId);
      return {
        playerId: friend.playerId,
        name: this.runtime.displayName(friend.playerId),
        online,
        canTeleport: online && this.state(friend.playerId).allowFriendTeleport,
        createdAt: friend.createdAt,
      };
    });
    return rows.sort((left, right) => {
      if (left.online !== right.online) return left.online ? -1 : 1;
      return left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' });
    });
  }

  private ensure(playerId: string): FriendsPlayerState {
    const current = this.store.players[playerId];
    if (current) return current;
    const created = emptyState();
    this.store.players[playerId] = created;
    return created;
  }

  private link(a: string, b: string): void {
    const now = Date.now();
    const left = this.ensure(a);
    const right = this.ensure(b);
    if (!left.friends.some((entry) => entry.playerId === b)) left.friends.push({ playerId: b, createdAt: now });
    if (!right.friends.some((entry) => entry.playerId === a)) right.friends.push({ playerId: a, createdAt: now });
  }

  private unlink(a: string, b: string): void {
    const left = this.ensure(a);
    const right = this.ensure(b);
    left.friends = left.friends.filter((entry) => entry.playerId !== b);
    right.friends = right.friends.filter((entry) => entry.playerId !== a);
  }
}
