import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import {
  CLAN_ACTIONS,
  MENU_ACTIONS,
  parseClientMessage,
  type ServerChatMessage,
  type ServerClanMessage,
} from '../../shared/protocol';
import {
  CLAN_ANNOUNCEMENT_COOLDOWN_MS,
  CLAN_ANNOUNCE_EMPTY_ERROR,
  CLAN_INVITE_TTL_MS,
  CLAN_MAX_MEMBERS,
  canClanAnnounce,
  clanAnnounceCooldownLabel,
  clanAnnouncementChat,
  clanInviteChat,
} from '../../shared/clans';
import { CHAT_TOO_LONG_ERROR } from '../../shared/chat';
import { MAX_CHAT_LENGTH } from '../../shared/config';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import {
  CLAN_ALREADY_OTHER_CLAN_ERROR,
  CLAN_FULL_ERROR,
  CLAN_INVITE_MISSING_ERROR,
  CLAN_NOT_IN_CLAN_ERROR,
  CLAN_OWNER_ONLY_ERROR,
  ClanService,
  type ClanRuntime,
} from '../../server/services/clan';

async function tempDir(): Promise<string> {
    return mkdtemp(pathJoin(tmpdir(), 'fc-clan-announce-'));
}

function runtime(
  online: Array<{ id: string; name: string }> = [],
  mail: Array<{ id: string; text: string; extra?: unknown }> = [],
): ClanRuntime {
  const names = new Map(online.map((player) => [player.id, player.name]));
  const connected = new Set(online.map((player) => player.id));
  return {
    onlinePlayers: () => online,
    isOnline: (id) => connected.has(id),
    displayName: (id) => names.get(id) ?? id.slice(0, 8),
    sendMessage: (id, text, extra) => { mail.push({ id, text, extra }); },
    lookupPlayer: (raw) => {
      const lower = raw.trim().toLowerCase();
      const hit = online.find((player) => player.id === raw.trim() || player.name.toLowerCase() === lower);
      return hit ? { id: hit.id, name: hit.name, connected: connected.has(hit.id) } : undefined;
    },
  };
}

