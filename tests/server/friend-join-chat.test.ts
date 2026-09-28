import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { ServerChatMessage } from '../../shared/protocol';
import { friendJoinChatText } from '../../shared/friends';
import { ChatLog } from '../../src/chat/ChatLog';

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
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function friendNotices(sink: MemorySink, name: string): ServerChatMessage[] {
  return sink.payloads.filter((payload): payload is ServerChatMessage => {
    const record = payload as ServerChatMessage;
    return record.type === 'chat' && record.text === friendJoinChatText(name);
  });
}

describe('friend join system chat', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-friend-join-'));
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function joinPlayer(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function befriend(world: WorldInstance, fromId: string, targetName: string, targetId: string): void {
    const sent = world.friends.request(fromId, targetName);
    expect(sent.ok, sent.error).toBe(true);
    expect(world.friends.accept(targetId, sent.request!.requestId).ok).toBe(true);
    expect(world.friends.isFriend(fromId, targetId)).toBe(true);
  }

  it('tells only online friends when a player goes from offline to online', async () => {
    const world = await boot();
    const ada = joinPlayer(world, 'Ada');
    const cara = joinPlayer(world, 'Cara');
    const bob = joinPlayer(world, 'Bob');
    befriend(world, ada.player.id, 'Bob', bob.player.id);
    for (const player of [ada, cara, bob]) player.sink.payloads.length = 0;

    world.disconnect(bob.player.id);
    const returned = joinPlayer(world, 'Bob', bob.player.sessionToken);

    const notice = friendNotices(ada.sink, 'Bob');
    expect(notice).toHaveLength(1);
    expect(notice[0]).toEqual({
      type: 'chat',
      messageId: expect.any(String),
      from: 'server',
      playerId: 'server',
      text: 'Друг Bob зашел в игру.',
      kind: 'system',
    });
    expect(notice[0]?.style).toBeUndefined();
    expect(notice[0]?.messageId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(friendNotices(cara.sink, 'Bob')).toHaveLength(0);
    expect(friendNotices(returned.sink, 'Bob')).toHaveLength(0);
    expect(friendNotices(bob.sink, 'Bob')).toHaveLength(0);

    const log = new ChatLog();
    const entry = log.push('system', notice[0]!.text, 0, { id: notice[0]!.messageId });
    expect(entry.kind).toBe('system');
    expect(entry.style).toBeUndefined();
    expect(readFileSync('src/style.css', 'utf8')).toContain('.chat-line.kind-system { color: #c8c8c8; }');
  });

  it('does not treat a pending request as a friendship', async () => {
    const world = await boot();
    const ada = joinPlayer(world, 'Ada');
    const bob = joinPlayer(world, 'Bob');
    const sent = world.friends.request(ada.player.id, 'Bob');
    expect(sent.ok).toBe(true);
    expect(world.friends.isFriend(ada.player.id, bob.player.id)).toBe(false);
    ada.sink.payloads.length = 0;
    world.disconnect(bob.player.id);
    joinPlayer(world, 'Bob', bob.player.sessionToken);
    expect(friendNotices(ada.sink, 'Bob')).toHaveLength(0);
  });

  it('does not notify again when an already online player replaces the session', async () => {
    const world = await boot();
    const ada = joinPlayer(world, 'Ada');
    const bob = joinPlayer(world, 'Bob');
    befriend(world, ada.player.id, 'Bob', bob.player.id);
    ada.sink.payloads.length = 0;
    expect(bob.player.connected).toBe(true);
    const takeover = joinPlayer(world, 'Bob', bob.player.sessionToken);
    expect(takeover.resumed).toBe(true);
    expect(bob.player.connected).toBe(true);
    expect(friendNotices(ada.sink, 'Bob')).toHaveLength(0);
  });

  it('notifies once per real rejoin and shares one message id across friends', async () => {
    const world = await boot();
    const ada = joinPlayer(world, 'Ada');
    const dana = joinPlayer(world, 'Dana');
    const cara = joinPlayer(world, 'Cara');
    const bob = joinPlayer(world, 'Bob');
    befriend(world, ada.player.id, 'Bob', bob.player.id);
    befriend(world, dana.player.id, 'Bob', bob.player.id);
    for (const player of [ada, dana, cara]) player.sink.payloads.length = 0;

    world.disconnect(bob.player.id);
    expect(bob.player.connected).toBe(false);
    const returned = joinPlayer(world, 'Bob', bob.player.sessionToken);
    const adaNotice = friendNotices(ada.sink, 'Bob');
    const danaNotice = friendNotices(dana.sink, 'Bob');
    expect(adaNotice).toHaveLength(1);
    expect(danaNotice).toHaveLength(1);
    expect(adaNotice[0]?.messageId).toBe(danaNotice[0]?.messageId);
    expect(friendNotices(cara.sink, 'Bob')).toHaveLength(0);
    expect(friendNotices(returned.sink, 'Bob')).toHaveLength(0);

    for (const player of [ada, dana, cara]) player.sink.payloads.length = 0;
    joinPlayer(world, 'Bob', bob.player.sessionToken);
    expect(friendNotices(ada.sink, 'Bob')).toHaveLength(0);

    world.disconnect(bob.player.id);
    for (const player of [ada, dana]) player.sink.payloads.length = 0;
    joinPlayer(world, 'Bob', bob.player.sessionToken);
    expect(friendNotices(ada.sink, 'Bob')).toHaveLength(1);
    expect(friendNotices(dana.sink, 'Bob')).toHaveLength(1);
  });
});
