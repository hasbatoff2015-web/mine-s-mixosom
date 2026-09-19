import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAN_ALREADY_IN_OTHER_CLAN_ERROR,
  CLAN_ALREADY_IN_THIS_CLAN_ERROR,
  CLAN_INVITE_EXISTS_ERROR,
  CLAN_INVITE_SENT_MESSAGE,
  CLAN_KICK_DENIED_ERROR,
  CLAN_PLAYER_NOT_FOUND_ERROR,
  canClanInvite,
  canClanKick,
  canClanManageVeterans,
  canClanTransferLeader,
} from '../../shared/clans';
import { RANKING_MAX_ENTRIES, RANKING_MAX_PAGES, RANKING_PAGE_SIZE, sliceRankingPage } from '../../shared/ranking';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService } from '../../server/services/economy';
import { FriendsService } from '../../server/services/friends';
import { ClanService, CLAN_FULL_ERROR, type ClanRuntime } from '../../server/services/clan';
import { buildRankingSnapshot } from '../../server/services/gameMenu';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-clan-roles-'));
}

function runtime(
  online: Array<{ id: string; name: string }> = [],
  extra: Partial<ClanRuntime> = {},
): ClanRuntime {
  const names = new Map(online.map((player) => [player.id, player.name]));
  const connected = new Set(online.map((player) => player.id));
  return {
    onlinePlayers: () => online,
    isOnline: (id) => connected.has(id),
    displayName: (id) => names.get(id) ?? extra.displayName?.(id) ?? id.slice(0, 8),
    sendMessage: extra.sendMessage ?? (() => {}),
    lookupPlayer: extra.lookupPlayer ?? ((raw) => {
      const lower = raw.trim().toLowerCase();
      const hit = online.find((player) => player.id === raw.trim() || player.name.toLowerCase() === lower);
      return hit ? { id: hit.id, name: hit.name, connected: connected.has(hit.id) } : undefined;
    }),
    friendRelation: extra.friendRelation,
    requestFriend: extra.requestFriend,
    cancelFriendRequest: extra.cancelFriendRequest,
  };
}

