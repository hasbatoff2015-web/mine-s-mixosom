import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { JsonFileStore } from '../../server/services/jsonStore';
import { EconomyService, formatMegacoins } from '../../server/services/economy';
import { AuctionService } from '../../server/services/auction';
import { NotificationService } from '../../server/services/notifications';
import { FriendsService } from '../../server/services/friends';
import { TradeService } from '../../server/services/trade';
import { ClanService, type ClanRuntime } from '../../server/services/clan';
import { Inventory, createItemStack } from '../../src/inventory';
import {
  MENU_ACTIONS,
  MENU_SCREENS,
  parseClientMessage,
  type ServerChatMessage,
  type ServerMenuMessage,
} from '../../shared/protocol';
import { clanAnnouncementChat, clanInviteChat } from '../../shared/clans';
import {
  AUCTION_HISTORY_TTL_MS,
  AUCTION_HISTORY_UI_LIMIT,
  auctionHistoryTitle,
  formatHoursAgo,
} from '../../shared/auctionHistory';
import { formatNotificationBadge } from '../../shared/notifications';
import { displayNameFor } from '../../src/i18n/displayNames';
import { FRIENDS_DUPLICATE_REQUEST_ERROR } from '../../shared/friends';
import { TRADE_DUPLICATE_REQUEST_ERROR } from '../../shared/trade';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-notify-hist-'));
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

function lastMenu(sink: MemorySink): ServerMenuMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as ServerMenuMessage;
    if (payload.type === 'menu') return payload;
  }
  return undefined;
}

function chats(sink: MemorySink): ServerChatMessage[] {
  return sink.payloads.filter((row): row is ServerChatMessage => (
    typeof row === 'object' && row !== null && (row as { type?: string }).type === 'chat'
  ));
}

describe('announcement format and relative time', () => {
  it('formats clan announcements without quotes', () => {
    expect(clanAnnouncementChat('Сегодня в 20:00 идём фармить данжи'))
      .toBe('[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] - Сегодня в 20:00 идём фармить данжи');
    expect(clanAnnouncementChat('текст')).not.toContain('"');
  });

  it('declines hours ago in Russian', () => {
    const now = 10_000_000;
    expect(formatHoursAgo(now - 10 * 60_000, now)).toBe('меньше часа назад');
    expect(formatHoursAgo(now - 3_600_000, now)).toBe('1 час назад');
    expect(formatHoursAgo(now - 2 * 3_600_000, now)).toBe('2 часа назад');
    expect(formatHoursAgo(now - 4 * 3_600_000, now)).toBe('4 часа назад');
    expect(formatHoursAgo(now - 5 * 3_600_000, now)).toBe('5 часов назад');
    expect(formatHoursAgo(now - 20 * 3_600_000, now)).toBe('20 часов назад');
    expect(formatHoursAgo(now - 21 * 3_600_000, now)).toBe('21 час назад');
    expect(formatHoursAgo(now - 22 * 3_600_000, now)).toBe('22 часа назад');
    expect(formatHoursAgo(now - 23 * 3_600_000, now)).toBe('23 часа назад');
  });

  it('caps badge labels at 99+', () => {
    expect(formatNotificationBadge(0)).toBeUndefined();
    expect(formatNotificationBadge(1)).toBe('1');
    expect(formatNotificationBadge(10)).toBe('10');
    expect(formatNotificationBadge(99)).toBe('99');
    expect(formatNotificationBadge(100)).toBe('99+');
  });
});

