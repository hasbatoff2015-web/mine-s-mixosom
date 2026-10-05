import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { DirectMessageService } from '../../server/services/directMessages';
import { JsonFileStore } from '../../server/services/jsonStore';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { CHAT_TOO_LONG_ERROR } from '../../shared/chat';
import {
  DIRECT_MESSAGE_EMPTY_ERROR,
  DIRECT_MESSAGE_LIMIT,
  DIRECT_MESSAGE_NOT_FRIEND_ERROR,
  DIRECT_MESSAGE_PAGE,
  DIRECT_MESSAGE_RATE_LIMIT_ERROR,
  DIRECT_MESSAGE_REFILL_MS,
  DIRECT_MESSAGE_STORAGE_DIR,
  conversationKey,
} from '../../shared/directMessages';
import type { ServerDirectMessage, ServerMenuMessage } from '../../shared/protocol';

describe('DirectMessageService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(friends: Set<string> = new Set(['ada|bob', 'bob|ada', 'ada|cara', 'cara|ada'])) {
    const dir = await mkdtemp(pathJoin(tmpdir(), 'fc-dm-'));
    dirs.push(dir);
    const files = new JsonFileStore(dir);
    let now = 1_700_000_000_000;
    let seq = 0;
    const service = new DirectMessageService(
      files,
      (a, b) => friends.has(`${a}|${b}`),
      {
        now: () => now,
        createId: () => `msg-${++seq}`,
      },
    );
    service.load();
    return {
      dir,
      files,
      service,
      friends,
      setNow: (value: number) => { now = value; },
      advance: (ms: number) => { now += ms; },
    };
  }

  function pathFor(files: JsonFileStore, a: string, b: string): string {
    return files.pathFor(`${DIRECT_MESSAGE_STORAGE_DIR}/${conversationKey(a, b)}`);
  }

  it('persists one conversation file, keeps seq monotonic, and trims to 200', async () => {
    const { service, files } = await setup();
    expect(conversationKey('ada', 'bob')).toBe(conversationKey('bob', 'ada'));
    const first = service.send('ada', 'bob', 'Привет');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.message.seq).toBe(1);
    expect(first.message.senderId).toBe('ada');
    expect(first.message.recipientId).toBe('bob');
    const storedPath = pathFor(files, 'bob', 'ada');
    const raw = JSON.parse(await readFile(storedPath, 'utf8')) as {
      version: number;
      participants: string[];
      nextSeq: number;
      messages: Array<{ seq: number; text: string }>;
    };
    expect(raw.version).toBe(1);
    expect(raw.participants).toEqual(['ada', 'bob']);
    expect(raw.nextSeq).toBe(2);
    expect(raw.messages).toHaveLength(1);

    const reloaded = new DirectMessageService(files, () => true, { now: () => 5, createId: () => 'next' });
    reloaded.load();
    const again = reloaded.send('bob', 'ada', 'ещё');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.message.seq).toBe(2);

    const fresh = await setup();
    for (let index = 0; index < DIRECT_MESSAGE_LIMIT + 1; index += 1) {
      fresh.advance(DIRECT_MESSAGE_REFILL_MS);
      const sent = fresh.service.send('ada', 'bob', `n${index}`);
      expect(sent.ok).toBe(true);
    }
    const file = JSON.parse(await readFile(pathFor(fresh.files, 'ada', 'bob'), 'utf8')) as {
      nextSeq: number;
      messages: Array<{ seq: number; text: string }>;
    };
    expect(file.messages).toHaveLength(DIRECT_MESSAGE_LIMIT);
    expect(file.messages[0]?.seq).toBe(2);
    expect(file.messages[0]?.text).toBe('n1');
    expect(file.messages.at(-1)?.seq).toBe(201);
    expect(file.nextSeq).toBe(202);
    const info = await stat(pathFor(fresh.files, 'ada', 'bob'));
    console.log(`DM_FILE_BYTES ${info.size}`);
    expect(info.size).toBeGreaterThan(1_000);
    expect(info.size).toBeLessThan(200_000);

    const full = await setup();
    const body = 'я'.repeat(128);
    for (let index = 0; index < DIRECT_MESSAGE_LIMIT; index += 1) {
      full.advance(DIRECT_MESSAGE_REFILL_MS);
      expect(full.service.send('ada', 'bob', body).ok).toBe(true);
    }
    const fullInfo = await stat(pathFor(full.files, 'ada', 'bob'));
    console.log(`DM_FILE_BYTES_MAX ${fullInfo.size}`);
    expect(fullInfo.size).toBeGreaterThan(info.size);
    expect(fullInfo.size).toBeLessThan(200_000);
  });

  it('pages 120 messages as 50, 50, then 20 in chronological order', async () => {
    const ctx = await setup();
    for (let index = 1; index <= 120; index += 1) {
      ctx.advance(DIRECT_MESSAGE_REFILL_MS);
      expect(ctx.service.send('ada', 'bob', `m${index}`).ok).toBe(true);
    }
    const { service } = ctx;
    const latest = service.history('bob', 'ada');
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.messages.map((message) => message.seq)).toEqual(
      Array.from({ length: DIRECT_MESSAGE_PAGE }, (_, index) => 71 + index),
    );
    expect(latest.hasMore).toBe(true);
    const middle = service.history('ada', 'bob', latest.messages[0]?.seq);
    expect(middle.ok).toBe(true);
    if (!middle.ok) return;
    expect(middle.messages.map((message) => message.seq)).toEqual(
      Array.from({ length: DIRECT_MESSAGE_PAGE }, (_, index) => 21 + index),
    );
    expect(middle.hasMore).toBe(true);
    const rest = service.history('bob', 'ada', middle.messages[0]?.seq);
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.messages.map((message) => message.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => 1 + index),
    );
    expect(rest.hasMore).toBe(false);
  });

  it('tracks unread per participant and keeps it across reload', async () => {
    const { service, files, friends } = await setup();
    expect(service.send('ada', 'bob', 'one').ok).toBe(true);
    expect(service.unreadCount('bob', 'ada')).toBe(1);
    expect(service.unreadCount('ada', 'bob')).toBe(0);
    expect(service.totalUnread('bob')).toBe(1);
    const persisted = new DirectMessageService(files, (a, b) => friends.has(`${a}|${b}`), { now: () => 8, createId: () => 'persisted' });
    persisted.load();
    expect(persisted.unreadCount('bob', 'ada')).toBe(1);
    expect(persisted.send('cara', 'ada', 'other').ok).toBe(true);
    expect(persisted.unreadCount('ada', 'cara')).toBe(1);
    persisted.markReadThroughLatest('bob', 'ada');
    expect(persisted.unreadCount('bob', 'ada')).toBe(0);
    expect(persisted.unreadCount('ada', 'cara')).toBe(1);

    friends.delete('ada|bob');
    friends.delete('bob|ada');
    expect(service.totalUnread('bob')).toBe(0);
    expect(service.history('bob', 'ada').ok).toBe(false);
    await expect(stat(pathFor(files, 'ada', 'bob'))).resolves.toBeTruthy();

    const revived = new DirectMessageService(files, (a, b) => a !== b, { now: () => 9, createId: () => 'later' });
    revived.load();
    expect(revived.unreadCount('bob', 'ada')).toBe(0);
    expect(revived.history('bob', 'ada').ok).toBe(true);
  });

  it('rejects non-friends, empty, overlong, and rate-limited sends without storing them', async () => {
    const ctx = await setup(new Set(['ada|bob', 'bob|ada']));
    const stranger = ctx.service.send('ada', 'eve', 'no');
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error).toBe(DIRECT_MESSAGE_NOT_FRIEND_ERROR);
    const hidden = ctx.service.history('ada', 'eve');
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error).toBe(DIRECT_MESSAGE_NOT_FRIEND_ERROR);
    const empty = ctx.service.send('ada', 'bob', '   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe(DIRECT_MESSAGE_EMPTY_ERROR);
    const tooLong = ctx.service.send('ada', 'bob', 'я'.repeat(129));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toBe(CHAT_TOO_LONG_ERROR);
    expect(ctx.service.send('ada', 'bob', 'я'.repeat(128)).ok).toBe(true);
    const slash = ctx.service.send('ada', 'bob', '/home\n');
    expect(slash.ok).toBe(true);
    if (slash.ok) expect(slash.message.text).toBe('/home');
    for (let index = 0; index < 3; index += 1) expect(ctx.service.send('ada', 'bob', `b${index}`).ok).toBe(true);
    const limited = ctx.service.send('ada', 'bob', 'slow');
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error).toBe(DIRECT_MESSAGE_RATE_LIMIT_ERROR);
    ctx.advance(1000);
    expect(ctx.service.send('ada', 'bob', 'after').ok).toBe(true);
    const history = ctx.service.history('bob', 'ada');
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.messages.some((message) => message.text === 'slow')).toBe(false);
  });

  it('skips invalid records, preserves unknown versions, and repairs nextSeq', async () => {
    const { files, service } = await setup();
    const key = `${DIRECT_MESSAGE_STORAGE_DIR}/${conversationKey('ada', 'bob')}`;
    files.save(key, {
      version: 1,
      participants: ['bob', 'ada'],
      nextSeq: 1,
      lastReadSeq: { ada: 'nope', stranger: 9 },
      messages: [
        { messageId: 'good', seq: 4, senderId: 'ada', recipientId: 'bob', text: 'ok', createdAt: 10 },
        { messageId: 'bad', seq: 5, senderId: 'eve', recipientId: 'bob', text: 'no', createdAt: 11 },
        { messageId: 'good', seq: 6, senderId: 'ada', recipientId: 'bob', text: 'dup', createdAt: 12 },
        null,
      ],
    });
    service.load();
    const history = service.history('bob', 'ada');
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.messages.map((message) => message.messageId)).toEqual(['good']);
    const next = service.send('bob', 'ada', 'after');
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.message.seq).toBe(5);

    const preservedKey = `${DIRECT_MESSAGE_STORAGE_DIR}/${conversationKey('ada', 'cara')}`;
    files.save(preservedKey, { version: 99, participants: ['ada', 'cara'], secret: 'keep' });
    const before = await readFile(files.pathFor(preservedKey));
    const cara = new DirectMessageService(files, () => true, { now: () => 1, createId: () => 'x' });
    cara.load();
    expect(cara.history('ada', 'cara')).toEqual({ ok: true, messages: [], hasMore: false });
    expect(cara.send('ada', 'cara', 'no').ok).toBe(false);
    const after = await readFile(files.pathFor(preservedKey));
    expect(after.equals(before)).toBe(true);

    files.save(`${DIRECT_MESSAGE_STORAGE_DIR}/${conversationKey('bob', 'cara')}`, '{');
    const recovered = new DirectMessageService(files, () => true, { now: () => 3, createId: () => 'recovered' });
    recovered.load();
    expect(recovered.send('bob', 'cara', 'back').ok).toBe(true);
    const restored = JSON.parse(await readFile(files.pathFor(`${DIRECT_MESSAGE_STORAGE_DIR}/${conversationKey('bob', 'cara')}`), 'utf8')) as {
      messages: Array<{ text: string }>;
    };
    expect(restored.messages.map((message) => message.text)).toEqual(['back']);
  });
});

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: pathJoin(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

function lastOf<T extends { type?: string }>(sink: MemorySink, type: string): T | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as T;
    if (payload.type === type) return payload;
  }
  return undefined;
}

