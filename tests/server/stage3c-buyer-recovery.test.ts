import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { isPromise } from '../../server/economy/currencyPort';
import { PostgresDatabase } from '../../server/db/database';
import { loadServerConfig } from '../../server/config';
import { AUCTION_MIN_PRICE } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name)) throw new Error(`refusing database "${name}"`);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('stage 3C buyer sale recovery', () => {
  const schemas: string[] = [];
  const dirs: string[] = [];
  let admin: pg.Client | undefined;

  afterAll(async () => {
    if (admin) {
      try {
        for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
      } finally {
        await admin.end().catch(() => undefined);
      }
    }
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  function openDatabase(schema: string): PostgresDatabase {
    return new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'test',
      poolMax: 2,
      searchPath: schema,
    });
  }

  async function boot(dataDir: string, schema: string): Promise<WorldInstance> {
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'anarchy',
        SERVER_MODE: 'anarchy',
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_DATABASE_URL: databaseUrl,
        FC_DEPLOYMENT_ID: 'test',
        FC_ECONOMY_BACKEND: 'postgres',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: '',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    }, { database: openDatabase(schema) });
    await world.initialize();
    return world;
  }

  async function enter(world: WorldInstance, name: string, sessionToken?: string): Promise<ServerPlayer> {
    const pending = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    const joined = isPromise(pending) ? await pending : pending;
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  async function finishMoney(world: WorldInstance, run: () => void): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const money = world.money as { track?: (work: Promise<unknown>) => void };
    const original = money.track?.bind(money);
    money.track = (work) => {
      waits.push(work);
      original?.(work);
    };
    run();
    await Promise.all(waits);
    money.track = original;
  }

  function diamondRow(world: WorldInstance) {
    return world.inspectValuableResources().resources.find((resource) => resource.itemId === ItemId.Diamond)!;
  }

  it('counts a paid sale once across recovery and restores an unpaid escrow', async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    const schema = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    schemas.push(schema);
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-3c-buyer-'));
    dirs.push(dataDir);
    let world = await boot(dataDir, schema);
    let ada = await enter(world, 'Ada');
    ada.inventory.clear();
    world.permissions.op(ada.id);
    const balance = (world.money as EconomyService).getBalance(ada.id);
    world.handleChat(ada, '/give diamond 16');
    expect(ada.inventory.count(ItemId.Diamond)).toBe(16);
    const created = world.buyer.create({
      name: 'Ювелир', worldId: world.worldId, x: 2, y: 64, z: 2, yaw: 0, pitch: 0,
    });
    expect(created.ok).toBe(true);
    expect(world.buyer.configure(created.buyer!.id, { itemId: ItemId.Diamond, pricePerItem: AUCTION_MIN_PRICE }).ok).toBe(true);
    expect(world.buyer.openTrade(ada.id, created.buyer!.id, ada.inventory).ok).toBe(true);
    expect(world.buyer.handleAction(ada.id, ada.inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    const soldId = randomUUID();
    await finishMoney(world, () => {
      world.handleBuyerAction(ada, { type: 'buyer_action', action: 'sell', clientRequestId: soldId });
    });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect((world.money as EconomyService).getBalance(ada.id)).toBe(balance + 16 * AUCTION_MIN_PRICE);
    expect(diamondRow(world)).toMatchObject({ current: 0, unexplained: 0 });
    const paidSinks = world.inspectValuableResources().recentSources.filter((source) => source.kind === 'sink' && source.itemId === ItemId.Diamond);
    expect(paidSinks).toEqual([expect.objectContaining({ quantity: 16, sourceId: soldId })]);

    world.handleChat(ada, '/give diamond 8');
    expect(ada.inventory.count(ItemId.Diamond)).toBe(8);
    expect(world.buyer.openTrade(ada.id, created.buyer!.id, ada.inventory).ok).toBe(true);
    expect(world.buyer.handleAction(ada.id, ada.inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    world.buyer.haltAfter = 'sale-escrowed';
    const escrowId = randomUUID();
    await finishMoney(world, () => {
      world.handleBuyerAction(ada, { type: 'buyer_action', action: 'sell', clientRequestId: escrowId });
    });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect((world.money as EconomyService).getBalance(ada.id)).toBe(balance + 16 * AUCTION_MIN_PRICE);
    const token = ada.sessionToken;
    await world.save();
    await world.stop();
    world = await boot(dataDir, schema);
    ada = await enter(world, 'Ada', token);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(8);
    expect(diamondRow(world)).toMatchObject({ current: 8, unexplained: 0 });
    expect((world.money as EconomyService).getBalance(ada.id)).toBe(balance + 16 * AUCTION_MIN_PRICE);
    expect(world.inspectValuableResources().recentSources.filter((source) => source.kind === 'sink' && source.sourceId === escrowId)).toEqual([]);

    expect(world.buyer.openTrade(ada.id, created.buyer!.id, ada.inventory).ok).toBe(true);
    expect(world.buyer.handleAction(ada.id, ada.inventory, {
      type: 'buyer_action', action: 'select_slot', slot: 0,
    }, { edit: false, delete: false, use: true }).ok).toBe(true);
    world.buyer.haltAfter = 'sale-paid';
    const crashId = randomUUID();
    await finishMoney(world, () => {
      world.handleBuyerAction(ada, { type: 'buyer_action', action: 'sell', clientRequestId: crashId });
    });
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect((world.money as EconomyService).getBalance(ada.id)).toBe(balance + 24 * AUCTION_MIN_PRICE);
    await world.save();
    const accountingPath = world.pluginStore.pathFor('resource-accounting');
    const preCrash = JSON.parse(await readFile(accountingPath, 'utf8')) as {
      minted: { diamond: number };
      sunk: { diamond: number };
      sourceKeys: string[];
      recent: Array<{ kind?: string; sourceId?: string }>;
    };
    expect(preCrash.minted.diamond).toBeGreaterThanOrEqual(24);
    preCrash.sunk.diamond = 16;
    preCrash.sourceKeys = preCrash.sourceKeys.filter((key) => key !== `sink:${crashId}:diamond`);
    preCrash.recent = preCrash.recent.filter((row) => row.sourceId !== crashId);
    await writeFile(accountingPath, JSON.stringify(preCrash));
    await world.stop();

    const recovering = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', SERVER_MODE: 'anarchy',
        MAX_PLAYERS: '4', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
        FC_DATABASE_URL: databaseUrl, FC_DEPLOYMENT_ID: 'test', FC_ECONOMY_BACKEND: 'postgres',
        FC_NO_BUILTIN_PLUGINS: '1', FC_ADMIN_IDS: '',
      }),
      dataDir, port: 0, chunkViewRadius: 1, loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    }, { database: openDatabase(schema) });
    const recoveringStore = recovering.pluginStore;
    const recoveringSave = recoveringStore.save.bind(recoveringStore);
    let failed = false;
    recoveringStore.save = (name, value) => {
      if (!failed && name === 'resource-accounting') {
        failed = true;
        throw new Error('resource disk full');
      }
      recoveringSave(name, value);
    };
    await expect(recovering.initialize()).resolves.toBeUndefined();
    expect(failed).toBe(true);
    ada = await enter(recovering, 'Ada', token);
    expect(ada.inventory.count(ItemId.Diamond)).toBe(0);
    expect((recovering.money as EconomyService).getBalance(ada.id)).toBe(balance + 24 * AUCTION_MIN_PRICE);
    recovering.inspectValuableResources();
    const after = JSON.parse(await readFile(recovering.pluginStore.pathFor('resource-accounting'), 'utf8')) as {
      minted: { diamond: number };
      sunk: { diamond: number };
    };
    expect(after.minted.diamond).toBe(preCrash.minted.diamond);
    expect(after.sunk.diamond).toBe(24);
    expect(diamondRow(recovering)).toMatchObject({ current: 0, unexplained: 0 });
    await recovering.save();
    await recovering.stop();

    const again = await boot(dataDir, schema);
    const returned = await enter(again, 'Ada', token);
    expect(returned.inventory.count(ItemId.Diamond)).toBe(0);
    expect((again.money as EconomyService).getBalance(returned.id)).toBe(balance + 24 * AUCTION_MIN_PRICE);
    const finalFile = JSON.parse(await readFile(again.pluginStore.pathFor('resource-accounting'), 'utf8')) as {
      sunk: { diamond: number };
    };
    expect(finalFile.sunk.diamond).toBe(24);
    expect(diamondRow(again)).toMatchObject({ current: 0, unexplained: 0 });
    await again.stop();
  }, 60_000);
});
