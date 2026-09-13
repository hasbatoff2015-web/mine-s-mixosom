import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../../server/services/jsonStore';
import { FriendService } from '../../server/services/friends';
import {
  FRIEND_ALREADY_ERROR,
  FRIEND_LIMIT_ERROR,
  FRIEND_MAX,
  FRIEND_MISSING_PLAYER_ERROR,
  FRIEND_NOT_FRIEND_ERROR,
  FRIEND_OFFLINE_ERROR,
  FRIEND_REQUEST_EXISTS_ERROR,
  FRIEND_REQUEST_MISSING_ERROR,
  FRIEND_SELF_ERROR,
  FRIEND_TARGET_LIMIT_ERROR,
  FRIEND_TELEPORT_DENIED_ERROR,
  sortFriends,
} from '../../shared/friends';

describe('FriendService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(online = new Set(['ada', 'bob'])) {
    const dir = await mkdtemp(join(tmpdir(), 'fc-friends-'));
    dirs.push(dir);
    const positions = new Map([
      ['ada', { x: 1, y: 64, z: 2 }],
      ['bob', { x: 10, y: 70, z: 20 }],
    ]);
    const teleports: Array<readonly [string, number, number, number]> = [];
    const friends = new FriendService(new JsonFileStore(dir));
    const players = [
      { id: 'ada', name: 'Ada' },
      { id: 'bob', name: 'Bob' },
      { id: 'cara', name: 'Cara' },
    ];
    friends.setRuntime({
      isOnline: (id) => online.has(id),
      displayName: (id) => players.find((row) => row.id === id)?.name ?? id,
      lookupPlayer: (raw) => {
        const key = raw.trim().toLowerCase();
        return players.find((row) => row.id === key || row.name.toLowerCase() === key);
      },
      position: (id) => positions.get(id),
      teleport: (id, x, y, z) => {
        teleports.push([id, x, y, z]);
        return { ok: true };
      },
    });
    return { friends, teleports, online };
  }

  it('sends, accepts, and rejects friend requests', async () => {
    const { friends } = await setup();
    expect(friends.request('ada', 'missing').error).toBe(FRIEND_MISSING_PLAYER_ERROR);
    expect(friends.request('ada', 'Ada').error).toBe(FRIEND_SELF_ERROR);
    expect(friends.request('ada', 'Bob').ok).toBe(true);
    expect(friends.request('ada', 'bob').error).toBe(FRIEND_REQUEST_EXISTS_ERROR);
    expect(friends.incoming('bob')).toHaveLength(1);
    expect(friends.reject('bob', 'ada').ok).toBe(true);
    expect(friends.incoming('bob')).toHaveLength(0);
    expect(friends.request('ada', 'Bob').ok).toBe(true);
    expect(friends.accept('bob', 'ada').ok).toBe(true);
    expect(friends.areFriends('ada', 'bob')).toBe(true);
    expect(friends.request('ada', 'Bob').error).toBe(FRIEND_ALREADY_ERROR);
    expect(friends.remove('ada', 'bob').ok).toBe(true);
    expect(friends.areFriends('ada', 'bob')).toBe(false);
  });

  it('enforces the 50-friend cap on both sides', async () => {
    const { friends } = await setup();
    const ada = friends.ensure('ada');
    ada.friendIds = Array.from({ length: FRIEND_MAX }, (_unused, index) => `p${index}`);
    expect(friends.request('ada', 'Bob').error).toBe(FRIEND_LIMIT_ERROR);
    ada.friendIds = [];
    const bob = friends.ensure('bob');
    bob.friendIds = Array.from({ length: FRIEND_MAX }, (_unused, index) => `q${index}`);
    expect(friends.request('ada', 'Bob').error).toBe(FRIEND_TARGET_LIMIT_ERROR);
    bob.friendIds = [];
    expect(friends.request('ada', 'Bob').ok).toBe(true);
    ada.friendIds = Array.from({ length: FRIEND_MAX }, (_unused, index) => `p${index}`);
    expect(friends.accept('bob', 'ada').error).toBe(FRIEND_LIMIT_ERROR);
  });

  it('sorts online friends first, then by name', () => {
    const rows = sortFriends([
      { online: false, name: 'Zed' },
      { online: true, name: 'Bob' },
      { online: true, name: 'Ada' },
      { online: false, name: 'Cara' },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['Ada', 'Bob', 'Cara', 'Zed']);
  });

  it('refuses teleport to a stranger and to a disconnected friend', async () => {
    const { friends, teleports, online } = await setup();
    expect(friends.teleport('ada', 'bob').error).toBe(FRIEND_NOT_FRIEND_ERROR);
    friends.request('ada', 'Bob');
    friends.accept('bob', 'ada');
    friends.setTeleportAllowed('bob', true);
    online.delete('bob');
    expect(friends.teleport('ada', 'bob').error).toBe(FRIEND_OFFLINE_ERROR);
    expect(teleports).toEqual([]);
    const offline = friends.list('ada');
    expect(offline[0]).toMatchObject({ playerId: 'bob', online: false, teleportAllowed: true });
  });

  it('reports the friend own permission, not a client claim, in the snapshot', async () => {
    const { friends } = await setup();
    friends.request('ada', 'Bob');
    friends.accept('bob', 'ada');
    expect(friends.list('ada')[0]?.teleportAllowed).toBe(false);
    friends.setTeleportAllowed('ada', true);
    expect(friends.list('ada')[0]?.teleportAllowed).toBe(false);
    friends.setTeleportAllowed('bob', true);
    expect(friends.list('ada')[0]?.teleportAllowed).toBe(true);
  });

  it('rejects an unknown friend request and a removal of a stranger', async () => {
    const { friends } = await setup();
    expect(friends.reject('bob', 'ada').error).toBe(FRIEND_REQUEST_MISSING_ERROR);
    expect(friends.accept('bob', 'ada').error).toBe(FRIEND_REQUEST_MISSING_ERROR);
    expect(friends.remove('ada', 'bob').error).toBe(FRIEND_NOT_FRIEND_ERROR);
  });

  it('validates teleport permission on the server', async () => {
    const { friends, teleports, online } = await setup();
    friends.request('ada', 'Bob');
    friends.accept('bob', 'ada');
    expect(friends.teleport('ada', 'bob').error).toBe(FRIEND_TELEPORT_DENIED_ERROR);
    expect(friends.setTeleportAllowed('bob', true).ok).toBe(true);
    expect(friends.teleport('ada', 'bob').ok).toBe(true);
    expect(teleports).toEqual([['ada', 10, 70, 20]]);
    online.delete('bob');
    expect(friends.teleport('ada', 'bob').ok).toBe(false);
  });
});