describe('clan invitations and announcements', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(now: () => number = Date.now, extraOnline: Array<{ id: string; name: string }> = []) {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const clan = new ClanService(store, economy, now);
    const online = [
      { id: 'leader', name: 'Ada' },
      { id: 'vet', name: 'Bob' },
      { id: 'mem', name: 'Cara' },
      { id: 'out', name: 'Dana' },
      { id: 'other', name: 'Eve' },
      ...extraOnline,
    ];
    const mail: Array<{ id: string; text: string; extra?: unknown }> = [];
    clan.setRuntime(runtime(online, mail));
    economy.deposit('leader', 20_000, 'ADMIN_GIVE');
    economy.deposit('other', 20_000, 'ADMIN_GIVE');
    return { store, economy, clan, mail, now };
  }

  function fillUntilFull(clan: ClanService, economy: EconomyService, leaderId: string): void {
    const leaderClan = clan.playerClan(leaderId)!;
    let index = 0;
    while (leaderClan.memberIds.length < CLAN_MAX_MEMBERS) {
      const id = `fill-${index++}`;
      economy.deposit(id, 1_000, 'ADMIN_GIVE');
      clan.setRuntime(runtime([
        { id: leaderId, name: 'Ada' },
        { id, name: `Fill${index}` },
      ]));
      expect(clan.invitePlayer(leaderId, id).ok).toBe(true);
      expect(clan.acceptInvitation(id, clan.invitationsFor(id)[0]!.invitationId).ok).toBe(true);
    }
  }

  it('uses the menu invitation chat text and lists invites for the recipient', async () => {
    const { clan, mail } = await setup();
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clanInviteChat('Ada', 'Warriors')).toBe(
      'Игрок Ada пригласил вас в клан Warriors. Примите приглашение в меню',
    );
    expect(clanInviteChat('Ada', 'Warriors')).not.toContain('/clan accept');
    expect(clan.invitePlayer('leader', 'out').ok).toBe(true);
    expect(mail).toEqual([expect.objectContaining({
      id: 'out',
      text: clanInviteChat('Ada', 'Warriors'),
    })]);
    const rows = clan.buildMessage('out');
    clan.openAccept('out', { allowInClan: true });
    const list = clan.buildMessage('out');
    expect(list.screen).toBe('accept');
    expect(list.invitations).toHaveLength(1);
    expect(list.invitations?.[0]?.clanName).toBe('Warriors');
    expect(list.invitations?.[0]?.fromName).toBe('Ada');
    expect(list.invitations?.[0]?.remainingLabel).toMatch(/ч|мин/);
    expect(rows.invitations).toBeUndefined();
  });

  it('accepts a valid invite and rejects expired, foreign, full, and already-in-clan cases', async () => {
    let now = 1_000;
    const { clan } = await setup(() => now);
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.createClan('other', 'Foxes', 'moon').ok).toBe(true);
    expect(clan.invitePlayer('leader', 'out').ok).toBe(true);
    const invite = clan.invitationsFor('out')[0]!;
    expect(clan.acceptInvitation('mem', invite.invitationId).error).toBe(CLAN_INVITE_MISSING_ERROR);
    expect(clan.acceptInvitation('out', invite.invitationId).ok).toBe(true);
    expect(clan.playerClan('out')?.name).toBe('Warriors');
    expect(clan.invitationsFor('out')).toHaveLength(0);

    expect(clan.invitePlayer('other', 'vet').ok).toBe(true);
    const otherInvite = clan.invitationsFor('vet')[0]!;
    expect(clan.acceptInvitation('out', otherInvite.invitationId).error).toBe(CLAN_ALREADY_OTHER_CLAN_ERROR);

    now += CLAN_INVITE_TTL_MS + 1;
    expect(clan.invitePlayer('leader', 'mem').ok).toBe(true);
    const late = clan.invitationsFor('mem')[0]!;
    now += CLAN_INVITE_TTL_MS + 1;
    expect(clan.acceptInvitation('mem', late.invitationId).error).toBe(CLAN_INVITE_MISSING_ERROR);
  });

  it('rejects accepting into a full clan', async () => {
    const { clan, economy } = await setup();
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    clan.setRuntime(runtime([{ id: 'leader', name: 'Ada' }, { id: 'mem', name: 'Cara' }]));
    expect(clan.invitePlayer('leader', 'mem').ok).toBe(true);
    fillUntilFull(clan, economy, 'leader');
    clan.setRuntime(runtime([{ id: 'leader', name: 'Ada' }, { id: 'mem', name: 'Cara' }]));
    expect(clan.invitePlayer('leader', 'mem').error).toBe(CLAN_FULL_ERROR);
    const stale = clan.invitationsFor('mem')[0];
    expect(stale).toBeTruthy();
    expect(clan.acceptInvitation('mem', stale!.invitationId).error).toBe(CLAN_FULL_ERROR);
  });

  it('rejects an invitation and keeps other invites', async () => {
    const { clan } = await setup();
    clan.createClan('leader', 'Warriors', 'swords');
    clan.createClan('other', 'Foxes', 'moon');
    expect(clan.invitePlayer('leader', 'out').ok).toBe(true);
    expect(clan.invitePlayer('other', 'out').ok).toBe(true);
    const first = clan.invitationsFor('out').find((row) => row.clanId === clan.playerClan('leader')!.clanId)!;
    expect(clan.rejectInvitation('out', first.invitationId).ok).toBe(true);
    expect(clan.invitationsFor('out')).toHaveLength(1);
    expect(clan.rejectInvitation('leader', clan.invitationsFor('out')[0]!.invitationId).error).toBe(CLAN_INVITE_MISSING_ERROR);
    clan.handleAction('out', {
      type: 'clan_action',
      action: 'reject_invitation',
      invitationId: clan.invitationsFor('out')[0]!.invitationId,
    });
    expect(clan.invitationsFor('out')).toHaveLength(0);
    expect(clan.buildMessage('out').screen).toBe('accept');
  });

  it('lets a player in a clan open menu invitations without joining another clan', async () => {
    const { clan } = await setup();
    clan.createClan('other', 'Foxes', 'moon');
    expect(clan.invitePlayer('other', 'leader').ok).toBe(true);
    expect(clan.invitationsFor('leader')).toHaveLength(1);
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.invitationsFor('leader')).toHaveLength(0);
    expect(clan.openAccept('leader').error).toMatch(/уже состоите/i);
    expect(clan.openAccept('leader', { allowInClan: true }).ok).toBe(true);
    expect(clan.buildMessage('leader').screen).toBe('accept');
    expect(clan.buildMessage('leader').invitations ?? []).toHaveLength(0);
  });

  it('allows only the leader to send a turquoise clan announcement with the chat limit and 3h cooldown', async () => {
    let now = 10_000;
    const { clan, mail, store, economy } = await setup(() => now);
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.invitePlayer('leader', 'vet').ok).toBe(true);
    expect(clan.acceptInvitation('vet', clan.invitationsFor('vet')[0]!.invitationId).ok).toBe(true);
    expect(clan.promoteVeteran('leader', 'vet').ok).toBe(true);
    expect(clan.invitePlayer('leader', 'mem').ok).toBe(true);
    expect(clan.acceptInvitation('mem', clan.invitationsFor('mem')[0]!.invitationId).ok).toBe(true);
    expect(canClanAnnounce('leader')).toBe(true);
    expect(canClanAnnounce('veteran')).toBe(false);
    expect(canClanAnnounce('member')).toBe(false);

    expect(clan.sendAnnouncement('vet', 'Привет').error).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(clan.sendAnnouncement('mem', 'Привет').error).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(clan.sendAnnouncement('out', 'Привет').error).toBe(CLAN_NOT_IN_CLAN_ERROR);
    expect(clan.sendAnnouncement('leader', '   ').error).toBe(CLAN_ANNOUNCE_EMPTY_ERROR);
    expect(clan.sendAnnouncement('leader', 'x'.repeat(MAX_CHAT_LENGTH + 1)).error).toBe(CHAT_TOO_LONG_ERROR);

    mail.length = 0;
    expect(clan.sendAnnouncement('leader', 'Сегодня в 20:00 идём фармить данжи').ok).toBe(true);
    const expected = clanAnnouncementChat('Сегодня в 20:00 идём фармить данжи');
    expect(expected).toBe('[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] "Сегодня в 20:00 идём фармить данжи"');
    expect(mail.map((row) => row.id).sort()).toEqual(['leader', 'mem', 'vet']);
    expect(mail.every((row) => row.text === expected)).toBe(true);
    expect(mail[0]?.extra).toEqual({ channel: 'clan', style: 'announcement' });

    const cooling = clan.sendAnnouncement('leader', 'Ещё раз');
    expect(cooling.ok).toBe(false);
    expect(cooling.error).toBe(clanAnnounceCooldownLabel(CLAN_ANNOUNCEMENT_COOLDOWN_MS));
    clan.openAnnounce('leader');
    expect(clan.buildMessage('leader').announceCooldownLabel).toContain('Повторная отправка через');
    expect(clan.buildMessage('leader').card?.canAnnounce).toBe(true);

    const again = new ClanService(store, economy, () => now);
    again.setRuntime(runtime([
      { id: 'leader', name: 'Ada' },
      { id: 'vet', name: 'Bob' },
      { id: 'mem', name: 'Cara' },
    ]));
    expect(again.sendAnnouncement('leader', 'После рестарта').error).toContain('Повторная отправка через');

    now += CLAN_ANNOUNCEMENT_COOLDOWN_MS + 1;
    expect(again.sendAnnouncement('leader', 'После кулдауна').ok).toBe(true);

    expect(clan.makeLeader('leader', 'vet').ok).toBe(true);
    expect(clan.openAnnounce('leader').error).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(clan.sendAnnouncement('leader', 'Я больше не глава').error).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(clan.openAnnounce('vet').ok).toBe(true);
    expect(clan.buildMessage('vet').card?.canAnnounce).toBe(true);
    expect(clan.buildMessage('leader').card?.canAnnounce).toBeFalsy();
  });

  it('keeps cooldown per clan and missing cooldown fields as no cooldown', async () => {
    let now = 20_000;
    const { clan, store, economy } = await setup(() => now);
    clan.createClan('leader', 'Alpha', 'swords');
    clan.createClan('other', 'Beta', 'moon');
    expect(clan.sendAnnouncement('leader', 'Alpha news').ok).toBe(true);
    expect(clan.sendAnnouncement('other', 'Beta news').ok).toBe(true);
    expect(clan.sendAnnouncement('leader', 'Alpha again').ok).toBe(false);
    expect(clan.sendAnnouncement('other', 'Beta again').ok).toBe(false);

    const raw = store.load<{ clans: Array<Record<string, unknown>> }>('clans/clans', { clans: [] });
    const stripped = raw.clans.map((entry, index) => (index === 0
      ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'announcementCooldownUntil'))
      : entry));
    store.save('clans/clans', { ...raw, clans: stripped });
    const migrated = new ClanService(store, economy, () => now);
    migrated.setRuntime(runtime([{ id: 'leader', name: 'Ada' }, { id: 'other', name: 'Eve' }]));
    const first = migrated.playerClan('leader');
    const second = migrated.playerClan('other');
    expect(first?.announcementCooldownUntil).toBeUndefined();
    expect(second?.announcementCooldownUntil).toBeGreaterThan(now);
    expect(migrated.sendAnnouncement('leader', 'Migrated clan can send').ok).toBe(true);
    expect(migrated.sendAnnouncement('other', 'Still cooling').ok).toBe(false);
  });

  it('types new protocol actions and rejects oversized announcement text', () => {
    expect(CLAN_ACTIONS).toContain('send_announcement');
    expect(CLAN_ACTIONS).toContain('reject_invitation');
    expect(CLAN_ACTIONS).toContain('open_announce');
    expect(CLAN_ACTIONS).toContain('set_announce_text');
    expect(MENU_ACTIONS).toContain('clans_invitations');
    expect(parseClientMessage({ type: 'clan_action', action: 'send_announcement', text: 'ok' })).toMatchObject({
      action: 'send_announcement',
      text: 'ok',
    });
    expect(parseClientMessage({
      type: 'clan_action',
      action: 'send_announcement',
      text: 'x'.repeat(MAX_CHAT_LENGTH + 1),
    })).toMatchObject({ error: 'clan_action.text too long' });
    expect(parseClientMessage({ type: 'menu_action', action: 'clans_invitations' })).toMatchObject({
      action: 'clans_invitations',
    });
    expect(parseClientMessage({ type: 'clan_action', action: 'announcement' })).toMatchObject({
      error: 'clan_action.action invalid',
    });
  });

  it('does not invent a missing clan when accepting a dangling invite', async () => {
    const { clan } = await setup();
    clan.createClan('leader', 'Ghosts', 'skull');
    expect(clan.invitePlayer('leader', 'out').ok).toBe(true);
    const invite = clan.invitationsFor('out')[0]!;
    expect(clan.deleteClan('leader').ok).toBe(true);
    expect(clan.acceptInvitation('out', invite.invitationId).error).toBe(CLAN_INVITE_MISSING_ERROR);
  });
});

