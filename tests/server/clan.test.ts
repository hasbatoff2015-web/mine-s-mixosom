import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClientMessage } from '../../shared/protocol';
import {
  CLAN_CREATE_COST,
  CLAN_ICON_IDS,
  CLAN_INVITE_TTL_MS,
  CLAN_MAX_MEMBERS,
  CLAN_NAME_CHARS_ERROR,
  CLAN_NAME_LENGTH_ERROR,
  CLAN_REQUEST_TTL_MS,
  defaultClanCreatePolicy,
  validateClanName,
} from '../../shared/clans';
import { formatCompactMegacoins } from '../../shared/megacoins';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import {
  CLAN_ALREADY_MEMBER_ERROR,
  CLAN_ALREADY_OTHER_CLAN_ERROR,
  CLAN_FULL_ERROR,
  CLAN_INVITE_SELF_ERROR,
  CLAN_KICK_SELF_ERROR,
  CLAN_NAME_TAKEN_ERROR,
  CLAN_OFFLINE_INVITE_ERROR,
  CLAN_OWNER_LEAVE_ERROR,
  CLAN_OWNER_ONLY_ERROR,
  ClanService,
  type ClanRuntime,
} from '../../server/services/clan';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-clan-'));
}

function runtime(online: Array<{ id: string; name: string }> = []): ClanRuntime {
  const names = new Map(online.map((player) => [player.id, player.name]));
  const connected = new Set(online.map((player) => player.id));
  return {
    onlinePlayers: () => online,
    isOnline: (id) => connected.has(id),
    displayName: (id) => names.get(id) ?? id.slice(0, 8),
  };
}

