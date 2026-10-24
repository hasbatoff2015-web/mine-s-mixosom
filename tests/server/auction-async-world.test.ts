import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Inventory, cloneStack, createItemStack } from '../../src/inventory';
import { ITEM_INSTANCE_METADATA_KEY, withItemInstanceId } from '../../src/inventory/itemInstance';
import { ItemId } from '../../src/items/types';
import type { ItemStack } from '../../src/inventory/types';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import { IDENTITY_TRANSFER_BLOCKED } from '../../server/identity/locationScan';
import type { ItemDurability, ItemEffectResult } from '../../server/settlements/durability';
import type { AuctionListing } from '../../server/services/auction';
import { auctionClaimReceipt } from '../../server/settlements/receipts';
import type { ServerMessage } from '../../shared/protocol';

const DIAMOND = 'diamond';

class DeferredDurability implements ItemDurability {
  readonly receipts = new Set<string>();
  readonly escrowWait: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  readonly deliverWait: Array<{ resolve: (value: ItemEffectResult) => void; reject: (error: Error) => void }> = [];
  failEscrow = false;
  failDeliver = false;

  constructor(private readonly inventoryFor: (playerId: string) => Inventory | undefined) {}

  hasReceipt(_playerId: string, receipt: string): boolean {
    return this.receipts.has(receipt);
  }

  escrow(_playerId: string, receipt: string): Promise<void> {
    if (this.failEscrow) return Promise.reject(new Error('disk full'));
    return new Promise((resolve, reject) => {
      this.escrowWait.push({
        resolve: () => {
          this.receipts.add(receipt);
          resolve();
        },
        reject,
      });
    });
  }

  deliver(_playerId: string, receipt: string, _stack: ItemStack): Promise<ItemEffectResult> {
    if (this.failDeliver) return Promise.reject(new Error('disk full'));
    return new Promise((resolve, reject) => {
      this.deliverWait.push({
        resolve: (value) => {
          if (value === 'delivered' || value === 'already') {
            this.receipts.add(receipt);
            if (value === 'delivered') this.inventoryFor(_playerId)?.add(cloneStack(_stack)!);
          }
          resolve(value);
        },
        reject,
      });
    });
  }

  deliverAll(): Promise<ItemEffectResult> {
    return Promise.resolve('missing');
  }

  restore(): Promise<ItemEffectResult> {
    return Promise.resolve('missing');
  }

  restoreAll(): Promise<ItemEffectResult> {
    return Promise.resolve('missing');
  }

  dropReceipt(): Promise<void> {
    return Promise.resolve();
  }

  finishEscrow(): void {
    const pending = this.escrowWait.splice(0);
    for (const gate of pending) gate.resolve();
  }

  rejectEscrow(): void {
    const pending = this.escrowWait.splice(0);
    for (const gate of pending) gate.reject(new Error('disk full'));
  }

  finishDeliver(value: ItemEffectResult = 'delivered'): void {
    const pending = this.deliverWait.splice(0);
    for (const gate of pending) gate.resolve(value);
  }

  rejectDeliver(): void {
    const pending = this.deliverWait.splice(0);
    for (const gate of pending) gate.reject(new Error('disk full'));
  }
}