describe('clan roles, ranking and kills', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const friends = new FriendsService(store);
    const clan = new ClanService(store, economy);
    const online = [
      { id: 'leader', name: 'Ada' },
      { id: 'vet', name: 'Bob' },
      { id: 'mem', name: 'Cara' },
      { id: 'out', name: 'Dana' },
      { id: 'other', name: 'Eve' },
    ];
    friends.setRuntime({
      isOnline: (id) => online.some((player) => player.id === id),
      displayName: (id) => online.find((player) => player.id === id)?.name ?? id,
      lookupPlayer: (raw) => {
        const lower = raw.trim().toLowerCase();
        const hit = online.find((player) => player.id === raw.trim() || player.id === lower || player.name.toLowerCase() === lower);
        return hit ? { id: hit.id, name: hit.name, connected: true } : undefined;
      },
      sendMessage: () => undefined,
    });
    friends.load();
    clan.setRuntime(runtime(online, {
      friendRelation: (a, b) => friends.relation(a, b),
      requestFriend: (a, b) => friends.request(a, b),
      cancelFriendRequest: (a, b) => friends.cancelOutgoing(a, b),
    }));
    for (const player of ['leader', 'vet', 'mem', 'out', 'other']) {
      economy.deposit(player, 20_000, 'ADMIN_GIVE');
    }
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.invitePlayer('leader', 'vet').ok).toBe(true);
    expect(clan.acceptInvitation('vet', clan.invitationsFor('vet')[0]!.invitationId).ok).toBe(true);
    expect(clan.invitePlayer('leader', 'mem').ok).toBe(true);
    expect(clan.acceptInvitation('mem', clan.invitationsFor('mem')[0]!.invitationId).ok).toBe(true);
    expect(clan.promoteVeteran('leader', 'vet').ok).toBe(true);
    return { store, economy, friends, clan };
  }

  it('assigns leader/veteran/member and allows unlimited veterans', async () => {
    const { clan } = await setup();
    const record = clan.playerClan('leader')!;
    expect(clan.roleOf(record, 'leader')).toBe('leader');
    expect(clan.roleOf(record, 'vet')).toBe('veteran');
    expect(clan.roleOf(record, 'mem')).toBe('member');
    expect(canClanInvite('leader')).toBe(true);
    expect(canClanInvite('veteran')).toBe(true);
    expect(canClanInvite('member')).toBe(false);
    expect(canClanManageVeterans('leader')).toBe(true);
    expect(canClanManageVeterans('veteran')).toBe(false);
    expect(clan.promoteVeteran('leader', 'mem').ok).toBe(true);
    expect(clan.roleOf(clan.playerClan('leader')!, 'mem')).toBe('veteran');
    expect(clan.playerClan('leader')!.memberIds.filter((id) => clan.roleOf(clan.playerClan('leader')!, id) === 'veteran'))
      .toHaveLength(2);
  });

  it('lets a veteran invite and kick members but not veterans or the leader', async () => {
    const { clan } = await setup();
    expect(clan.invitePlayer('vet', 'out').ok).toBe(true);
    expect(clan.kickMember('vet', 'mem').ok).toBe(true);
    expect(clan.playerClan('mem')).toBeUndefined();
    expect(clan.kickMember('vet', 'leader').error).toBe(CLAN_KICK_DENIED_ERROR);
    expect(clan.invitePlayer('leader', 'mem').ok).toBe(true);
    expect(clan.acceptInvitation('mem', clan.invitationsFor('mem')[0]!.invitationId).ok).toBe(true);
    expect(clan.promoteVeteran('leader', 'mem').ok).toBe(true);
    expect(clan.kickMember('vet', 'mem').error).toBe(CLAN_KICK_DENIED_ERROR);
    expect(clan.kickMember('mem', 'vet').error).toBe(CLAN_KICK_DENIED_ERROR);
    expect(canClanKick('veteran', 'member')).toBe(true);
    expect(canClanKick('veteran', 'veteran')).toBe(false);
    expect(canClanKick('veteran', 'leader')).toBe(false);
    expect(canClanKick('member', 'member')).toBe(false);
  });

  it('lets the leader promote, demote and transfer only to a veteran', async () => {
    const { clan } = await setup();
    expect(clan.promoteVeteran('leader', 'mem').ok).toBe(true);
    expect(clan.demoteVeteran('leader', 'mem').ok).toBe(true);
    expect(clan.roleOf(clan.playerClan('leader')!, 'mem')).toBe('member');
    expect(canClanTransferLeader('leader', 'member')).toBe(false);
    expect(clan.makeLeader('leader', 'mem').error).toMatch(/ветерану/i);
    expect(clan.makeLeader('leader', 'vet').ok).toBe(true);
    const after = clan.playerClan('vet')!;
    expect(after.ownerId).toBe('vet');
    expect(clan.roleOf(after, 'vet')).toBe('leader');
    expect(clan.roleOf(after, 'leader')).toBe('veteran');
  });

  it('returns user-facing invite errors and a success confirmation', async () => {
    const { clan, economy } = await setup();
    expect(clan.invitePlayerByName('leader', '').error).toMatch(/ник/i);
    expect(clan.invitePlayerByName('leader', 'Nobody').error).toBe(CLAN_PLAYER_NOT_FOUND_ERROR);
    expect(clan.invitePlayerByName('leader', 'Ada').error).toMatch(/себя|состоит/i);
    expect(clan.invitePlayerByName('leader', 'Cara').error).toBe(CLAN_ALREADY_IN_THIS_CLAN_ERROR);
    economy.deposit('other', 20_000, 'ADMIN_GIVE');
    expect(clan.createClan('other', 'Foxes', 'moon').ok).toBe(true);
    expect(clan.invitePlayerByName('leader', 'Eve').error).toBe(CLAN_ALREADY_IN_OTHER_CLAN_ERROR);
    const extra = Array.from({ length: 17 }, (_u, i) => ({ id: `p${i}`, name: `P${i}` }));
    clan.setRuntime(runtime([
      { id: 'leader', name: 'Ada' }, { id: 'vet', name: 'Bob' }, { id: 'mem', name: 'Cara' },
      { id: 'out', name: 'Dana' }, ...extra,
    ]));
    for (const player of extra) {
      economy.deposit(player.id, 100, 'ADMIN_GIVE');
      clan.invitePlayer('leader', player.id);
      clan.acceptInvitation(player.id, clan.invitationsFor(player.id)[0]!.invitationId);
    }
    expect(clan.invitePlayerByName('leader', 'Dana').error).toBe(CLAN_FULL_ERROR);
    clan.kickMember('leader', extra[0]!.id);
    const sent = clan.invitePlayerByName('leader', 'Dana');
    expect(sent.ok).toBe(true);
    expect(clan.session('leader').inviteMessage).toBe(CLAN_INVITE_SENT_MESSAGE);
    expect(clan.invitePlayerByName('leader', 'Dana').error).toBe(CLAN_INVITE_EXISTS_ERROR);
  });

  it('snapshots online/offline when opening the clan card', async () => {
    const { clan } = await setup();
    clan.setRuntime(runtime([{ id: 'leader', name: 'Ada' }, { id: 'mem', name: 'Cara' }]));
    clan.handleAction('leader', { type: 'clan_action', action: 'select_clan', clanId: clan.playerClan('leader')!.clanId });
    const snap = clan.buildMessage('leader');
    const ada = snap.members?.find((row) => row.playerId === 'leader');
    const bob = snap.members?.find((row) => row.playerId === 'vet');
    expect(ada?.online).toBe(true);
    expect(bob?.online).toBe(false);
    expect(snap.members?.[0]?.role).toBe('leader');
  });

  it('supports friend request, already-friend, outgoing cancel and self on the member card', async () => {
    const { clan, friends } = await setup();
    clan.handleAction('leader', { type: 'clan_action', action: 'select_clan', clanId: clan.playerClan('leader')!.clanId });
    clan.handleAction('leader', { type: 'clan_action', action: 'select_member', playerId: 'leader' });
    expect(clan.buildMessage('leader').playerCard?.isSelf).toBe(true);
    expect(clan.buildMessage('leader').playerCard?.friendState).toBe('self');
    clan.handleAction('leader', { type: 'clan_action', action: 'select_member', playerId: 'mem' });
    clan.handleAction('leader', { type: 'clan_action', action: 'friends_request', playerId: 'mem' });
    expect(clan.buildMessage('leader').playerCard?.friendState).toBe('outgoing');
    clan.handleAction('leader', { type: 'clan_action', action: 'friends_cancel', playerId: 'mem' });
    expect(friends.outgoingRequests('leader')).toHaveLength(0);
    expect(clan.buildMessage('leader').playerCard?.friendState).toBe('none');
    friends.request('leader', 'Cara');
    friends.accept('mem', friends.incomingRequests('mem')[0]!.requestId);
    clan.handleAction('leader', { type: 'clan_action', action: 'select_member', playerId: 'mem' });
    expect(clan.buildMessage('leader').playerCard?.friendState).toBe('friend');
  });

  it('sorts members by money or kills with the leader always first', async () => {
    const { clan, economy } = await setup();
    economy.setBalance('leader', 100, 'ADMIN_SET');
    economy.setBalance('vet', 9_000, 'ADMIN_SET');
    economy.setBalance('mem', 5_000, 'ADMIN_SET');
    economy.recordPvpKill('mem', 'out', 'd1');
    economy.recordPvpKill('mem', 'out', 'd2');
    economy.recordPvpKill('vet', 'out', 'd3');
    clan.handleAction('leader', { type: 'clan_action', action: 'select_clan', clanId: clan.playerClan('leader')!.clanId });
    const byMoney = clan.buildMessage('leader').members!;
    expect(byMoney.map((row) => row.playerId)).toEqual(['leader', 'vet', 'mem']);
    clan.handleAction('leader', { type: 'clan_action', action: 'set_member_sort', sort: 'kills' });
    const byKills = clan.buildMessage('leader').members!;
    expect(byKills[0]?.playerId).toBe('leader');
    expect(byKills.slice(1).map((row) => row.playerId)).toEqual(['mem', 'vet']);
  });

  it('sorts clan search independently by money and kills', async () => {
    const { clan, economy } = await setup();
    economy.setBalance('leader', 1_000, 'ADMIN_SET');
    economy.recordPvpKill('leader', 'out', 'k1');
    economy.recordPvpKill('leader', 'out', 'k2');
    economy.recordPvpKill('leader', 'out', 'k3');
    expect(clan.createClan('other', 'Alpha', 'moon').ok).toBe(true);
    economy.setBalance('other', 80_000, 'ADMIN_SET');
    clan.openRanking('leader');
    expect(clan.buildMessage('leader').clans[0]?.name).toBe('Alpha');
    clan.handleAction('leader', { type: 'clan_action', action: 'set_ranking_sort', sort: 'kills' });
    expect(clan.buildMessage('leader').clans[0]?.name).toBe('Warriors');
    expect(clan.buildMessage('leader').clans[0]?.killsLabel).toMatch(/Уб/);
  });

  it('counts clan kills from current members only', async () => {
    const { clan, economy } = await setup();
    economy.recordPvpKill('out', 'other', 'prejoin');
    economy.recordPvpKill('mem', 'other', 'm1');
    const before = clan.clanKills(clan.playerClan('leader')!);
    expect(before).toBe(1);
    clan.invitePlayer('leader', 'out');
    clan.acceptInvitation('out', clan.invitationsFor('out')[0]!.invitationId);
    expect(clan.clanKills(clan.playerClan('leader')!)).toBe(2);
    clan.kickMember('leader', 'out');
    expect(clan.clanKills(clan.playerClan('leader')!)).toBe(1);
  });

  it('migrates old clans without roles and old players without kills', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    store.save('clans/clans', {
      nextClanId: 2,
      nextInvitationId: 1,
      nextRequestId: 1,
      clans: [{
        clanId: 'clan-1',
        name: 'Legacy',
        nameKey: 'legacy',
        icon: 'swords',
        ownerId: 'leader',
        memberIds: ['leader', 'mem'],
        createdAt: 1,
      }],
      invitations: [],
      requests: [],
    });
    store.save('economy/balances', {
      players: [{ playerId: 'leader', balance: 500, name: 'Ada' }],
    });
    const economy = new EconomyService(store);
    const clan = new ClanService(store, economy);
    const loaded = clan.getClan('clan-1')!;
    expect(clan.roleOf(loaded, 'leader')).toBe('leader');
    expect(clan.roleOf(loaded, 'mem')).toBe('member');
    expect(economy.getKills('leader')).toBe(0);
    expect(economy.getBalance('leader')).toBe(500);
  });

  it('builds four independent rankings with top-50, 10/page and personal place', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const clan = new ClanService(store, economy);
    const online: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < 55; i += 1) {
      const id = `p${i.toString().padStart(2, '0')}`;
      online.push({ id, name: `N${i.toString().padStart(2, '0')}` });
      economy.rememberName(id, `N${i.toString().padStart(2, '0')}`);
      economy.setBalance(id, 1000 - i, 'ADMIN_SET');
      for (let k = 0; k < (54 - i); k += 1) economy.recordPvpKill(id, 'victim', `${id}-${k}`);
    }
    clan.setRuntime(runtime(online));
    economy.deposit('p00', 20_000, 'ADMIN_GIVE');
    expect(clan.createClan('p00', 'Rich', 'swords').ok).toBe(true);
    economy.deposit('p54', 20_000, 'ADMIN_GIVE');
    expect(clan.createClan('p54', 'KillerClan', 'moon').ok).toBe(true);
    economy.setBalance('p54', 1, 'ADMIN_SET');
    const money = buildRankingSnapshot(clan, economy, 'p37', 'players-money', 1);
    expect(money.ratingRows).toHaveLength(RANKING_PAGE_SIZE);
    expect(money.ratingTotalPages).toBe(RANKING_MAX_PAGES);
    expect(money.ratingRows![0]?.highlight).toBe(false);
    expect(money.personalRank).toBe(38);
    expect(money.personalText).toBe('Ваше место: #38');
    const page4 = buildRankingSnapshot(clan, economy, 'p37', 'players-money', 4);
    expect(page4.ratingRows?.some((row) => row.highlight)).toBe(true);
    const late = buildRankingSnapshot(clan, economy, 'p54', 'players-money', 1);
    expect(late.personalRank).toBeGreaterThan(50);
    expect(late.personalText).toBe(`Ваше место: #${late.personalRank}`);
    const pkills = buildRankingSnapshot(clan, economy, 'p00', 'players-kills', 1);
    expect(pkills.ratingRows![0]?.id).toBe('p00');
    const clanMoney = buildRankingSnapshot(clan, economy, 'p00', 'clans-money', 1);
    expect(clanMoney.ratingRows?.some((row) => row.highlight && row.name === 'Rich')).toBe(true);
    const clanKills = buildRankingSnapshot(clan, economy, 'p54', 'clans-kills', 1);
    expect(clanKills.ratingRows![0]?.name).toBe('Rich');
    expect(clanKills.ratingRows?.some((row) => row.name === 'KillerClan' && row.highlight)).toBe(true);
    const none = buildRankingSnapshot(clan, economy, 'p10', 'clans-money', 1);
    expect(none.personalText).toBe('Вы не состоите в клане');
    expect(sliceRankingPage(Array.from({ length: 60 }, (_, i) => i), 1).items).toHaveLength(10);
    expect(sliceRankingPage(Array.from({ length: 60 }, (_, i) => i), 1).totalCount).toBe(RANKING_MAX_ENTRIES);
    expect(sliceRankingPage(Array.from({ length: 12 }, (_, i) => i), 1).totalPages).toBe(2);
    expect(sliceRankingPage(Array.from({ length: 12 }, (_, i) => i), 1).totalPages).toBeLessThanOrEqual(RANKING_MAX_PAGES);
  });

  it('uses a stable name tie-breaker for equal scores', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    economy.rememberName('b', 'Beta');
    economy.rememberName('a', 'Alpha');
    economy.setBalance('a', 50, 'ADMIN_SET');
    economy.setBalance('b', 50, 'ADMIN_SET');
    const ranked = economy.rankPlayers('money');
    expect(ranked.map((row) => row.name)).toEqual(['Alpha', 'Beta']);
  });
});