describe('ClanService', () => {
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
    const online = [{ id: 'owner', name: 'Ada' }, { id: 'bob', name: 'Bob' }, { id: 'carl', name: 'Carl' }, ...extraOnline];
    clan.setRuntime(runtime(online));
    economy.deposit('owner', 20_000, 'ADMIN_GIVE');
    economy.deposit('bob', 1_000, 'ADMIN_GIVE');
    economy.deposit('carl', 500, 'ADMIN_GIVE');
    return { store, economy, clan };
  }

  it('validates names and compact megacoin labels', () => {
    expect(validateClanName('Wa')).toEqual({ ok: false, error: CLAN_NAME_LENGTH_ERROR });
    expect(validateClanName('A'.repeat(17)).ok).toBe(false);
    expect(validateClanName('War<script>').ok).toBe(false);
    expect(validateClanName('Bad!')).toEqual({ ok: false, error: CLAN_NAME_CHARS_ERROR });
    expect(validateClanName('  Snow Fox  ')).toEqual({ ok: true, name: 'Snow Fox' });
    expect(formatCompactMegacoins(0)).toBe('0');
    expect(formatCompactMegacoins(999)).toBe('999');
    expect(formatCompactMegacoins(1000)).toBe('1К');
    expect(formatCompactMegacoins(1200)).toBe('1.2К');
    expect(formatCompactMegacoins(550300)).toBe('550.3К');
    expect(formatCompactMegacoins(1_000_000)).toBe('1М');
    expect(formatCompactMegacoins(1_250_000)).toBe('1.3М');
    expect(formatCompactMegacoins(156_340_000)).toBe('156.3М');
    expect(formatCompactMegacoins(1_000_000_000)).toBe('1МЛРД');
  });

  it('creates a clan, charges 10 000, and persists the owner', async () => {
    const { clan, economy, store } = await setup();
    const created = clan.createClan('owner', 'Warriors', 'swords');
    expect(created.ok).toBe(true);
    expect(economy.getBalance('owner')).toBe(20_100 - CLAN_CREATE_COST);
    expect(clan.playerClan('owner')?.ownerId).toBe('owner');
    expect(clan.playerClan('owner')?.memberIds).toEqual(['owner']);
    const again = new ClanService(store, economy);
    expect(again.playerClan('owner')?.name).toBe('Warriors');
  });

  it('rejects insufficient funds, duplicate membership, and case-insensitive names', async () => {
    const { clan, economy } = await setup();
    expect(clan.createClan('broke', 'NoCash', 'shield').error).toMatch(/Недостаточно/);
    expect(clan.createClan('owner', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.createClan('owner', 'Other', 'flame').error).toBe(CLAN_ALREADY_MEMBER_ERROR);
    economy.deposit('bob', 20_000, 'ADMIN_GIVE');
    expect(clan.createClan('bob', 'warriors', 'crown').error).toBe(CLAN_NAME_TAKEN_ERROR);
    expect(clan.createClan('bob', 'xx', 'crown').error).toBe(CLAN_NAME_LENGTH_ERROR);
  });

  it('uses the playtime hook without requiring playtime today', async () => {
    expect(defaultClanCreatePolicy.canCreateClan('x')).toEqual({ ok: true });
    const { store, economy } = await setup();
    const blocked = new ClanService(store, economy, Date.now, {
      canCreateClan: () => ({ ok: false, error: 'Нужно больше 10 часов игры.' }),
    });
    blocked.setRuntime(runtime([{ id: 'owner', name: 'Ada' }]));
    economy.deposit('owner', 20_000, 'ADMIN_GIVE');
    expect(blocked.createClan('owner', 'Late', 'moon').error).toBe('Нужно больше 10 часов игры.');
  });

  it('ranks by live balances, then member count, then createdAt', async () => {
    const { clan, economy } = await setup();
    const first = clan.createClan('owner', 'Alpha', 'swords');
    economy.deposit('bob', 20_000, 'ADMIN_GIVE');
    const second = clan.createClan('bob', 'Beta', 'shield');
    economy.deposit('carl', 20_000, 'ADMIN_GIVE');
    clan.createClan('carl', 'Gamma', 'flame');
    economy.deposit('owner', 5_000_000, 'ADMIN_GIVE');
    const ranked = clan.ranked();
    expect(ranked[0]?.clan.clanId).toBe(first.clan?.clanId);
    economy.withdraw('owner', 5_000_000, 'ADMIN_TAKE');
    economy.deposit('bob', 5_000_000, 'ADMIN_GIVE');
    expect(clan.ranked()[0]?.clan.clanId).toBe(second.clan?.clanId);
  });

  it('invites only online clanless players and accepts with 24h expiry', async () => {
    let now = 1_000;
    const { clan } = await setup(() => now);
    expect(clan.createClan('owner', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.invitePlayer('owner', 'owner').error).toBe(CLAN_INVITE_SELF_ERROR);
    clan.setRuntime(runtime([{ id: 'owner', name: 'Ada' }]));
    expect(clan.invitePlayer('owner', 'bob').error).toBe(CLAN_OFFLINE_INVITE_ERROR);
    clan.setRuntime(runtime([{ id: 'owner', name: 'Ada' }, { id: 'bob', name: 'Bob' }, { id: 'carl', name: 'Carl' }]));
    expect(clan.invitePlayer('owner', 'bob').ok).toBe(true);
    const invite = clan.invitationsFor('bob')[0]!;
    now += CLAN_INVITE_TTL_MS + 1;
    expect(clan.acceptInvitation('bob', invite.invitationId).error).toMatch(/истекло|не найдено/i);
    now = 2_000;
    expect(clan.invitePlayer('owner', 'bob').ok).toBe(true);
    const fresh = clan.invitationsFor('bob')[0]!;
    expect(clan.acceptInvitation('bob', fresh.invitationId).ok).toBe(true);
    expect(clan.playerClan('bob')?.name).toBe('Warriors');
    expect(clan.invitationsFor('bob')).toHaveLength(0);
  });

  it('drops leftover invitations after joining any clan', async () => {
    const { clan, economy } = await setup();
    clan.createClan('owner', 'Warriors', 'swords');
    economy.deposit('carl', 20_000, 'ADMIN_GIVE');
    clan.createClan('carl', 'Foxes', 'moon');
    clan.invitePlayer('owner', 'bob');
    clan.invitePlayer('carl', 'bob');
    expect(clan.invitationsFor('bob')).toHaveLength(2);
    const first = clan.invitationsFor('bob')[0]!;
    expect(clan.acceptInvitation('bob', first.invitationId).ok).toBe(true);
    expect(clan.invitationsFor('bob')).toHaveLength(0);
  });

  it('replaces a single join request and expires after 24h', async () => {
    let now = 5_000;
    const { clan, economy } = await setup(() => now);
    clan.createClan('owner', 'Warriors', 'swords');
    economy.deposit('carl', 20_000, 'ADMIN_GIVE');
    const fox = clan.createClan('carl', 'Foxes', 'moon');
    const first = clan.requestJoin('bob', clan.playerClan('owner')!.clanId, false);
    expect(first.ok).toBe(true);
    const blocked = clan.requestJoin('bob', fox.clan!.clanId, false);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Warriors/);
    expect(clan.requestJoin('bob', fox.clan!.clanId, true).ok).toBe(true);
    expect(clan.playerRequest('bob')?.clanId).toBe(fox.clan!.clanId);
    now += CLAN_REQUEST_TTL_MS + 1;
    expect(clan.playerRequest('bob')).toBeUndefined();
  });

  it('accepts a request, rejects a full clan, and clears pending on join', async () => {
    const extra = Array.from({ length: 18 }, (_u, i) => ({ id: `p${i}`, name: `P${i}` }));
    const { clan, economy } = await setup(Date.now, extra);
    expect(clan.createClan('owner', 'Warriors', 'swords').ok).toBe(true);
    clan.invitePlayer('owner', 'bob');
    expect(clan.acceptInvitation('bob', clan.invitationsFor('bob')[0]!.invitationId).ok).toBe(true);
    for (const player of extra) {
      economy.deposit(player.id, 100, 'ADMIN_GIVE');
      clan.requestJoin(player.id, clan.playerClan('owner')!.clanId, true);
      const request = clan.playerRequest(player.id)!;
      expect(clan.acceptRequest('owner', request.requestId).ok).toBe(true);
    }
    expect(clan.playerClan('owner')?.memberIds.length).toBe(CLAN_MAX_MEMBERS);
    expect(clan.requestJoin('carl', clan.playerClan('owner')!.clanId, true).error).toBe(CLAN_FULL_ERROR);
  });

  it('transfers leadership, forbids owner leave, and allows kick', async () => {
    const { clan } = await setup();
    clan.createClan('owner', 'Warriors', 'swords');
    clan.invitePlayer('owner', 'bob');
    clan.acceptInvitation('bob', clan.invitationsFor('bob')[0]!.invitationId);
    expect(clan.leaveClan('owner').error).toBe(CLAN_OWNER_LEAVE_ERROR);
    expect(clan.kickMember('owner', 'owner').error).toBe(CLAN_KICK_SELF_ERROR);
    expect(clan.makeLeader('owner', 'bob').ok).toBe(true);
    expect(clan.playerClan('owner')?.ownerId).toBe('bob');
    expect(clan.leaveClan('owner').ok).toBe(true);
    expect(clan.playerClan('owner')).toBeUndefined();
    clan.invitePlayer('bob', 'carl');
    clan.acceptInvitation('carl', clan.invitationsFor('carl')[0]!.invitationId);
    expect(clan.kickMember('bob', 'carl').ok).toBe(true);
    expect(clan.playerClan('carl')).toBeUndefined();
  });

  it('deletes a clan and releases members, invitations and requests', async () => {
    const { clan, economy, store } = await setup();
    clan.createClan('owner', 'Warriors', 'swords');
    clan.invitePlayer('owner', 'bob');
    clan.acceptInvitation('bob', clan.invitationsFor('bob')[0]!.invitationId);
    clan.requestJoin('carl', clan.playerClan('owner')!.clanId, false);
    expect(clan.deleteClan('bob').error).toBe(CLAN_OWNER_ONLY_ERROR);
    expect(clan.deleteClan('owner').ok).toBe(true);
    expect(clan.playerClan('owner')).toBeUndefined();
    expect(clan.invitationsFor('bob')).toHaveLength(0);
    expect(clan.playerRequest('carl')).toBeUndefined();
    expect(economy.getBalance('owner')).toBe(20_100 - CLAN_CREATE_COST);
    const again = new ClanService(store, economy);
    expect(again.ranked()).toHaveLength(0);
  });

  it('serializes last-slot and duplicate join races', async () => {
    const extra = Array.from({ length: 17 }, (_u, i) => ({ id: `p${i}`, name: `P${i}` }));
    const { clan, economy } = await setup(Date.now, extra);
    clan.createClan('owner', 'Warriors', 'swords');
    clan.invitePlayer('owner', 'bob');
    clan.acceptInvitation('bob', clan.invitationsFor('bob')[0]!.invitationId);
    for (const player of extra) {
      clan.requestJoin(player.id, clan.playerClan('owner')!.clanId, true);
      clan.acceptRequest('owner', clan.playerRequest(player.id)!.requestId);
    }
    economy.deposit('z1', 100, 'ADMIN_GIVE');
    economy.deposit('z2', 100, 'ADMIN_GIVE');
    clan.setRuntime(runtime([
      { id: 'owner', name: 'Ada' },
      { id: 'bob', name: 'Bob' },
      { id: 'z1', name: 'Z1' },
      { id: 'z2', name: 'Z2' },
      ...extra,
    ]));
    const clanId = clan.playerClan('owner')!.clanId;
    clan.requestJoin('z1', clanId, true);
    clan.requestJoin('z2', clanId, true);
    const a = clan.requestsForClan(clanId).find((row) => row.playerId === 'z1')!;
    const b = clan.requestsForClan(clanId).find((row) => row.playerId === 'z2')!;
    expect(clan.acceptRequest('owner', a.requestId).ok).toBe(true);
    expect(clan.acceptRequest('owner', b.requestId).ok).toBe(false);
    expect(clan.playerClan('z2')).toBeUndefined();
    expect(clan.playerClan('z1')?.memberIds.length).toBe(CLAN_MAX_MEMBERS);
  });

  it('paginates and searches ranking snapshots', async () => {
    const { clan, economy } = await setup();
    for (let i = 0; i < 8; i += 1) {
      const id = `c${i}`;
      economy.deposit(id, 20_000 + i * 100, 'ADMIN_GIVE');
      clan.setRuntime(runtime([{ id, name: `N${i}` }, { id: 'owner', name: 'Ada' }]));
      expect(clan.createClan(id, `Clan${i}`, CLAN_ICON_IDS[i % 10]!).ok).toBe(true);
    }
    clan.openRanking('viewer', 'clan1');
    const snap = clan.buildMessage('viewer');
    expect(snap.screen).toBe('ranking');
    expect(snap.clans.every((row) => row.name.toLowerCase().includes('clan1'))).toBe(true);
    clan.handleAction('viewer', { type: 'clan_action', action: 'search', search: '' });
    clan.handleAction('viewer', { type: 'clan_action', action: 'page', page: 2 });
    const page2 = clan.buildMessage('viewer');
    expect(page2.page).toBe(2);
    expect(page2.totalPages).toBeGreaterThan(1);
    clan.handleAction('viewer', { type: 'clan_action', action: 'refresh' });
    expect(clan.buildMessage('viewer').search).toBe('');
  });

  it('parses clan protocol intents', () => {
    expect(parseClientMessage({ type: 'clan_action', action: 'join', clanId: 'clan-1' })).toMatchObject({
      type: 'clan_action',
      action: 'join',
      clanId: 'clan-1',
    });
    expect(parseClientMessage({ type: 'clan_action', action: 'explode' }))
      .toEqual({ error: 'clan_action.action invalid' });
  });
});