describe('AuctionService deal history', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(now?: () => number) {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store, now);
    const notifications = new NotificationService(store);
    const auction = new AuctionService(store, economy, now);
    auction.setRuntime({
      notifyUnread: (playerId, category) => { notifications.notify(playerId, category); },
    });
    return { store, economy, auction, notifications };
  }

  function fill(inventory: Inventory, itemId: string, count: number, slot = 0): void {
    inventory.setSlot(slot, createItemStack(itemId, count));
  }

  it('records buy and sell after a confirmed purchase with actual quantity and price', async () => {
    let now = 1_000_000;
    const { auction, economy, notifications } = await setup(() => now);
    const sellerInv = new Inventory();
    fill(sellerInv, 'diamond', 32);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 32, 12_000);
    expect(created.ok).toBe(true);
    expect(auction.historyEntries()).toEqual([]);
    economy.setBalance('buyer', 20_000, 'ADMIN_SET');
    now += 2 * 3_600_000;
    const bought = auction.buyListing('buyer', 'Bob', new Inventory(), created.listing!.listingId);
    expect(bought.ok).toBe(true);
    const sell = auction.historyEntries('seller');
    const buy = auction.historyEntries('buyer');
    expect(sell).toHaveLength(1);
    expect(buy).toHaveLength(1);
    expect(sell[0]).toMatchObject({
      type: 'sell', itemId: 'diamond', quantity: 32, totalPrice: 12_000, timestamp: now,
    });
    expect(buy[0]).toMatchObject({
      type: 'buy', itemId: 'diamond', quantity: 32, totalPrice: 12_000, timestamp: now,
    });
    const sellRow = auction.historyRows('seller')[0]!;
    expect(sellRow.title).toBe(auctionHistoryTitle('sell', 32, displayNameFor('diamond', 'ru'), formatMegacoins(12_000)));
    expect(sellRow.title).toBe('Вы продали 32 Алмаз за 12 000 Мегакоинов');
    expect(sellRow.ago).toBe('меньше часа назад');
    expect(auction.historyRows('buyer')[0]!.title).toBe('Вы купили 32 Алмаз за 12 000 Мегакоинов');
    expect(notifications.counts('seller').auction).toBe(1);
    expect(notifications.counts('buyer').auction).toBe(0);
  });

  it('records the actual stack size for a completed listing sale', async () => {
    const { auction, economy } = await setup();
    const sellerInv = new Inventory();
    fill(sellerInv, 'iron_ingot', 16);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 16, 4800);
    economy.setBalance('buyer', 10_000, 'ADMIN_SET');
    expect(auction.buyListing('buyer', 'Bob', new Inventory(), created.listing!.listingId).ok).toBe(true);
    expect(auction.historyEntries('buyer')[0]).toMatchObject({
      type: 'buy', itemId: 'iron_ingot', quantity: 16, totalPrice: 4800,
    });
    expect(auction.historyRows('buyer')[0]!.title).toContain(displayNameFor('iron_ingot', 'ru'));
  });

  it('does not record create, cancel, claim, or failed purchases', async () => {
    const { auction, economy, notifications } = await setup();
    const sellerInv = new Inventory();
    fill(sellerInv, 'diamond', 3);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 3, 250);
    expect(auction.historyEntries()).toEqual([]);
    expect(auction.cancelListing('seller', created.listing!.listingId).ok).toBe(true);
    expect(auction.claimListing('seller', new Inventory(), created.listing!.listingId).ok).toBe(true);
    expect(auction.historyEntries()).toEqual([]);

    fill(sellerInv, 'diamond', 1);
    const live = auction.createListing('seller', 'Ada', sellerInv, 0, 1, 50);
    expect(auction.buyListing('seller', 'Ada', new Inventory(), live.listing!.listingId).ok).toBe(false);
    economy.setBalance('broke', 0, 'ADMIN_SET');
    expect(auction.buyListing('broke', 'Bob', new Inventory(), live.listing!.listingId).ok).toBe(false);
    const full = new Inventory();
    for (let i = 0; i < Inventory.SLOT_COUNT; i += 1) full.setSlot(i, createItemStack('dirt', 64));
    economy.setBalance('full', 500, 'ADMIN_SET');
    expect(auction.buyListing('full', 'Carl', full, live.listing!.listingId).ok).toBe(false);
    expect(auction.historyEntries()).toEqual([]);
    expect(notifications.counts('seller').auction).toBe(0);
  });

  it('keeps at most 20 fresh rows in the UI and drops entries older than 24h', async () => {
    let now = 5_000;
    const { auction, economy, store } = await setup(() => now);
    economy.setBalance('buyer', 1_000_000, 'ADMIN_SET');
    const sellerInv = new Inventory();
    for (let i = 0; i < 21; i += 1) {
      fill(sellerInv, 'dirt', 1);
      const created = auction.createListing('seller', 'Ada', sellerInv, 0, 1, 10);
      now += 1_000;
      expect(auction.buyListing('buyer', 'Bob', new Inventory(), created.listing!.listingId).ok).toBe(true);
    }
    expect(auction.historyEntries('seller').length).toBeGreaterThan(AUCTION_HISTORY_UI_LIMIT);
    const rows = auction.historyRows('seller');
    expect(rows).toHaveLength(AUCTION_HISTORY_UI_LIMIT);
    expect(rows[0]!.timestamp).toBeGreaterThan(rows[19]!.timestamp);

    now += AUCTION_HISTORY_TTL_MS;
    expect(auction.historyRows('seller')).toEqual([]);
    expect(auction.historyEntries('seller')).toEqual([]);

    const reloaded = new AuctionService(store, new EconomyService(store, () => now), () => now);
    expect(reloaded.historyEntries()).toEqual([]);
  });

  it('persists history across reload', async () => {
    const { auction, economy, store } = await setup();
    const sellerInv = new Inventory();
    fill(sellerInv, 'diamond', 2);
    const created = auction.createListing('seller', 'Ada', sellerInv, 0, 2, 40);
    economy.setBalance('buyer', 100, 'ADMIN_SET');
    expect(auction.buyListing('buyer', 'Bob', new Inventory(), created.listing!.listingId).ok).toBe(true);
    const again = new AuctionService(store, new EconomyService(store));
    expect(again.historyEntries('seller')).toHaveLength(1);
    expect(again.historyEntries('buyer')[0]?.itemId).toBe('diamond');
  });
});

