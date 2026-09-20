import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../../server/services/jsonStore';
import { FriendsService } from '../../server/services/friends';
import {
  FRIENDS_ALREADY_ERROR,
  FRIENDS_DUPLICATE_REQUEST_ERROR,
  FRIENDS_LIMIT_ERROR,
  FRIENDS_MAX,
  FRIENDS_SELF_ERROR,
} from '../../shared/friends';

describe('FriendsService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-friends-'));
    dirs.push(dir);
    const players = new Map([
      ['ada', { id: 'ada', name: 'Ada', connected: true }],
      ['bob', { id: 'bob', name: 'Bob', connected: true }],
      ['cara', { id: 'cara', name: 'Cara', connected: false }],
    ]);
    const friends = new FriendsService(new JsonFileStore(dir));
    friends.setRuntime({
      isOnline: (id) => players.get(id)?.connected === true,
      displayName: (id) => players.get(id)?.name ?? id,
      lookupPlayer: (raw) => {
        const lower = raw.trim().toLowerCase();
        return [...players.values()].find((player) => player.id === lower || player.name.toLowerCase() === lower);
      },
      sendMessage: () => undefined,
    });
    friends.load();
    return { friends, players };
  }

  it('creates a mutual friendship after accept and rejects self/duplicate requests', async () => {
    const { friends } = await setup();
    expect(friends.request('ada', 'Ada').error).toBe(FRIENDS_SELF_ERROR);
    expect(friends.request('ada', 'Nobody').ok).toBe(false);
    const sent = friends.request('ada', 'Bob');
    expect(sent.ok).toBe(true);
    expect(friends.request('ada', 'Bob').error).toBe(FRIENDS_DUPLICATE_REQUEST_ERROR);
    expect(friends.incomingRequests('bob')).toHaveLength(1);
    expect(friends.accept('bob', sent.request!.requestId).ok).toBe(true);
    expect(friends.isFriend('ada', 'bob')).toBe(true);
    expect(friends.isFriend('bob', 'ada')).toBe(true);
    expect(friends.request('ada', 'Bob').error).toBe(FRIENDS_ALREADY_ERROR);
    expect(friends.remove('ada', 'bob').ok).toBe(true);
    expect(friends.isFriend('ada', 'bob')).toBe(false);
    expect(friends.isFriend('bob', 'ada')).toBe(false);
  });

  it('auto-completes a reverse request and sorts online friends first', async () => {
    const { friends, players } = await setup();
    friends.request('ada', 'Bob');
    expect(friends.request('bob', 'Ada').ok).toBe(true);
    expect(friends.isFriend('ada', 'bob')).toBe(true);
    friends.request('ada', 'Cara');
    friends.accept('cara', friends.incomingRequests('cara')[0]!.requestId);
    const rows = friends.sortedFriends('ada');
    expect(rows.map((row) => row.name)).toEqual(['Bob', 'Cara']);
    expect(rows[0]?.online).toBe(true);
    expect(rows[0]?.canTeleport).toBe(false);
    expect(rows[1]?.online).toBe(false);
    friends.setAllowTeleport('bob', true);
    expect(friends.canTeleportTo('ada', 'bob').ok).toBe(true);
    expect(friends.sortedFriends('ada')[0]?.canTeleport).toBe(true);
    players.get('bob')!.connected = false;
    expect(friends.canTeleportTo('ada', 'bob').ok).toBe(false);
  });

  it('enforces the 50 friend cap', async () => {
    const { friends } = await setup();
    const lookup = new Map<string, { id: string; name: string; connected: boolean }>();
    for (let index = 0; index < FRIENDS_MAX; index += 1) {
      const id = `p${index}`;
      lookup.set(id, { id, name: `P${index}`, connected: true });
    }
    friends.setRuntime({
      isOnline: () => true,
      displayName: (id) => lookup.get(id)?.name ?? id,
      lookupPlayer: (raw) => lookup.get(raw.trim().toLowerCase())
        ?? [...lookup.values()].find((player) => player.name.toLowerCase() === raw.trim().toLowerCase()),
      sendMessage: () => undefined,
    });
    for (let index = 0; index < FRIENDS_MAX; index += 1) {
      const id = `p${index}`;
      const sent = friends.request('ada', `P${index}`);
      expect(sent.ok).toBe(true);
      expect(friends.accept(id, sent.request!.requestId).ok).toBe(true);
    }
    lookup.set('overflow', { id: 'overflow', name: 'Overflow', connected: true });
    expect(friends.request('ada', 'Overflow').error).toBe(FRIENDS_LIMIT_ERROR);
  });

  it('cancels an outgoing request and reports already-friend/self states', async () => {
    const { friends } = await setup();
    expect(friends.relation('ada', 'ada')).toBe('self');
    expect(friends.request('ada', 'Bob').ok).toBe(true);
    expect(friends.relation('ada', 'bob')).toBe('outgoing');
    expect(friends.cancelOutgoing('ada', 'bob').ok).toBe(true);
    expect(friends.relation('ada', 'bob')).toBe('none');
    expect(friends.outgoingRequests('ada')).toHaveLength(0);
    friends.request('ada', 'Bob');
    friends.accept('bob', friends.incomingRequests('bob')[0]!.requestId);
    expect(friends.relation('ada', 'bob')).toBe('friend');
    expect(friends.request('ada', 'Bob').error).toBe(FRIENDS_ALREADY_ERROR);
  });
});