describe('auction create and claim through WorldInstance', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(worldId: string): Promise<WorldInstance> {
    const dataDir = await mkdtemp(pathJoin(tmpdir(), 'fc-auction-async-'));
    dirs.push(dataDir);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: worldId,
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: pathJoin(dataDir, 'plugins'),
    });
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function enter(world: WorldInstance, name: string, sessionToken?: string): { player: ServerPlayer; messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    const joined = world.join({
      sink: { send(message: ServerMessage) { messages.push(message); } },
      name,
      ...(sessionToken ? { sessionToken } : {}),
    });
    if ('error' in joined) throw new Error(joined.error);
    return { player: joined.player, messages };
  }

  function rows(world: WorldInstance): AuctionListing[] {
    return [...(world.auction as unknown as { listings: Map<string, AuctionListing> }).listings.values()];
  }

  function auctions(messages: ServerMessage[]): Extract<ServerMessage, { type: 'auction' }>[] {
    return messages.filter((message): message is Extract<ServerMessage, { type: 'auction' }> => message.type === 'auction');
  }

  function armSell(world: WorldInstance, player: ServerPlayer, itemId = DIAMOND, count = 1): void {
    player.inventory.setSlot(0, createItemStack(itemId, count));
    world.openAuction(player.id, 'sell');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'select_slot', slot: 0 });
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  it('AUC-01 waits for durable create before reporting success', async () => {
    const world = await start('auc-01');
    const { player, messages } = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, player);
    const before = auctions(messages).length;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    expect(auctions(messages).length).toBe(before);
    expect(rows(world).find((listing) => listing.sellerPlayerId === player.id)?.status).toBe('PENDING_ESCROW');
    durability.finishEscrow();
    await settle();
    const shown = auctions(messages).at(-1);
    expect(shown?.message).toBe('Товар выставлен на аукцион.');
    expect(player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.queryMine(player.id).listings).toEqual([
      expect.objectContaining({ status: 'ACTIVE', item: expect.objectContaining({ itemId: DIAMOND, count: 1 }) }),
    ]);
    expect(auctions(messages).filter((message) => message.message === 'Товар выставлен на аукцион.')).toHaveLength(1);
  });

  it('AUC-02 keeps the player lock until a delayed create finishes', async () => {
    const world = await start('auc-02');
    const { player, messages } = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, player, DIAMOND, 4);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', amount: 2, price: 10 });
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', amount: 2, price: 10 });
    expect(auctions(messages).at(-1)?.message).toBe('Предмет больше недоступен для продажи.');
    expect(rows(world).filter((listing) => listing.sellerPlayerId === player.id)).toHaveLength(1);
    durability.finishEscrow();
    await settle();
    expect(world.auction.queryMine(player.id).listings).toHaveLength(1);
    expect(player.inventory.count(DIAMOND)).toBe(2);
    expect(auctions(messages).filter((message) => message.message === 'Товар выставлен на аукцион.')).toHaveLength(1);
  });

  it('AUC-03 reports a rejected create without a second owner', async () => {
    const world = await start('auc-03');
    const { player, messages } = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    durability.rejectEscrow();
    await settle();
    expect(auctions(messages).some((message) => message.message === 'Товар выставлен на аукцион.')).toBe(false);
    expect(auctions(messages).at(-1)?.message).toBe('Сохранение не завершилось. Предмет не потерян.');
    expect(world.auction.queryMine(player.id).listings).toHaveLength(0);
    expect(player.inventory.count(DIAMOND)).toBe(1);
  });

  it('AUC-04 rejects an invalid price before creating a listing', async () => {
    const world = await start('auc-04');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 0 });
    expect(world.auction.queryMine(player.id).listings).toHaveLength(0);
    expect(player.inventory.getSlot(0)?.count).toBe(1);
    expect(auctions(messages).at(-1)?.message).toBeTruthy();
    expect(auctions(messages).at(-1)?.message).not.toBe('Товар выставлен на аукцион.');
  });

  it('AUC-05 keeps legacy create synchronous', async () => {
    const world = await start('auc-05');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    const before = auctions(messages).length;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    expect(auctions(messages).length).toBe(before + 1);
    expect(auctions(messages).at(-1)?.message).toBe('Товар выставлен на аукцион.');
    expect(player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.queryMine(player.id).listings[0]?.status).toBe('ACTIVE');
  });

  it('AUC-06 waits for durable claim before reporting the return', async () => {
    const world = await start('auc-06');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    expect(world.auction.cancelListing(player.id, listingId).ok).toBe(true);
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    world.openAuction(player.id, 'list');
    const before = auctions(messages).length;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    expect(auctions(messages).length).toBe(before);
    durability.finishDeliver();
    await settle();
    expect(auctions(messages).at(-1)?.message).toBe('Предмет возвращён в инвентарь.');
    expect(player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('CLAIMED');
    expect(durability.receipts.has(auctionClaimReceipt(world.auction.getListing(listingId)!.economySettlementId))).toBe(true);
  });

  it('AUC-07 leaves a returnable listing when the inventory is full', async () => {
    const world = await start('auc-07');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    world.auction.cancelListing(player.id, listingId);
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      player.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    world.openAuction(player.id, 'list');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    expect(auctions(messages).at(-1)?.message).toBe('Недостаточно места в инвентаре.');
    expect(player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.getListing(listingId)?.status).toBe('CANCELLED');
  });

  it('AUC-08 retries a failed claim once', async () => {
    const world = await start('auc-08');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    world.auction.cancelListing(player.id, listingId);
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    durability.failDeliver = true;
    world.auction.setStage2C({ durability });
    world.openAuction(player.id, 'list');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    await settle();
    expect(auctions(messages).at(-1)?.message).not.toBe('Предмет возвращён в инвентарь.');
    expect(player.inventory.count(DIAMOND)).toBe(0);
    durability.failDeliver = false;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    durability.finishDeliver();
    await settle();
    expect(player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('CLAIMED');
    expect(durability.receipts.size).toBe(1);
  });

  it('AUC-09 does not deliver a second claim while the first is pending', async () => {
    const world = await start('auc-09');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    world.auction.cancelListing(player.id, listingId);
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    world.openAuction(player.id, 'list');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    expect(auctions(messages).at(-1)?.message).toBe('Этот товар уже продан.');
    durability.finishDeliver();
    await settle();
    expect(player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('CLAIMED');
  });

  it('AUC-10 reconciles a delivered claim after restart', async () => {
    const world = await start('auc-10');
    const { player } = enter(world, 'Ada');
    const token = player.sessionToken;
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listing = world.auction.queryMine(player.id).listings[0]!;
    world.auction.cancelListing(player.id, listing.listingId);
    const durability = (world as unknown as { itemDurability(): ItemDurability }).itemDurability();
    world.auction.setStage2C({ durability });
    world.auction.haltAfter = 'claim-delivered';
    world.openAuction(player.id, 'list');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId: listing.listingId });
    await settle();
    expect(player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listing.listingId)?.status).toBe('CANCELLED');
    const dataDir = (world as unknown as { config: { dataDir: string } }).config.dataDir;
    await world.stop();
    const restarted = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'auc-10',
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: pathJoin(dataDir, 'plugins'),
    });
    worlds.push(restarted);
    await restarted.initialize();
    const again = enter(restarted, 'Ada', token);
    const next = (restarted as unknown as { itemDurability(): ItemDurability }).itemDurability();
    restarted.auction.setStage2C({ durability: next });
    expect(restarted.auction.recoverClaims()).toBe(1);
    expect(restarted.auction.getListing(listing.listingId)?.status).toBe('CLAIMED');
    expect(again.player.inventory.count(DIAMOND)).toBe(1);
  });

  it('AUC-11 does not answer a disconnected create socket', async () => {
    const world = await start('auc-11');
    const { player, messages } = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, player);
    const token = player.sessionToken;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    player.connected = false;
    const before = messages.length;
    durability.finishEscrow();
    await settle();
    expect(messages.length).toBe(before);
    expect(world.auction.queryMine(player.id).listings[0]?.status).toBe('ACTIVE');
    player.connected = true;
    const resumed = enter(world, 'Ada', token);
    expect(resumed.player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.queryMine(resumed.player.id).listings[0]?.status).toBe('ACTIVE');
  });

  it('AUC-12 does not answer a disconnected claim socket', async () => {
    const world = await start('auc-12');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    world.auction.cancelListing(player.id, listingId);
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    world.openAuction(player.id, 'list');
    const token = player.sessionToken;
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    player.connected = false;
    const before = messages.length;
    durability.finishDeliver();
    await settle();
    expect(messages.length).toBe(before);
    const resumed = enter(world, 'Ada', token);
    expect(resumed.player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('CLAIMED');
  });

  it('AUC-13 keeps a newer connection in control of the screen', async () => {
    const world = await start('auc-13');
    const first = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, first.player);
    const oldConnection = first.player.connectionId;
    world.handleAuctionAction(
      first.player,
      { type: 'auction_action', action: 'create', price: 10 },
      { connectionId: oldConnection },
    );
    const second = enter(world, 'Ada', first.player.sessionToken);
    world.openGameMenu(second.player.id, 'root');
    const before = second.messages.length;
    durability.finishEscrow();
    await settle();
    expect(second.messages.slice(before).some((message) => message.type === 'auction')).toBe(false);
    expect(second.player.connectionId).not.toBe(oldConnection);
    expect(second.player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.queryMine(second.player.id).listings[0]?.status).toBe('ACTIVE');
  });

  it('AUC-14 does not reopen the auction over a newer menu', async () => {
    const world = await start('auc-14');
    const { player, messages } = enter(world, 'Ada');
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    world.openGameMenu(player.id, 'root');
    const before = messages.length;
    durability.finishEscrow();
    await settle();
    expect(messages.slice(before).some((message) => message.type === 'auction')).toBe(false);
    expect(messages.slice(before).some((message) => message.type === 'inventory')).toBe(true);
    expect(player.inventory.count(DIAMOND)).toBe(0);
    expect(world.auction.queryMine(player.id).listings[0]?.status).toBe('ACTIVE');
  });

  it('AUC-15 blocks a confirmed duplicate unique item', async () => {
    const world = await start('auc-15');
    const { player, messages } = enter(world, 'Ada');
    const instanceId = '11111111-1111-4111-8111-111111111111';
    const sword = withItemInstanceId(createItemStack(ItemId.GodSword, 1), instanceId);
    player.inventory.setSlot(0, sword);
    player.inventory.setSlot(1, withItemInstanceId(createItemStack(ItemId.GodSword, 1), instanceId));
    expect(player.inventory.getSlot(0)?.metadata?.[ITEM_INSTANCE_METADATA_KEY]).toBe(instanceId);
    world.openAuction(player.id, 'sell');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'select_slot', slot: 0 });
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    expect(auctions(messages).at(-1)?.message).toBe(IDENTITY_TRANSFER_BLOCKED);
    expect(world.auction.queryMine(player.id).listings).toHaveLength(0);
    expect(player.inventory.getSlot(0)?.count).toBe(1);
    expect(player.inventory.getSlot(1)?.count).toBe(1);
  });

  it('AUC-16 does not deliver a claim twice', async () => {
    const world = await start('auc-16');
    const { player, messages } = enter(world, 'Ada');
    armSell(world, player);
    world.handleAuctionAction(player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(player.id).listings[0]!.listingId;
    world.auction.cancelListing(player.id, listingId);
    const durability = new DeferredDurability((id) => world.players.get(id)?.inventory);
    world.auction.setStage2C({ durability });
    world.openAuction(player.id, 'list');
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    durability.finishDeliver();
    await settle();
    world.handleAuctionAction(player, { type: 'auction_action', action: 'claim', listingId });
    expect(player.inventory.count(DIAMOND)).toBe(1);
    expect(durability.receipts.size).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('CLAIMED');
    expect(auctions(messages).filter((message) => message.message === 'Предмет возвращён в инвентарь.')).toHaveLength(1);
  });

  it('AUC-17 buys a listing once through the existing path', async () => {
    const world = await start('auc-17');
    const seller = enter(world, 'Ada');
    const buyer = enter(world, 'Bea');
    armSell(world, seller.player);
    world.handleAuctionAction(seller.player, { type: 'auction_action', action: 'create', price: 10 });
    const listingId = world.auction.queryMine(seller.player.id).listings[0]!.listingId;
    world.money.setBalance(seller.player.id, 0, 'ADMIN_SET');
    world.money.setBalance(buyer.player.id, 1_000, 'ADMIN_SET');
    world.openAuction(buyer.player.id, 'browse');
    world.handleAuctionAction(buyer.player, { type: 'auction_action', action: 'buy', listingId });
    expect(buyer.player.inventory.count(DIAMOND)).toBe(1);
    expect(world.auction.getListing(listingId)?.status).toBe('SOLD');
    expect(world.money.getBalance(buyer.player.id)).toBe(990);
    expect(world.money.getBalance(seller.player.id)).toBe(10);
  });
});
