import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { parseClientMessage, type ServerChatMessage } from '../../shared/protocol';
import { CHAT_NO_CLAN_HINT, CHAT_TOO_LONG_ERROR } from '../../shared/chat';
import { MAX_CHAT_LENGTH } from '../../shared/config';
import { CLAN_CREATE_COST } from '../../shared/clans';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-chat-channels-'));
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

function playerChats(sink: MemorySink): ServerChatMessage[] {
  return sink.payloads.filter((payload): payload is ServerChatMessage => {
    const record = payload as { type?: string; kind?: string };
    return record.type === 'chat' && record.kind === 'player';
  });
}

function lastClan(sink: MemorySink): { invitations?: { invitationId: string }[] } | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload.type === 'clan') return payload as { invitations?: { invitationId: string }[] };
  }
  return undefined;
}

function errorChats(sink: MemorySink): string[] {
  return sink.payloads.flatMap((payload) => {
    const record = payload as { type?: string; kind?: string; text?: string };
    return record.type === 'chat' && record.kind === 'error' && record.text ? [record.text] : [];
  });
}

describe('server chat channels', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function createClan(world: WorldInstance, owner: ReturnType<typeof join>, name: string): void {
    world.economy.deposit(owner.player.id, CLAN_CREATE_COST, 'ADMIN_GIVE');
    world.handleChat(owner.player, '/clan create');
    world.handleClanAction(owner.player, { type: 'clan_action', action: 'set_name', name });
    world.handleClanAction(owner.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(owner.player, { type: 'clan_action', action: 'confirm_create' });
  }

  function inviteAndAccept(
    world: WorldInstance,
    owner: ReturnType<typeof join>,
    member: ReturnType<typeof join>,
  ): void {
    world.handleChat(owner.player, '/clan add');
    world.handleClanAction(owner.player, { type: 'clan_action', action: 'select_player', playerId: member.player.id });
    world.handleClanAction(owner.player, { type: 'clan_action', action: 'confirm_invite' });
    world.handleChat(member.player, '/clan accept');
    const invite = lastClan(member.sink)?.invitations?.[0];
    world.handleClanAction(member.player, {
      type: 'clan_action',
      action: 'select_invitation',
      invitationId: invite!.invitationId,
    });
    world.handleClanAction(member.player, { type: 'clan_action', action: 'confirm_accept' });
  }

  it('sends global chat to every connected player once', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    world.handleChat(ada.player, 'hello anarchy');
    expect(playerChats(ada.sink)).toEqual([expect.objectContaining({
      from: 'Ada',
      playerId: ada.player.id,
      text: 'hello anarchy',
      channel: 'global',
    })]);
    expect(playerChats(bob.sink)).toHaveLength(1);
    expect(playerChats(ada.sink)[0]?.messageId).toBe(playerChats(bob.sink)[0]?.messageId);
  });

  it('routes nearby chat by inclusive 3D server distance and includes the sender', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const near = join(world, 'Near');
    const edge = join(world, 'Edge');
    const far = join(world, 'Far');
    const above = join(world, 'Above');
    ada.player.controller.teleport([0, 70, 0]);
    near.player.controller.teleport([10, 70, 0]);
    edge.player.controller.teleport([20, 70, 0]);
    far.player.controller.teleport([21, 70, 0]);
    above.player.controller.teleport([0, 91, 0]);
    for (const player of [ada, near, edge, far, above]) player.sink.payloads.length = 0;
    world.handleChat(ada.player, 'hi nearby', 'nearby');
    expect(playerChats(ada.sink)).toHaveLength(1);
    expect(playerChats(near.sink)).toHaveLength(1);
    expect(playerChats(edge.sink)).toHaveLength(1);
    expect(playerChats(far.sink)).toHaveLength(0);
    expect(playerChats(above.sink)).toHaveLength(0);
    expect(playerChats(ada.sink)[0]).toMatchObject({ channel: 'nearby', from: 'Ada', text: 'hi nearby' });
    expect(new Set([
      playerChats(ada.sink)[0]?.messageId,
      playerChats(near.sink)[0]?.messageId,
      playerChats(edge.sink)[0]?.messageId,
    ]).size).toBe(1);
  });

  it('counts Y in nearby distance and still delivers when nobody else is in range', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.player.controller.teleport([0, 70, 0]);
    bob.player.controller.teleport([0, 90, 0]);
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    world.handleChat(ada.player, 'same column', 'nearby');
    expect(playerChats(bob.sink)).toHaveLength(1);
    bob.player.controller.teleport([80, 70, 80]);
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    world.handleChat(ada.player, 'alone', 'nearby');
    expect(playerChats(ada.sink)).toHaveLength(1);
    expect(playerChats(bob.sink)).toHaveLength(0);
    expect(errorChats(ada.sink)).toHaveLength(0);
  });

  it('routes clan chat through ClanService and does not leak to outsiders', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const carl = join(world, 'Carl');
    createClan(world, ada, 'Foxes');
    inviteAndAccept(world, ada, bob);
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Foxes');
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    carl.sink.payloads.length = 0;
    world.handleChat(ada.player, 'всем привет', 'clan');
    expect(playerChats(ada.sink)).toHaveLength(1);
    expect(playerChats(bob.sink)).toHaveLength(1);
    expect(playerChats(carl.sink)).toHaveLength(0);
    expect(playerChats(ada.sink)[0]).toMatchObject({ channel: 'clan', text: 'всем привет', from: 'Ada' });
    expect(playerChats(ada.sink)[0]?.messageId).toBe(playerChats(bob.sink)[0]?.messageId);
  });

  it('blocks clan send without membership and follows live ClanService leave/join', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, 'no clan', 'clan');
    expect(playerChats(ada.sink)).toHaveLength(0);
    expect(errorChats(ada.sink)).toContain(CHAT_NO_CLAN_HINT);

    createClan(world, ada, 'Foxes');
    inviteAndAccept(world, ada, bob);
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    world.handleChat(bob.player, 'joined', 'clan');
    expect(playerChats(ada.sink)).toHaveLength(1);

    world.handleChat(bob.player, '/clan leave');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_leave' });
    expect(world.clan.playerClan(bob.player.id)).toBeUndefined();
    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    world.handleChat(ada.player, 'after leave', 'clan');
    expect(playerChats(ada.sink)).toHaveLength(1);
    expect(playerChats(bob.sink)).toHaveLength(0);
    world.handleChat(bob.player, 'still trying', 'clan');
    expect(playerChats(ada.sink)).toHaveLength(1);
    expect(errorChats(bob.sink)).toContain(CHAT_NO_CLAN_HINT);
  });

  it('does not replay messages from before a player connected', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.handleChat(ada.player, 'before bob');
    const bob = join(world, 'Bob');
    expect(playerChats(bob.sink).some((message) => message.text === 'before bob')).toBe(false);
    bob.sink.payloads.length = 0;
    world.handleChat(ada.player, 'after bob');
    expect(playerChats(bob.sink).some((message) => message.text === 'after bob')).toBe(true);
  });

  it('validates length server-side and ignores empty text', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, 'a'.repeat(MAX_CHAT_LENGTH));
    expect(playerChats(ada.sink)).toHaveLength(1);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, 'a'.repeat(MAX_CHAT_LENGTH + 1));
    expect(playerChats(ada.sink)).toHaveLength(0);
    expect(errorChats(ada.sink)).toContain(CHAT_TOO_LONG_ERROR);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '');
    expect(playerChats(ada.sink)).toHaveLength(0);
    expect(errorChats(ada.sink)).toHaveLength(0);
  });

  it('does not trust forged sender, recipients, or clan fields on the wire', () => {
    const parsed = parseClientMessage({
      type: 'chat',
      text: 'hack',
      channel: 'clan',
      from: 'NotAda',
      playerId: 'someone-else',
      recipients: ['victim'],
      clanId: 'forged-clan',
    });
    expect(parsed).toEqual({ type: 'chat', text: 'hack', channel: 'clan' });
    expect(parsed).not.toHaveProperty('from');
    expect(parsed).not.toHaveProperty('recipients');
    expect(parsed).not.toHaveProperty('clanId');
    expect(parsed).not.toHaveProperty('playerId');
  });
});