describe('NotificationService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('treats missing fields as zero and persists counters', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    store.save('notifications/unread', { players: { old: { friends: 2 } } });
    const notifications = new NotificationService(store);
    expect(notifications.counts('old')).toEqual({ friends: 2, clans: 0, auction: 0, trade: 0 });
    expect(notifications.counts('missing')).toEqual({ friends: 0, clans: 0, auction: 0, trade: 0 });
    notifications.notify('bob', 'clans');
    notifications.notify('bob', 'clans');
    notifications.clear('bob', 'clans');
    notifications.notify('bob', 'clans');
    const reloaded = new NotificationService(store);
    expect(reloaded.counts('bob').clans).toBe(1);
    expect(reloaded.counts('old').friends).toBe(2);
  });
});

describe('menu unread notifications', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dir?: string): Promise<{ world: WorldInstance; dataDir: string }> {
    const dataDir = dir ?? await tempDir();
    if (!dir) dirs.push(dataDir);
    const world = new WorldInstance(testConfig(dataDir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return { world, dataDir };
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('allows the auction_history protocol action and nested screen', () => {
    expect(MENU_ACTIONS).toContain('auction_history');
    expect(MENU_SCREENS).toContain('auction-history');
    expect(parseClientMessage({ type: 'menu_action', action: 'auction_history' })).toMatchObject({
      action: 'auction_history',
    });
    expect(parseClientMessage({ type: 'menu_action', action: 'open', screen: 'auction-history' })).toMatchObject({
      screen: 'auction-history',
    });
  });

  it('increments friends once per new request and clears when the tab opens', async () => {
    const { world } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    const dana = join(world, 'Dana');
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'root' });
    world.friends.request(ada.player.id, 'Bob');
    world.friends.request(cara.player.id, 'Bob');
    world.friends.request(dana.player.id, 'Bob');
    expect(lastMenu(bob.sink)?.notifications?.friends).toBe(3);
    expect(world.friends.request(ada.player.id, 'Bob').error).toBe(FRIENDS_DUPLICATE_REQUEST_ERROR);
    expect(world.notifications.counts(bob.player.id).friends).toBe(3);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'friends' });
    expect(world.notifications.counts(bob.player.id).friends).toBe(0);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'back' });
    expect(lastMenu(bob.sink)?.notifications?.friends).toBe(0);
    const eve = join(world, 'Eve');
    world.friends.request(eve.player.id, 'Bob');
    expect(lastMenu(bob.sink)?.notifications?.friends).toBe(1);
  });

  it('notifies clans once for invite, kick and promote, and keeps the invitation inbox', async () => {
    const { world } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.economy.deposit(ada.player.id, 20_000, 'ADMIN_GIVE');
    expect(world.clan.createClan(ada.player.id, 'Warriors', 'swords').ok).toBe(true);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'root' });
    expect(world.clan.invitePlayer(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.notifications.counts(bob.player.id).clans).toBe(1);
    expect(chats(bob.sink).filter((row) => row.text === clanInviteChat('Ada', 'Warriors'))).toHaveLength(1);
    expect(world.clan.invitationsFor(bob.player.id)).toHaveLength(1);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'clans' });
    expect(world.notifications.counts(bob.player.id).clans).toBe(0);
    expect(world.clan.invitationsFor(bob.player.id)).toHaveLength(1);

    const invite = world.clan.invitationsFor(bob.player.id)[0]!;
    expect(world.clan.acceptInvitation(bob.player.id, invite.invitationId).ok).toBe(true);
    expect(world.clan.promoteVeteran(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.notifications.counts(bob.player.id).clans).toBe(1);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'clans' });
    expect(world.notifications.counts(bob.player.id).clans).toBe(0);

    const cara = join(world, 'Cara');
    expect(world.clan.invitePlayer(ada.player.id, cara.player.id).ok).toBe(true);
    const caraInvite = world.clan.invitationsFor(cara.player.id)[0]!;
    expect(world.clan.acceptInvitation(cara.player.id, caraInvite.invitationId).ok).toBe(true);
    world.handleMenuAction(cara.player, { type: 'menu_action', action: 'open', screen: 'clans' });
    expect(world.notifications.counts(cara.player.id).clans).toBe(0);
    expect(world.clan.kickMember(ada.player.id, cara.player.id).ok).toBe(true);
    expect(world.notifications.counts(cara.player.id).clans).toBe(1);
    world.handleMenuAction(cara.player, { type: 'menu_action', action: 'open', screen: 'clans' });
    expect(world.notifications.counts(cara.player.id).clans).toBe(0);

    expect(world.clan.makeLeader(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.notifications.counts(bob.player.id).clans).toBe(0);
  });

  it('notifies the auction seller on a successful sale and writes history for both sides', async () => {
    const { world } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    ada.player.inventory.setSlot(0, createItemStack('diamond', 32));
    world.economy.setBalance(bob.player.id, 20_000, 'ADMIN_SET');
    const listed = world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 0, 32, 12_000);
    expect(listed.ok).toBe(true);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'root' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'root' });
    expect(world.auction.buyListing(bob.player.id, 'Bob', bob.player.inventory, listed.listing!.listingId).ok).toBe(true);
    expect(lastMenu(ada.sink)?.notifications?.auction).toBe(1);
    expect(lastMenu(bob.sink)?.notifications?.auction).toBe(0);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'auction' });
    expect(world.notifications.counts(ada.player.id).auction).toBe(0);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'auction_history' });
    const adaHistory = lastMenu(ada.sink);
    expect(adaHistory?.screen).toBe('auction-history');
    expect(adaHistory?.auctionHistory?.[0]?.title).toBe('Вы продали 32 Алмаз за 12 000 Мегакоинов');
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'auction' });
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'auction_history' });
    expect(lastMenu(bob.sink)?.auctionHistory?.[0]?.title).toBe('Вы купили 32 Алмаз за 12 000 Мегакоинов');
    expect(world.notifications.counts(bob.player.id).auction).toBe(0);

    ada.player.inventory.setSlot(1, createItemStack('dirt', 1));
    const second = world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 1, 1, 10);
    expect(world.auction.buyListing(bob.player.id, 'Bob', bob.player.inventory, second.listing!.listingId).ok).toBe(true);
    ada.player.inventory.setSlot(2, createItemStack('dirt', 1));
    const third = world.auction.createListing(ada.player.id, 'Ada', ada.player.inventory, 2, 1, 10);
    expect(world.auction.buyListing(bob.player.id, 'Bob', bob.player.inventory, third.listing!.listingId).ok).toBe(true);
    expect(world.notifications.counts(ada.player.id).auction).toBe(2);
  });

  it('notifies the trade recipient once for a new offer', async () => {
    const { world } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'root' });
    expect(world.trade.request(ada.player.id, 'Bob').ok).toBe(true);
    expect(lastMenu(bob.sink)?.notifications?.trade).toBe(1);
    expect(world.notifications.counts(ada.player.id).trade).toBe(0);
    expect(world.trade.request(ada.player.id, 'Bob').error).toBe(TRADE_DUPLICATE_REQUEST_ERROR);
    expect(world.notifications.counts(bob.player.id).trade).toBe(1);
    const requestId = world.trade.incomingRequests(bob.player.id)[0]!.requestId;
    expect(world.trade.rejectRequest(bob.player.id, requestId).ok).toBe(true);
    expect(world.notifications.counts(bob.player.id).trade).toBe(1);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'trade' });
    expect(world.notifications.counts(bob.player.id).trade).toBe(0);
  });

  it('keeps unread counters across reconnect and server restart', async () => {
    const { world, dataDir } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    world.friends.request(ada.player.id, 'Bob');
    const token = bob.player.sessionToken;
    const bobId = bob.player.id;
    expect(world.notifications.counts(bobId).friends).toBe(1);
    world.disconnect(bobId, true);
    const resumed = join(world, 'Bob', token);
    world.handleMenuAction(resumed.player, { type: 'menu_action', action: 'open', screen: 'root' });
    expect(lastMenu(resumed.sink)?.notifications?.friends).toBe(1);
    await world.save();
    await world.stop();
    worlds.pop();

    const restarted = new WorldInstance(testConfig(dataDir));
    worlds.push(restarted);
    await restarted.initialize();
    await restarted.loadPlugins();
    await restarted.plugins.enableAll();
    const after = join(restarted, 'Bob', token);
    expect(after.player.id).toBe(bobId);
    restarted.handleMenuAction(after.player, { type: 'menu_action', action: 'open', screen: 'root' });
    expect(lastMenu(after.sink)?.notifications?.friends).toBe(1);
  });
});