describe('clan invitation and announcement live protocol', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

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

  class MemorySink implements ConnectedSink {
    readonly payloads: unknown[] = [];
    send(payload: unknown): void {
      this.payloads.push(payload);
    }
  }

  function chats(sink: MemorySink): ServerChatMessage[] {
    return sink.payloads.filter((payload): payload is ServerChatMessage => {
      return !!payload && typeof payload === 'object' && (payload as { type?: string }).type === 'chat';
    });
  }

  function lastClan(sink: MemorySink): ServerClanMessage | undefined {
    for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
      const payload = sink.payloads[index] as { type?: string };
      if (payload.type === 'clan') return payload as ServerClanMessage;
    }
    return undefined;
  }

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

  it('opens menu invitations, delivers styled announcements only to current members, and hides the button from veterans', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    const eve = join(world, 'Eve');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'clans_create' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'set_name', name: 'Warriors' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'select_icon', icon: 'swords' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'confirm_create' });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'close' });

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'clans_mine' });
    expect(lastClan(ada.sink)?.card?.canAnnounce).toBe(true);
    bob.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'invite_by_name', name: 'Bob' });
    expect(chats(bob.sink).some((row) => row.text === clanInviteChat('Ada', 'Warriors'))).toBe(true);

    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'clans' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'clans_invitations' });
    const invites = lastClan(bob.sink);
    expect(invites?.screen).toBe('accept');
    expect(invites?.source).toBe('menu');
    const invitationId = invites?.invitations?.[0]?.invitationId;
    expect(invitationId).toBeTruthy();
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'confirm_accept', invitationId });
    expect(world.clan.playerClan(bob.player.id)?.name).toBe('Warriors');

    world.handleClanAction(ada.player, { type: 'clan_action', action: 'promote_veteran', playerId: bob.player.id });
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'invite_by_name', name: 'Cara' });
    const caraInvite = world.clan.invitationsFor(cara.player.id)[0]!.invitationId;
    world.handleClanAction(cara.player, { type: 'clan_action', action: 'confirm_accept', invitationId: caraInvite });

    ada.sink.payloads.length = 0;
    bob.sink.payloads.length = 0;
    cara.sink.payloads.length = 0;
    eve.sink.payloads.length = 0;
    world.handleClanAction(ada.player, { type: 'clan_action', action: 'open_announce' });
    expect(lastClan(ada.sink)?.screen).toBe('announce');
    world.handleClanAction(ada.player, {
      type: 'clan_action',
      action: 'send_announcement',
      text: 'Сегодня в 20:00 идём фармить данжи',
    });
    const line = clanAnnouncementChat('Сегодня в 20:00 идём фармить данжи');
    expect(chats(ada.sink).some((row) => row.text === line && row.style === 'announcement' && row.channel === 'clan')).toBe(true);
    expect(chats(bob.sink).some((row) => row.text === line && row.style === 'announcement')).toBe(true);
    expect(chats(cara.sink).some((row) => row.text === line)).toBe(true);
    expect(chats(eve.sink).some((row) => row.text === line)).toBe(false);

    world.handleClanAction(bob.player, { type: 'clan_action', action: 'open_announce' });
    expect(lastClan(bob.sink)?.screen).not.toBe('announce');
    expect(lastClan(bob.sink)?.card?.canAnnounce).toBeFalsy();
    world.handleClanAction(bob.player, { type: 'clan_action', action: 'send_announcement', text: 'bypass' });
    expect(chats(cara.sink).filter((row) => row.style === 'announcement')).toHaveLength(1);
    expect(world.clan.playerClan(cara.player.id)?.memberIds.includes(cara.player.id)).toBe(true);
    world.handleClanAction(cara.player, { type: 'clan_action', action: 'confirm_leave' });
    expect(world.clan.playerClan(cara.player.id)).toBeUndefined();
  });
});
