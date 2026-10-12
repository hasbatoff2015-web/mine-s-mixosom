import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { isPromise } from '../../server/economy/currencyPort';
import { PostgresDatabase } from '../../server/db/database';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';
import { MONEY_REQUEST_REQUIRED } from '../../server/economy/moneyRequest';

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

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function lines(sink: MemorySink): string[] {
  const found: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) found.push(...record.lines);
    if (record.type === 'chat' && record.text) found.push(record.text);
  }
  return found;
}

describe.skipIf(databaseUrl === '')('postgres join and money requests', () => {
  const schemas: string[] = [];
  let admin: pg.Client | undefined;
  let database: PostgresDatabase | undefined;
  let world: WorldInstance | undefined;
  let dir = '';

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    const schema = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    schemas.push(schema);
    dir = await mkdtemp(join(tmpdir(), 'fc-join-'));
    const config = {
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'anarchy',
        SERVER_MODE: 'anarchy',
        WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_DATABASE_URL: databaseUrl,
        FC_DEPLOYMENT_ID: 'test',
        FC_ECONOMY_BACKEND: 'postgres',
      }, process.cwd()),
      dataDir: dir,
      port: 0,
      chunkViewRadius: 1,
      persistIntervalMs: 60_000,
      pluginDir: join(dir, 'no-plugins'),
      loadExamplePlugin: false,
      loadBuiltinPlugins: true,
      operators: ['Op'],
    };
    database = new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'test',
      poolMax: 2,
      searchPath: schema,
    });
    world = new WorldInstance(config, { database });
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
  }, 60_000);

  afterAll(async () => {
    await world?.stop().catch(() => undefined);
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }, 30_000);

  async function enter(name: string, sessionToken?: string) {
    if (!world) throw new Error('world missing');
    const sink = new MemorySink();
    const pending = world.join({ sink, name, sessionToken });
    const result = isPromise(pending) ? await pending : pending;
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  async function initialLegs(playerId: string): Promise<number> {
    const rows = await database!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM economy_ledger
       WHERE player_id = $1 AND economy_scope = 'anarchy' AND reason = 'INITIAL'`,
      [playerId],
    );
    return Number(rows.rows[0]?.n ?? '0');
  }

  it('prepares a new player, keeps the balance on reconnect, and renames without a new grant', async () => {
    if (!world) throw new Error('world missing');
    let balanceAtJoin = -1;
    const stop = world.events.on('playerJoin', (event) => {
      balanceAtJoin = world!.money.getBalance(event.playerId);
    });
    const joined = await enter('Ada');
    stop();
    expect(balanceAtJoin).toBe(ECONOMY_INITIAL_BALANCE);
    expect(world.money.getBalance(joined.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
    expect(await initialLegs(joined.player.id)).toBe(1);
    const scope = await database!.query<{ economy_scope: string; display_name: string }>(
      `SELECT economy_scope, display_name FROM economy_accounts WHERE player_id = $1 ORDER BY economy_scope`,
      [joined.player.id],
    );
    expect(scope.rows).toEqual([{ economy_scope: 'anarchy', display_name: 'Ada' }]);

    const resumed = await enter('Ada', joined.player.sessionToken);
    expect(resumed.player.id).toBe(joined.player.id);
    expect(world.money.getBalance(joined.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
    expect(await initialLegs(joined.player.id)).toBe(1);

    const renamed = await enter('Ada Renamed', joined.player.sessionToken);
    expect(renamed.player.name).toBe('Ada Renamed');
    expect(world.money.getBalance(joined.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
    expect(await initialLegs(joined.player.id)).toBe(1);
    const name = await database!.query<{ display_name: string }>(
      `SELECT display_name FROM economy_accounts WHERE player_id = $1 AND economy_scope = 'anarchy'`,
      [joined.player.id],
    );
    expect(name.rows[0]?.display_name).toBe('Ada Renamed');
  }, 30_000);

  it('replays /pay by request id and rejects a missing id before money moves', async () => {
    if (!world) throw new Error('world missing');
    const ada = await enter('Payer');
    const bea = await enter('Payee');
    await world.money.deposit(ada.player.id, 400, 'ADMIN_GIVE');
    expect(world.money.getBalance(ada.player.id)).toBe(500);
    expect(world.money.getBalance(bea.player.id)).toBe(100);
    const requestX = randomUUID();
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/pay Payee 100', 'global', requestX);
    await world.money.idle?.();
    expect(world.money.getBalance(ada.player.id)).toBe(400);
    expect(world.money.getBalance(bea.player.id)).toBe(200);
    world.handleChat(ada.player, '/pay Payee 100', 'global', requestX);
    await world.money.idle?.();
    expect(world.money.getBalance(ada.player.id)).toBe(400);
    expect(world.money.getBalance(bea.player.id)).toBe(200);
    world.handleChat(ada.player, '/pay Payee 100', 'global', randomUUID());
    await world.money.idle?.();
    expect(world.money.getBalance(ada.player.id)).toBe(300);
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/pay Payee 100', 'global');
    await world.money.idle?.();
    expect(lines(ada.sink).join('\n')).toContain(MONEY_REQUEST_REQUIRED);
    expect(world.money.getBalance(ada.player.id)).toBe(300);
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/pay Payee 100', 'global', 'not-a-uuid');
    await world.money.idle?.();
    expect(lines(ada.sink).join('\n')).toContain(MONEY_REQUEST_REQUIRED);
    expect(world.money.getBalance(ada.player.id)).toBe(300);

    const op = await enter('Op');
    op.sink.payloads.length = 0;
    world.handleChat(op.player, '/eco give Payee 10', 'global');
    await world.money.idle?.();
    expect(lines(op.sink).join('\n')).toContain(MONEY_REQUEST_REQUIRED);
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    world.dispatchConsole('/eco give Payee 10');
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(310);
    world.dispatchConsole('/eco give Payee 10');
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(320);
    const take = randomUUID();
    world.handleChat(op.player, '/eco take Payee 20', 'global', take);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    world.handleChat(op.player, '/eco take Payee 20', 'global', take);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    op.sink.payloads.length = 0;
    world.handleChat(op.player, '/eco take Payee 20', 'global');
    await world.money.idle?.();
    expect(lines(op.sink).join('\n')).toContain(MONEY_REQUEST_REQUIRED);
    expect(world.money.getBalance(bea.player.id)).toBe(300);
    const set = randomUUID();
    world.handleChat(op.player, '/eco set Payee 50', 'global', set);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(50);
    world.handleChat(op.player, '/eco set Payee 50', 'global', set);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(50);
    const reset = randomUUID();
    world.handleChat(op.player, '/eco reset Payee', 'global', reset);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
    world.handleChat(op.player, '/eco reset Payee', 'global', reset);
    await world.money.idle?.();
    expect(world.money.getBalance(bea.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
    op.sink.payloads.length = 0;
    world.handleChat(op.player, '/eco reset Payee', 'global');
    await world.money.idle?.();
    expect(lines(op.sink).join('\n')).toContain(MONEY_REQUEST_REQUIRED);
    expect(world.money.getBalance(bea.player.id)).toBe(ECONOMY_INITIAL_BALANCE);
  }, 30_000);

  it('fails a join when PostgreSQL is down and leaves no connected player', async () => {
    if (!world || !database) throw new Error('world missing');
    const before = world.players.size;
    const reasons: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      await database.close();
      const sink = new MemorySink();
      const pending = world.join({ sink, name: 'Late' });
      const result = isPromise(pending) ? await pending : pending;
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toBe('Сервер временно недоступен.');
      expect(world.players.size).toBe(before);
      expect([...world.players.values()].some((player) => player.name === 'Late' && player.connected)).toBe(false);
      await new Promise((resolve) => setImmediate(resolve));
      expect(reasons).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }, 30_000);
});
