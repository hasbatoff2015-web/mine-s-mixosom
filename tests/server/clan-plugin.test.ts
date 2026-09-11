import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { ServerClanMessage } from '../../shared/protocol';
import { CLAN_CREATE_COST } from '../../shared/clans';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-clan-plugin-'));
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

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

function lastClan(sink: MemorySink): ServerClanMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload.type === 'clan') return payload as ServerClanMessage;
  }
  return undefined;
}

describe('Clan plugin', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
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

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  it('opens ranking, create, add, accept and list help', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/clans')[0]).toMatch(/рейтинг/i);
    expect(lastClan(ada.sink)?.screen).toBe('ranking');
    expect(chat(world, ada, '/clan create')[0]).toMatch(/клана/i);
    expect(lastClan(ada.sink)?.screen).toBe('create');
    expect(chat(world, ada, '/clan help').some((line) => line.includes('/clan create'))).toBe(true);
  });

  it('creates a clan from the GUI confirm flow and lists it in /clans', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Warriors' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'create' });
    expect(lastClan(ada.sink)?.screen).toBe('create-confirm');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    const card = lastClan(ada.sink);
    expect(card?.screen).toBe('card');
    expect(card?.card?.name).toBe('Warriors');
    expect(world.economy.getBalance(ada.player.id)).toBe(20_100 - CLAN_CREATE_COST);
    chat(world, ada, '/clans');
    expect(lastClan(ada.sink)?.clans.some((row) => row.name === 'Warriors')).toBe(true);
  });

  it('invites an online player and accepts from /clan accept', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Foxes' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'moon' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    chat(world, ada, '/clan add');
    expect(lastClan(ada.sink)?.players?.some((row) => row.name === 'Bob')).toBe(true);
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_player', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_invite' });
    chat(world, bob, '/clan accept');
    const invite = lastClan(bob.sink)?.invitations?.[0];
    expect(invite?.clanName).toBe('Foxes');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'select_invitation', invitationId: invite!.invitationId });
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_accept' });
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Foxes');
  });

  it('notifies the invited player in chat and accepts from the clan card', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Foxes' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'moon' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    const foxesId = world.clan.playerClan(ada.player.id)!.clanId;
    chat(world, ada, '/clan add');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_player', playerId: bob.player.id });
    bob.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_invite' });
    expect(resultLines(bob.sink).some((line) => /пригласил вас в клан Foxes/.test(line))).toBe(true);
    chat(world, bob, '/clans');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'select_clan', clanId: foxesId });
    expect(lastClan(bob.sink)?.card?.joinState).toBe('invited');
    expect(lastClan(bob.sink)?.card?.joinLabel).toBe('Вступить в клан');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'join', clanId: foxesId });
    expect(lastClan(bob.sink)?.screen).toBe('accept-confirm');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_accept' });
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Foxes');
  });

  it('lets a former owner create a new clan after makeleader and leave', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Foxes' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'moon' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    chat(world, ada, '/clan add');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_player', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_invite' });
    chat(world, bob, '/clan accept');
    const invite = lastClan(bob.sink)?.invitations?.[0];
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'select_invitation', invitationId: invite!.invitationId });
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_accept' });
    chat(world, ada, '/clan makeleader');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_member', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_makeleader' });
    expect(world.clan.playerClan(ada.player.id)?.ownerId).toBe(bob.player.id);
    chat(world, ada, '/clan leave');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_leave' });
    expect(world.clan.playerClan(ada.player.id)).toBeUndefined();
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    expect(lastClan(ada.sink)?.screen).toBe('create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'NewClan' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'flame' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    expect(world.clan.playerClan(ada.player.id)?.name).toBe('NewClan');
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Foxes');
  });

  it('keeps search text on refresh and clamps the page', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Warriors' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    chat(world, ada, '/clans');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'search', search: 'war' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'page', page: 9 });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'refresh' });
    const snap = lastClan(ada.sink);
    expect(snap?.search).toBe('war');
    expect(snap?.page).toBe(1);
    expect(snap?.clans[0]?.name).toBe('Warriors');
  });

  it('replaces a pending join request and lets the owner accept it', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const carl = join(world, 'Carl');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    world.economy.deposit(carl.player.id, 20_000, 'ADMIN_GIVE');
    chat(world, ada, '/clan create');
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Warriors' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    chat(world, carl, '/clan create');
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'set_name', name: 'Foxes' });
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'select_icon', icon: 'moon' });
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'confirm_create' });
    const warriorsId = world.clan.playerClan(ada.player.id)!.clanId;
    const foxesId = world.clan.playerClan(carl.player.id)!.clanId;
    chat(world, bob, '/clans');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'select_clan', clanId: warriorsId });
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'join' });
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_join' });
    expect(lastClan(bob.sink)?.card?.joinState).toBe('sent');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'select_clan', clanId: foxesId });
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'join' });
    expect(lastClan(bob.sink)?.screen).toBe('replace-request-confirm');
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_replace_request' });
    expect(world.clan.playerRequest(bob.player.id)?.clanId).toBe(foxesId);
    chat(world, carl, '/clans');
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'select_clan', clanId: foxesId });
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'open_requests' });
    const request = lastClan(carl.sink)?.requests?.[0];
    expect(request?.name).toBe('Bob');
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'select_request', requestId: request!.requestId });
    world.handleClanAction(carl.player, { type: 'clan_action', action: 'confirm_accept_request' });
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Foxes');
    expect(world.clan.playerRequest(bob.player.id)).toBeUndefined();
  });
});