describe('service-level notification hooks', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('does not notify twice for a duplicate friend or trade request', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const notifications = new NotificationService(store);
    const friends = new FriendsService(store);
    friends.setRuntime({
      isOnline: () => true,
      displayName: (id) => id,
      lookupPlayer: (raw) => {
        const name = raw.trim().toLowerCase();
        if (name === 'ada' || name === 'a') return { id: 'a', name: 'Ada', connected: true };
        if (name === 'bob' || name === 'b') return { id: 'b', name: 'Bob', connected: true };
        return undefined;
      },
      sendMessage: () => undefined,
      notifyUnread: (playerId, category) => { notifications.notify(playerId, category); },
    });
    friends.load();
    expect(friends.request('a', 'Bob').ok).toBe(true);
    expect(friends.request('a', 'Bob').ok).toBe(false);
    expect(notifications.counts('b').friends).toBe(1);

    const economy = new EconomyService(store);
    const trade = new TradeService(economy);
    trade.setRuntime({
      isOnline: () => true,
      displayName: (id) => id,
      lookupPlayer: (raw) => {
        const name = raw.trim().toLowerCase();
        if (name === 'ada' || name === 'a') return { id: 'a', name: 'Ada', connected: true };
        if (name === 'bob' || name === 'b') return { id: 'b', name: 'Bob', connected: true };
        return undefined;
      },
      inventory: () => new Inventory(),
      balance: () => 0,
      sendMessage: () => undefined,
      notifyUnread: (playerId, category) => { notifications.notify(playerId, category); },
    });
    expect(trade.request('a', 'Bob').ok).toBe(true);
    expect(trade.request('a', 'Bob').ok).toBe(false);
    expect(notifications.counts('b').trade).toBe(1);
    const requestId = trade.incomingRequests('b')[0]!.requestId;
    expect(trade.acceptRequest('b', requestId).ok).toBe(true);
    expect(notifications.counts('b').trade).toBe(1);
  });

  it('notifies a clan invitee once alongside the existing chat line', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const store = new JsonFileStore(dir);
    const economy = new EconomyService(store);
    const notifications = new NotificationService(store);
    const mail: string[] = [];
    const clan = new ClanService(store, economy);
    const online = [
      { id: 'leader', name: 'Ada' },
      { id: 'out', name: 'Dana' },
    ];
    const runtime: ClanRuntime = {
      onlinePlayers: () => online,
      isOnline: () => true,
      displayName: (id) => online.find((row) => row.id === id)?.name ?? id,
      sendMessage: (_id, text) => { mail.push(text); },
      lookupPlayer: (raw) => online.find((row) => row.id === raw || row.name.toLowerCase() === raw.trim().toLowerCase())
        ? { id: online.find((row) => row.id === raw || row.name.toLowerCase() === raw.trim().toLowerCase())!.id, name: raw, connected: true }
        : undefined,
      notifyUnread: (playerId, category) => { notifications.notify(playerId, category); },
    };
    clan.setRuntime(runtime);
    economy.deposit('leader', 20_000, 'ADMIN_GIVE');
    expect(clan.createClan('leader', 'Warriors', 'swords').ok).toBe(true);
    expect(clan.invitePlayer('leader', 'out').ok).toBe(true);
    expect(mail).toEqual([clanInviteChat('Ada', 'Warriors')]);
    expect(notifications.counts('out').clans).toBe(1);
    expect(clan.invitePlayer('leader', 'out').ok).toBe(false);
    expect(notifications.counts('out').clans).toBe(1);
  });
});