function ofType<T extends { type?: string }>(sink: MemorySink, type: string): T[] {
  return sink.payloads.filter((payload) => (payload as T).type === type) as T[];
}

describe('direct messages on the authoritative server', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<{ world: WorldInstance; dir: string }> {
    const dir = dataDir ?? await mkdtemp(pathJoin(tmpdir(), 'fc-dm-world-'));
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return { world, dir };
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function befriend(world: WorldInstance, from: ReturnType<typeof join>, to: ReturnType<typeof join>): void {
    world.handleMenuAction(from.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    world.handleMenuAction(from.player, { type: 'menu_action', action: 'friends_request', name: to.player.name });
    world.handleMenuAction(to.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    const requestId = lastOf<ServerMenuMessage>(to.sink, 'menu')?.friendRequests?.[0]?.requestId;
    expect(requestId).toBeTruthy();
    world.handleMenuAction(to.player, { type: 'menu_action', action: 'friends_accept', requestId });
  }

  it('delivers only to the friend, combines badges, and does not enter world chat', async () => {
    const { world } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    const dana = join(world, 'Dana');
    const eve = join(world, 'Eve');
    befriend(world, ada, bob);
    befriend(world, cara, bob);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'root' });
    world.handleMenuAction(dana.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    world.handleMenuAction(dana.player, { type: 'menu_action', action: 'friends_request', name: 'Bob' });
    expect(world.notifications.counts(bob.player.id).friends).toBe(1);
    expect(lastOf<ServerMenuMessage>(bob.sink, 'menu')?.notifications?.friends).toBe(1);

    const secret = 'secret-dm-alpha';
    for (const text of [`${secret}-1`, `${secret}-2`, `${secret}-3`]) {
      world.handleDirectMessage(ada.player, {
        type: 'direct_message_action',
        action: 'send',
        friendId: bob.player.id,
        text,
        senderId: eve.player.id,
      } as never);
    }
    for (const text of ['cara-1', 'cara-2']) {
      world.handleDirectMessage(cara.player, {
        type: 'direct_message_action',
        action: 'send',
        friendId: bob.player.id,
        text,
      });
    }

    const adaEcho = ofType<ServerDirectMessage>(ada.sink, 'direct_message');
    expect(adaEcho.at(-1)?.event).toBe('append');
    expect(adaEcho.at(-1)?.messages?.[0]?.senderId).toBe(ada.player.id);
    expect(adaEcho.at(-1)?.messages?.[0]?.text).toBe(`${secret}-3`);
    expect(ofType<ServerDirectMessage>(eve.sink, 'direct_message')).toHaveLength(0);
    expect(ofType<ServerDirectMessage>(cara.sink, 'direct_message').some((message) => message.friendId === ada.player.id)).toBe(false);
    const bobDm = ofType<ServerDirectMessage>(bob.sink, 'direct_message');
    expect(bobDm).toHaveLength(0);
    expect(world.directMessages.unreadCount(bob.player.id, ada.player.id)).toBe(3);
    expect(world.directMessages.unreadCount(bob.player.id, cara.player.id)).toBe(2);
    expect(world.notifications.counts(bob.player.id).friends).toBe(1);
    const rooted = lastOf<ServerMenuMessage>(bob.sink, 'menu');
    expect(rooted?.screen).toBe('root');
    expect(rooted?.notifications?.friends).toBe(6);
    for (const sink of [ada.sink, bob.sink, cara.sink, eve.sink]) {
      expect(sink.payloads.some((payload) => {
        const message = payload as { type?: string; text?: string; kind?: string };
        return message.type === 'chat' && (message.text?.includes(secret) || message.kind === 'player' && message.text?.includes('cara-1'));
      })).toBe(false);
      expect(sink.payloads.some((payload) => (payload as { type?: string }).type === 'chat_bubble')).toBe(false);
    }

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    expect(world.notifications.counts(bob.player.id).friends).toBe(0);
    expect(world.directMessages.totalUnread(bob.player.id)).toBe(5);
    const friends = lastOf<ServerMenuMessage>(bob.sink, 'menu');
    expect(friends?.notifications?.friends).toBe(5);
    expect(friends?.friends?.find((row) => row.playerId === ada.player.id)?.unreadCount).toBe(3);
    expect(friends?.friends?.find((row) => row.playerId === cara.player.id)?.unreadCount).toBe(2);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_chat', playerId: ada.player.id });
    const chat = lastOf<ServerMenuMessage>(bob.sink, 'menu');
    expect(chat?.screen).toBe('friend-chat');
    expect(chat?.activeFriendName).toBe('Ada');
    expect(chat?.activeFriendOnline).toBe(true);
    const history = lastOf<ServerDirectMessage>(bob.sink, 'direct_message');
    expect(history?.event).toBe('history');
    expect(history?.messages?.map((message) => message.text)).toEqual([`${secret}-1`, `${secret}-2`, `${secret}-3`]);
    expect(world.directMessages.unreadCount(bob.player.id, ada.player.id)).toBe(0);
    expect(world.directMessages.unreadCount(bob.player.id, cara.player.id)).toBe(2);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'back' });
    expect(lastOf<ServerMenuMessage>(bob.sink, 'menu')?.screen).toBe('friends');
    expect(lastOf<ServerMenuMessage>(bob.sink, 'menu')?.notifications?.friends).toBe(2);

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'friend-chat' });
    expect(lastOf<ServerMenuMessage>(ada.sink, 'menu')?.screen).toBe('friends');

    world.handleDirectMessage(eve.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: ada.player.id,
      text: 'forged',
    });
    world.handleDirectMessage(eve.player, {
      type: 'direct_message_action',
      action: 'history',
      friendId: ada.player.id,
    });
    const eveErrors = ofType<ServerDirectMessage>(eve.sink, 'direct_message');
    expect(eveErrors.every((message) => message.event === 'error' && message.error === DIRECT_MESSAGE_NOT_FRIEND_ERROR)).toBe(true);
    expect(ofType<ServerDirectMessage>(ada.sink, 'direct_message').some((message) => message.messages?.some((row) => row.text === 'forged'))).toBe(false);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_chat', playerId: ada.player.id });
    const beforeRemove = world.directMessages.history(ada.player.id, bob.player.id);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'back' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_delete', playerId: ada.player.id });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_confirm_delete' });
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'still here',
    });
    const rejected = lastOf<ServerDirectMessage>(ada.sink, 'direct_message');
    expect(rejected?.event).toBe('error');
    expect(rejected?.error).toBe(DIRECT_MESSAGE_NOT_FRIEND_ERROR);
    const afterRemove = world.directMessages.history(ada.player.id, bob.player.id);
    expect(afterRemove.ok).toBe(false);
    expect(beforeRemove.ok).toBe(true);

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'friends_request', name: 'Bob' });
    const adaRequest = lastOf<ServerMenuMessage>(bob.sink, 'menu')?.friendRequests?.find((row) => row.playerId === ada.player.id)?.requestId;
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_accept', requestId: adaRequest });
    const restored = world.directMessages.history(bob.player.id, ada.player.id);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.messages.map((message) => message.text)).toEqual([`${secret}-1`, `${secret}-2`, `${secret}-3`]);
  });

  it('marks an open chat read, flushes a closed menu badge, and survives restart', async () => {
    const { world, dir } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    befriend(world, ada, bob);
    const adaToken = ada.player.sessionToken;
    const bobToken = bob.player.sessionToken;

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_chat', playerId: ada.player.id });
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'live',
    });
    expect(lastOf<ServerDirectMessage>(bob.sink, 'direct_message')?.event).toBe('append');
    expect(lastOf<ServerDirectMessage>(bob.sink, 'direct_message')?.friendId).toBe(ada.player.id);
    expect(world.directMessages.unreadCount(bob.player.id, ada.player.id)).toBe(0);
    expect(bob.sink.payloads.some((payload) => {
      const message = payload as { type?: string; text?: string; kind?: string };
      return message.type === 'chat' && message.kind === 'player' && message.text === 'live';
    })).toBe(false);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'back' });
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'later',
    });
    expect(lastOf<ServerMenuMessage>(bob.sink, 'menu')?.screen).toBe('friends');
    expect(lastOf<ServerMenuMessage>(bob.sink, 'menu')?.friends?.find((row) => row.name === 'Ada')?.unreadCount).toBe(1);
    expect(ofType<ServerDirectMessage>(bob.sink, 'direct_message').some((message) => message.messages?.some((row) => row.text === 'later'))).toBe(false);

    const longText = 'я'.repeat(128);
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: longText,
    });
    expect(world.directMessages.history(bob.player.id, ada.player.id).ok).toBe(true);
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'я'.repeat(129),
    });
    expect(lastOf<ServerDirectMessage>(ada.sink, 'direct_message')?.error).toBe(CHAT_TOO_LONG_ERROR);
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: '',
    });
    expect(lastOf<ServerDirectMessage>(ada.sink, 'direct_message')?.error).toBe(DIRECT_MESSAGE_EMPTY_ERROR);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'close' });
    world.disconnect(bob.player.id);
    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'offline-note',
    });
    const resumed = join(world, 'Bob', bobToken);
    expect(world.directMessages.unreadCount(resumed.player.id, ada.player.id)).toBeGreaterThan(0);
    world.handleMenuAction(resumed.player, { type: 'menu_action', action: 'friends_chat', playerId: ada.player.id });
    expect(lastOf<ServerDirectMessage>(resumed.sink, 'direct_message')?.messages?.some((message) => message.text === 'offline-note')).toBe(true);
    world.handleMenuAction(resumed.player, { type: 'menu_action', action: 'close' });

    const conn = resumed.player.connectionId;
    const replaced = join(world, 'Bob', bobToken);
    const before = replaced.sink.payloads.length;
    world.handleDirectMessage(replaced.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: ada.player.id,
      text: 'stale-tab',
    }, { connectionId: conn });
    expect(replaced.sink.payloads.length).toBe(before);
    expect(replaced.player.connected).toBe(true);
    world.disconnect(replaced.player.id, true, conn);
    expect(replaced.player.connected).toBe(true);
    world.handleDirectMessage(replaced.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: ada.player.id,
      text: 'fresh-tab',
    }, { connectionId: replaced.player.connectionId });
    expect(lastOf<ServerDirectMessage>(replaced.sink, 'direct_message')?.messages?.[0]?.text).toBe('fresh-tab');

    await world.stop();
    worlds.splice(worlds.indexOf(world), 1);
    const next = await boot(dir);
    const adaAgain = join(next.world, 'Ada', adaToken);
    const bobAgain = join(next.world, 'Bob', bobToken);
    const kept = next.world.directMessages.history(bobAgain.player.id, adaAgain.player.id);
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.messages.some((message) => message.text === 'offline-note')).toBe(true);
      expect(kept.messages.some((message) => message.text === longText)).toBe(true);
      expect(kept.messages.some((message) => message.text === 'fresh-tab')).toBe(true);
    }
    next.world.handleDirectMessage(adaAgain.player, {
      type: 'direct_message_action',
      action: 'history',
      friendId: bobAgain.player.id,
    });
    expect(lastOf<ServerDirectMessage>(adaAgain.sink, 'direct_message')?.event).toBe('history');
  });

  it('echoes clientRequestId only to the sender and does not store or authorize with it', async () => {
    const { world, dir } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const eve = join(world, 'Eve');
    befriend(world, ada, bob);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'friends_chat', playerId: ada.player.id });

    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'Привет   ',
      clientRequestId: 'req-trail',
    });
    const echo = lastOf<ServerDirectMessage>(ada.sink, 'direct_message');
    expect(echo?.event).toBe('append');
    expect(echo?.clientRequestId).toBe('req-trail');
    expect(echo?.messages?.[0]?.text).toBe('Привет');
    expect(echo?.messages?.[0]?.senderId).toBe(ada.player.id);
    expect(echo?.messages?.[0]?.messageId).not.toBe('req-trail');
    const bobAppend = lastOf<ServerDirectMessage>(bob.sink, 'direct_message');
    expect(bobAppend?.event).toBe('append');
    expect(bobAppend?.messages?.[0]?.text).toBe('Привет');
    expect(bobAppend?.clientRequestId).toBeUndefined();

    const stored = await readFile(pathJoin(
      dir,
      'anarchy',
      'plugin-data',
      DIRECT_MESSAGE_STORAGE_DIR,
      `${conversationKey(ada.player.id, bob.player.id)}.json`,
    ), 'utf8');
    expect(stored).not.toContain('req-trail');
    expect(stored).toContain('"text": "Привет"');
    expect(stored).not.toContain('Привет   ');

    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'без токена',
    });
    expect(lastOf<ServerDirectMessage>(ada.sink, 'direct_message')?.clientRequestId).toBeUndefined();
    expect(lastOf<ServerDirectMessage>(bob.sink, 'direct_message')?.clientRequestId).toBeUndefined();

    for (let index = 0; index < 4; index += 1) {
      world.handleDirectMessage(ada.player, {
        type: 'direct_message_action',
        action: 'send',
        friendId: bob.player.id,
        text: `burst-${index}`,
        clientRequestId: `burst-${index}`,
      });
    }
    const limited = lastOf<ServerDirectMessage>(ada.sink, 'direct_message');
    expect(limited?.event).toBe('error');
    expect(limited?.error).toBe(DIRECT_MESSAGE_RATE_LIMIT_ERROR);
    expect(limited?.clientRequestId).toBe('burst-3');
    expect(bob.sink.payloads.filter((payload) => {
      const message = payload as ServerDirectMessage;
      return message.type === 'direct_message' && message.messages?.some((row) => row.text === 'burst-3');
    })).toHaveLength(0);

    world.handleDirectMessage(eve.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: ada.player.id,
      text: 'чужое',
      clientRequestId: 'req-forged',
    });
    const rejected = lastOf<ServerDirectMessage>(eve.sink, 'direct_message');
    expect(rejected?.event).toBe('error');
    expect(rejected?.clientRequestId).toBe('req-forged');
    expect(rejected?.error).toBe(DIRECT_MESSAGE_NOT_FRIEND_ERROR);
    expect(ofType<ServerDirectMessage>(ada.sink, 'direct_message').some((message) => message.messages?.some((row) => row.text === 'чужое'))).toBe(false);
  });
});
