import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readBan } from '../../server/admin/banAuthority';
import { AdminPanelHost } from '../../server/admin/panelHost';
import { loadServerConfig } from '../../server/config';
import { PostgresDatabase } from '../../server/db/database';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name) || name === 'template0' || name === 'template1') {
    throw new Error(`refusing database "${name}"`);
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema name');
  return `"${name}"`;
}

class MemorySink implements ConnectedSink {
  send(): void {}
}

describe.skipIf(databaseUrl === '')('stage 5 moderation durability', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  const worlds: WorldInstance[] = [];
  let admin: pg.Client | undefined;

  async function makeSchema(): Promise<string> {
    if (!admin) throw new Error('admin client missing');
    const name = `fc_it_${randomBytes(8).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  function open(searchPath: string): PostgresDatabase {
    const database = new PostgresDatabase({
      url: databaseUrl,
      deploymentId: 'stage5-mod',
      poolMax: 4,
      searchPath,
    });
    opened.push(database);
    return database;
  }

  async function boot(database: PostgresDatabase, dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await mkdtemp(join(tmpdir(), 'fc-mod-'));
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'own',
        WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
      }),
      dataDir: dir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dir, 'plugins'),
      operators: [],
      adminIdentity: { enabled: true, ids: ['admin-owner', 'admin-colleague'] },
    }, { database });
    worlds.push(world);
    await world.initialize();
    return world;
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
  }, 30_000);

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
  });

  afterAll(async () => {
    for (const database of opened.splice(0)) await database.close().catch(() => undefined);
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
      admin = undefined;
    }
  }, 30_000);

  it('keeps the player connected when the kick audit cannot commit', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Ada' });
    if ('error' in joined) throw new Error(joined.error);
    await database.query(`CREATE FUNCTION fc_fail_kick() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'player_kick' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await database.query(`CREATE TRIGGER fc_fail_kick BEFORE INSERT ON admin_audit_log
      FOR EACH ROW EXECUTE FUNCTION fc_fail_kick()`);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    await expect(host.kick('admin-owner', joined.player.id, 'спам', randomUUID())).rejects.toThrow();
    expect(joined.player.connected).toBe(true);
  });

  it('bans only after commit, ignores an old replay, and reloads after restart', async () => {
    const schema = await makeSchema();
    const database = open(schema);
    const dir = await mkdtemp(join(tmpdir(), 'fc-mod-'));
    const legacyId = randomUUID();
    await mkdir(join(dir, 'own', 'plugin-data'), { recursive: true });
    const legacyPath = join(dir, 'own', 'plugin-data', 'admin-bans.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(legacyPath, `${JSON.stringify({
      version: 1,
      bans: [{ playerId: legacyId, reason: 'старый файл', adminId: 'admin-owner', at: 1 }],
    })}\n`));
    const world = await boot(database, dir);
    expect(world.isPlayerBanned(legacyId)).toBe(true);
    expect(await readFile(legacyPath, 'utf8')).toContain(legacyId);
    const joined = world.join({ sink: new MemorySink(), name: 'Ada' });
    if ('error' in joined) throw new Error(joined.error);
    const sameName = world.join({ sink: new MemorySink(), name: 'Ada' });
    if ('error' in sameName) throw new Error(sameName.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    const banId = randomUUID();
    const unbanId = randomUUID();
    const banned = await host.ban('admin-owner', joined.player.id, 'спам', banId);
    expect(banned).toMatchObject({ ok: true, replayed: false, banned: true });
    expect(joined.player.connected).toBe(false);
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    expect(world.isPlayerBanned(sameName.player.id)).toBe(false);

    const cleared = await host.unban('admin-colleague', joined.player.id, 'ошибка', unbanId);
    expect(cleared).toMatchObject({ banned: false });
    const replay = await host.ban('admin-owner', joined.player.id, 'спам', banId);
    expect(replay).toMatchObject({ replayed: true, banned: false });
    expect(world.isPlayerBanned(joined.player.id)).toBe(false);

    const again = randomUUID();
    await host.ban('admin-owner', joined.player.id, 'снова', again);
    const oldUnban = await host.unban('admin-colleague', joined.player.id, 'ошибка', unbanId);
    expect(oldUnban).toMatchObject({ replayed: true, banned: true });
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);

    world.syncBanCache(joined.player.id, null);
    expect(world.isPlayerBanned(joined.player.id)).toBe(false);
    await world.stop();
    const restartedDb = open(schema);
    const restarted = await boot(restartedDb, dir);
    expect(restarted.isPlayerBanned(joined.player.id)).toBe(true);
    const denied = restarted.join({
      sink: new MemorySink(),
      name: 'Ada',
      sessionToken: joined.player.sessionToken,
    });
    expect(denied).toEqual({ error: 'banned' });
    const stored = await readBan(restartedDb, 'stage5-mod', 'own', joined.player.id);
    expect(stored?.banned).toBe(true);
  });

  it('does not drop an existing ban when a later write fails', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Bea' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    await host.ban('admin-owner', joined.player.id, 'первый', randomUUID());
    await database.query(`CREATE FUNCTION fc_fail_ban() RETURNS trigger AS $$
      BEGIN
        IF NEW.banned = false OR NEW.reason = 'слом' THEN RAISE EXCEPTION 'forced ban failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await database.query(`CREATE TRIGGER fc_fail_ban BEFORE INSERT OR UPDATE ON admin_player_bans
      FOR EACH ROW EXECUTE FUNCTION fc_fail_ban()`);
    await expect(host.unban('admin-colleague', joined.player.id, 'слом', randomUUID())).rejects.toThrow();
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    const row = await readBan(database, 'stage5-mod', 'own', joined.player.id);
    expect(row?.banned).toBe(true);
    expect(row?.reason).toBe('первый');
  });

  it('does not kick a connection that replaced the captured one', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Cara' });
    if ('error' in joined) throw new Error(joined.error);
    const captured = joined.player.connectionId;
    joined.player.connectionId = randomUUID();
    expect(world.disconnectAdminConnection(joined.player.id, captured)).toBe('replaced');
    expect(joined.player.connected).toBe(true);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    const requestId = randomUUID();
    const first = await host.kick('admin-owner', joined.player.id, 'спам', requestId);
    expect(first).toMatchObject({ replayed: false, closed: true });
    const next = world.join({ sink: new MemorySink(), name: 'Cara', sessionToken: joined.player.sessionToken });
    if ('error' in next) throw new Error(next.error);
    const replay = await host.kick('admin-owner', joined.player.id, 'спам', requestId);
    expect(replay).toMatchObject({ replayed: true, closed: false });
    expect(next.player.connected).toBe(true);
  });

  it('replays a committed kick after the player is offline and leaves a new connection', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Eve' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    const requestId = randomUUID();
    const first = await host.kick('admin-owner', joined.player.id, 'спам', requestId);
    expect(first).toMatchObject({ replayed: false, closed: true });
    expect(joined.player.connected).toBe(false);
    const replay = await host.kick('admin-owner', joined.player.id, 'спам', requestId);
    expect(replay).toMatchObject({ ok: true, replayed: true, closed: false });
    const next = world.join({ sink: new MemorySink(), name: 'Eve', sessionToken: joined.player.sessionToken });
    if ('error' in next) throw new Error(next.error);
    const again = await host.kick('admin-owner', joined.player.id, 'спам', requestId);
    expect(again).toMatchObject({ replayed: true, closed: false });
    expect(next.player.connected).toBe(true);
    await expect(host.kick('admin-owner', joined.player.id, 'другая причина', requestId)).rejects.toMatchObject({ status: 409 });
    const other = world.join({ sink: new MemorySink(), name: 'Other' });
    if ('error' in other) throw new Error(other.error);
    await expect(host.kick('admin-owner', other.player.id, 'спам', requestId)).rejects.toMatchObject({ status: 409 });
    expect(other.player.connected).toBe(true);
    await expect(host.kick('admin-owner', randomUUID(), 'спам', randomUUID())).rejects.toMatchObject({ code: 'offline' });
  });

  it('keeps the cache on the newer ban when an older read finishes last', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Fay' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let paused = false;
    host.syncBarrier = async () => {
      if (paused) return;
      paused = true;
      await gate;
    };
    const first = host.ban('admin-owner', joined.player.id, 'первый', randomUUID());
    for (let i = 0; i < 50 && !paused; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(paused).toBe(true);
    host.syncBarrier = null;
    const second = await host.unban('admin-colleague', joined.player.id, 'второй', randomUUID());
    expect(second).toMatchObject({ banned: false });
    release?.();
    const finished = await first;
    expect(finished.banned).toBe(false);
    expect(world.isPlayerBanned(joined.player.id)).toBe(false);
    const row = await readBan(database, 'stage5-mod', 'own', joined.player.id);
    expect(row?.banned).toBe(false);
    expect(world.banView(joined.player.id).banned).toBe(false);
  });

  it('does not let a stale unban clear a newer ban', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Gia' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    await host.ban('admin-owner', joined.player.id, 'держит', randomUUID());
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    host.syncBarrier = async () => { await gate; };
    let waiting = false;
    host.syncBarrier = async () => {
      waiting = true;
      await gate;
    };
    const unban = host.unban('admin-colleague', joined.player.id, 'рано', randomUUID());
    for (let i = 0; i < 50 && !waiting; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(waiting).toBe(true);
    host.syncBarrier = null;
    await host.ban('admin-owner', joined.player.id, 'позже', randomUUID());
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    release?.();
    await unban;
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    expect((await readBan(database, 'stage5-mod', 'own', joined.player.id))?.banned).toBe(true);
  });

  it('stays closed when the post-commit read fails and a retry restores the cache', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Hua' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    const requestId = randomUUID();
    host.fetchBan = async () => { throw new Error('read failed'); };
    await expect(host.ban('admin-owner', joined.player.id, 'закрыть', requestId)).rejects.toMatchObject({ status: 503 });
    expect(joined.player.connected).toBe(false);
    world.syncBanCache(joined.player.id, null);
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    const denied = world.join({ sink: new MemorySink(), name: 'Hua', sessionToken: joined.player.sessionToken });
    expect(denied).toEqual({ error: 'banned' });
    host.fetchBan = readBan;
    const restored = await host.ban('admin-owner', joined.player.id, 'закрыть', requestId);
    expect(restored).toMatchObject({ replayed: true, banned: true });
    expect(world.banView(joined.player.id).reason).toBe('закрыть');
  });

  it('loads more than 500 active bans after restart', async () => {
    const schema = await makeSchema();
    const database = open(schema);
    const dir = await mkdtemp(join(tmpdir(), 'fc-mod-'));
    const world = await boot(database, dir);
    const ids = Array.from({ length: 501 }, () => randomUUID());
    for (const playerId of ids) {
      await database.query(
        `INSERT INTO admin_player_bans (
          deployment_id, world_id, player_id, banned, reason, admin_id
        ) VALUES ('stage5-mod', 'own', $1, true, 'много', 'admin-owner')`,
        [playerId],
      );
    }
    await world.stop();
    const restarted = await boot(open(schema), dir);
    expect(restarted.isPlayerBanned(ids[0]!)).toBe(true);
    expect(restarted.isPlayerBanned(ids[500]!)).toBe(true);
    expect(restarted.banView(ids[250]!).banned).toBe(true);
  });

  it('keeps two admins on the committed ban row', async () => {
    const database = open(await makeSchema());
    const world = await boot(database);
    const joined = world.join({ sink: new MemorySink(), name: 'Dan' });
    if ('error' in joined) throw new Error(joined.error);
    const host = new AdminPanelHost(world, () => undefined, database, 'stage5-mod');
    await Promise.all([
      host.ban('admin-owner', joined.player.id, 'а', randomUUID()),
      host.unban('admin-colleague', joined.player.id, 'б', randomUUID()).catch(() => undefined),
    ]);
    const row = await readBan(database, 'stage5-mod', 'own', joined.player.id);
    expect(world.isPlayerBanned(joined.player.id)).toBe(row?.banned === true);
  });
});
