import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { Inventory } from '../../src/inventory';
import { PostgresDatabase } from '../../server/db/database';
import { IdempotencyService } from '../../server/db/idempotency';
import { PostgresGameplayEconomy } from '../../server/economy/postgresAuthority';
import { MegacoinService } from '../../server/economy/service';
import { applyLegacyBalanceImport, inspectLegacyBalances, planLegacyImport } from '../../server/economy/legacyImport';
import { CLAN_CREATE_COST } from '../../shared/clans';
import { AuctionService } from '../../server/services/auction';
import { BuyerService } from '../../server/services/buyer';
import { ClanService } from '../../server/services/clan';
import { ECONOMY_INITIAL_BALANCE, ECONOMY_MAX_BALANCE, EconomyService } from '../../server/services/economy';
import { HologramNetwork } from '../../server/services/holograms';
import { JsonFileStore } from '../../server/services/jsonStore';
import { KillStatistics } from '../../server/services/killStats';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FC_TEST_DATABASE_URL is not a valid URL');
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name)) throw new Error(`refusing database "${name}"`);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('postgres gameplay economy', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;
  let database!: PostgresDatabase;
  let money!: PostgresGameplayEconomy;
  let megacoin!: MegacoinService;
  let store!: JsonFileStore;

  async function makeSchema(): Promise<string> {
    if (!admin) throw new Error('admin client missing');
    const name = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    const schema = await makeSchema();
    database = new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'dev',
      poolMax: 4,
      searchPath: schema,
    });
    opened.push(database);
    await database.start();
    store = new JsonFileStore(mkdtempSync(join(tmpdir(), 'fc-eco-')));
    const placed = new EconomyService(store);
    megacoin = new MegacoinService(database, 'dev');
    money = new PostgresGameplayEconomy(
      megacoin,
      new IdempotencyService(database, 'dev'),
      placed,
      new KillStatistics(store),
    );
  }, 30_000);

  afterAll(async () => {
    for (const openedDatabase of opened.splice(0)) {
      await openedDatabase.close().catch(() => undefined);
    }
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
    }
  }, 30_000);

  const ada = randomUUID();
  const bea = randomUUID();

  it('mints 100 once, keeps it across prepare, and renames without a ledger row', async () => {
    await money.preparePlayer(ada, 'Ada');
    await money.preparePlayer(ada, 'Ada');
    expect(money.getBalance(ada)).toBe(100);
    const before = await megacoin.history({ playerId: ada, limit: 20 });
    await money.preparePlayer(ada, 'Alice');
    expect(money.displayName(ada)).toBe('Alice');
    expect(money.getBalance(ada)).toBe(100);
    const after = await megacoin.history({ playerId: ada, limit: 20 });
    expect(after.entries).toHaveLength(before.entries.length);
    expect(after.entries.every((entry) => entry.reason === 'INITIAL')).toBe(true);
    expect((await megacoin.reconcile(ada)).matches).toBe(true);
  });

  it('pays a block break once per source and again for a new break', async () => {
    const first = randomUUID();
    const paid = await money.rewardBlockBreak(ada, BlockId.DiamondOre, {}, first);
    expect(paid.ok).toBe(true);
    expect(money.getBalance(ada)).toBe(125);
    const again = await money.rewardBlockBreak(ada, BlockId.DiamondOre, {}, first);
    expect(money.getBalance(ada)).toBe(125);
    expect(again.replayed).toBe(true);
    await money.rewardBlockBreak(ada, BlockId.DiamondOre, {}, randomUUID());
    expect(money.getBalance(ada)).toBe(150);
    expect(await money.rewardBlockBreak(ada, BlockId.DiamondOre, { placed: true }, randomUUID())).toMatchObject({ ok: false, amount: 0 });
    expect(money.getBalance(ada)).toBe(150);
  });

  it('pays mob economy UUIDs once and rejects runtime mob-N', async () => {
    const uuidA = randomUUID();
    const uuidB = randomUUID();
    expect((await money.rewardMobKill(ada, 'zombie', 'mob-1')).ok).toBe(false);
    expect(money.getBalance(ada)).toBe(150);
    expect((await money.rewardMobKill(ada, 'zombie', uuidA)).ok).toBe(true);
    expect(money.getBalance(ada)).toBe(160);
    expect((await money.rewardMobKill(ada, 'zombie', uuidA)).ok).toBe(false);
    expect(money.getBalance(ada)).toBe(160);
    expect((await money.rewardMobKill(ada, 'zombie', uuidB)).ok).toBe(true);
    expect(money.getBalance(ada)).toBe(170);
  });

  it('moves a PvP share in one transfer and does not pay the same death twice', async () => {
    await money.preparePlayer(bea, 'Bea');
    const death = randomUUID();
    const beforeAda = money.getBalance(ada);
    const paid = await money.rewardPlayerKill(bea, ada, death);
    const share = Math.floor(beforeAda * 0.1);
    expect(paid).toMatchObject({ ok: true, amount: share });
    expect(money.getBalance(ada)).toBe(beforeAda - share);
    expect(money.getBalance(bea)).toBe(ECONOMY_INITIAL_BALANCE + share);
    const operation = await megacoin.findBySource('PLAYER_KILL', death);
    expect(operation?.kind).toBe('TRANSFER');
    expect(operation?.legs).toHaveLength(2);
    expect((await money.rewardPlayerKill(bea, ada, death)).ok).toBe(false);
    expect(money.getBalance(ada)).toBe(beforeAda - share);
    expect((await money.rewardPlayerKill(bea, ada, randomUUID())).error).toBe('cooldown');
    expect((await megacoin.reconcile(ada)).matches).toBe(true);
    expect((await megacoin.reconcile(bea)).matches).toBe(true);
  });

  it('replays one transfer request and performs a second request', async () => {
    const startAda = money.getBalance(ada);
    const startBea = money.getBalance(bea);
    const request = {
      requestId: randomUUID(),
      operation: 'economy.player_transfer',
      actorId: ada,
      payload: { to: bea, amount: 40 },
    };
    const first = await money.transfer(ada, bea, 40, 'PLAYER_TRANSFER', request);
    const second = await money.transfer(ada, bea, 40, 'PLAYER_TRANSFER', request);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(money.getBalance(ada)).toBe(startAda - 40);
    expect(money.getBalance(bea)).toBe(startBea + 40);
    const other = {
      ...request,
      requestId: randomUUID(),
    };
    expect((await money.transfer(ada, bea, 40, 'PLAYER_TRANSFER', other)).ok).toBe(true);
    expect(money.getBalance(ada)).toBe(startAda - 80);
    const broke = await money.transfer(ada, bea, 999_999_999, 'PLAYER_TRANSFER');
    expect(broke.ok).toBe(false);
    expect(money.getBalance(ada)).toBe(startAda - 80);
  });

  it('records admin give, take, set, and reset in the ledger', async () => {
    const before = money.getBalance(ada);
    await money.deposit(ada, 15, 'ADMIN_GIVE');
    await money.withdraw(ada, 5, 'ADMIN_TAKE');
    await money.setBalance(ada, before, 'ADMIN_SET');
    await money.resetBalance(ada, 'ADMIN_RESET');
    expect(money.getBalance(ada)).toBe(ECONOMY_INITIAL_BALANCE);
    const history = await money.getTransactionHistory(ada, 20);
    const reasons = history.map((entry) => entry.reason);
    expect(reasons).toEqual(expect.arrayContaining(['ADMIN_GIVE', 'ADMIN_TAKE', 'ADMIN_SET', 'ADMIN_RESET', 'INITIAL']));
    expect((await megacoin.reconcile(ada)).matches).toBe(true);
  });

  it('sells through the buyer once and leaves the item when payment fails', async () => {
    const buyer = new BuyerService(
      store,
      money,
      new HologramNetwork(() => undefined),
      () => 'anarchy',
      () => Date.now(),
      () => 'aabbccdd',
    );
    buyer.create({ name: 'Фермер', worldId: 'anarchy', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 });
    buyer.configure('aabbccdd', { itemId: 'pumpkin', pricePerItem: 50 });
    const inventory = new Inventory();
    inventory.addItem('pumpkin', 2);
    buyer.openTrade(ada, 'aabbccdd', inventory);
    await buyer.handleAction(ada, inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, { edit: false, delete: false, use: true });
    const requestId = randomUUID();
    const sold = await buyer.handleAction(ada, inventory, {
      type: 'buyer_action',
      action: 'sell',
      clientRequestId: requestId,
    }, { edit: false, delete: false, use: true });
    expect(sold.ok).toBe(true);
    const afterSale = money.getBalance(ada);
    const replay = await money.deposit(ada, 100, 'TRADER_SELL', undefined, undefined, {
      requestId,
      operation: 'economy.trader_sell',
      actorId: ada,
      payload: { action: 'sell', buyerId: null, slot: null, amount: null },
    });
    expect(replay.ok).toBe(true);
    expect(money.getBalance(ada)).toBe(afterSale);
    await money.setBalance(ada, ECONOMY_MAX_BALANCE, 'ADMIN_SET');
    inventory.addItem('pumpkin', 1);
    buyer.openTrade(ada, 'aabbccdd', inventory);
    await buyer.handleAction(ada, inventory, { type: 'buyer_action', action: 'select_slot', slot: 0 }, { edit: false, delete: false, use: true });
    const held = buyer.session(ada)?.tradeSlot?.count;
    const failed = await buyer.handleAction(ada, inventory, { type: 'buyer_action', action: 'sell' }, { edit: false, delete: false, use: true });
    expect(failed.ok).toBe(false);
    expect(buyer.session(ada)?.tradeSlot?.count).toBe(held);
    expect(money.getBalance(ada)).toBe(ECONOMY_MAX_BALANCE);
    await money.resetBalance(ada, 'ADMIN_RESET');
  });

  it('settles an auction purchase once', async () => {
    const auction = new AuctionService(store, money, () => 1_000);
    await money.deposit(bea, 500, 'ADMIN_GIVE');
    const sellerInventory = new Inventory();
    sellerInventory.addItem('diamond', 1);
    const listed = auction.createListing(ada, 'Alice', sellerInventory, 0, 1, 100);
    expect(listed.ok).toBe(true);
    const listingId = listed.listing!.listingId;
    const buyerInventory = new Inventory();
    const bought = await auction.buyListing(bea, 'Bea', buyerInventory, listingId);
    expect(bought.ok).toBe(true);
    expect(buyerInventory.count('diamond')).toBe(1);
    const sellerAfter = money.getBalance(ada);
    const buyerAfter = money.getBalance(bea);
    const replay = await auction.buyListing(bea, 'Bea', new Inventory(), listingId);
    expect(replay.ok).toBe(false);
    expect(money.getBalance(ada)).toBe(sellerAfter);
    expect(money.getBalance(bea)).toBe(buyerAfter);
    const operation = await megacoin.findBySource('AUCTION', `${listingId}:${bea}`);
    expect(operation?.kind).toBe('TRANSFER');
    expect(operation?.legs).toHaveLength(2);
  });

  it('charges a clan fee once and does not create a clan when debit fails', async () => {
    const clans = new ClanService(store, money);
    const broke = await clans.createClan(bea, 'Broke', 'crown');
    expect(broke.ok).toBe(false);
    expect(clans.playerClan(bea)).toBeUndefined();
    await money.deposit(ada, 20_000, 'ADMIN_GIVE');
    const request = {
      requestId: randomUUID(),
      operation: 'economy.clan_create',
      actorId: ada,
      payload: { name: 'North', icon: 'crown' },
    };
    const before = money.getBalance(ada);
    const created = await clans.createClan(ada, 'North', 'crown', request);
    expect(created.ok).toBe(true);
    expect(money.getBalance(ada)).toBe(before - CLAN_CREATE_COST);
    const replay = await money.withdraw(ada, CLAN_CREATE_COST, 'CLAN_CREATE', undefined, request);
    expect(replay.ok).toBe(true);
    expect(money.getBalance(ada)).toBe(before - CLAN_CREATE_COST);
  });

  it('reads history and baltop from PostgreSQL and leaves the JSON wallet untouched', async () => {
    const jsonPlayer = randomUUID();
    store.save('economy/balances', {
      players: [{ playerId: jsonPlayer, balance: 999_999, name: 'Json', kills: 3 }],
    });
    const placed = new EconomyService(store);
    expect(placed.getBalance(jsonPlayer)).toBe(999_999);
    await money.preparePlayer(jsonPlayer, 'Json');
    expect(money.getBalance(jsonPlayer)).toBe(100);
    await money.deposit(jsonPlayer, 5, 'ADMIN_GIVE');
    expect(money.getBalance(jsonPlayer)).toBe(105);
    const raw = JSON.parse(readFileSync(store.pathFor('economy/balances'), 'utf8')) as {
      players: Array<{ balance: number }>;
    };
    expect(raw.players[0]?.balance).toBe(999_999);
    const top = await money.getTopBalances(10);
    expect(top.some((entry) => entry.playerId === jsonPlayer && entry.balance === 105)).toBe(true);
    const history = await money.getTransactionHistory(jsonPlayer, 10);
    expect(history.some((entry) => entry.reason === 'ADMIN_GIVE')).toBe(true);
    expect(history.some((entry) => entry.reason === 'INITIAL')).toBe(true);
  });

  it('imports legacy balances once and reconciles', async () => {
    const batch = randomUUID();
    const imported = randomUUID();
    const issues = inspectLegacyBalances([
      { playerId: imported, displayName: 'Imp', balance: 1.5 },
    ]);
    expect(issues.issues.invalidPlayers).toContain(imported);
    const accounts = [
      { playerId: imported, displayName: 'Imp', balance: 250 },
      { playerId: randomUUID(), displayName: 'Even', balance: 100 },
      { playerId: randomUUID(), displayName: 'Low', balance: 30 },
    ];
    const plan = planLegacyImport(accounts, batch);
    expect(plan.applied).toBe(false);
    expect(plan.playerCount).toBe(3);
    expect(plan.totalLegacyCurrency).toBe(380);
    expect(plan.expectedPostgresTotal).toBe(380);
    const applied = await applyLegacyBalanceImport(megacoin, accounts, batch);
    expect(applied.applied).toBe(true);
    expect((await megacoin.getBalance(imported))).toBe(250);
    expect((await megacoin.getBalance(accounts[2]!.playerId))).toBe(30);
    await applyLegacyBalanceImport(megacoin, accounts, batch);
    expect(await megacoin.getBalance(imported)).toBe(250);
    expect(await megacoin.getBalance(accounts[2]!.playerId)).toBe(30);
    for (const account of accounts) {
      expect((await megacoin.reconcile(account.playerId)).matches).toBe(true);
    }
    await expect(applyLegacyBalanceImport(megacoin, [
      { ...accounts[0]!, balance: 10 },
    ], batch)).rejects.toThrow(/conflict/);
  });

  it('fails a money mutation when the database is closed and does not change the cache', async () => {
    const before = money.getBalance(ada);
    await database.close();
    const failed = await money.deposit(ada, 10, 'ADMIN_GIVE');
    expect(failed.ok).toBe(false);
    expect(money.getBalance(ada)).toBe(before);
  });
});
