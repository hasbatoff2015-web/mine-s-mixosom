import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminBanList } from '../../server/admin/bans';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

function records(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    playerId: randomUUID(),
    reason: `ban-${index}`,
    adminId: 'admin-owner',
    at: index,
  }));
}

describe('admin ban cache capacity', () => {
  it('keeps 500, 501 and 1000 active bans, including the first and the last', () => {
    for (const count of [500, 501, 1000]) {
      const rows = records(count);
      const list = new AdminBanList();
      list.load({ version: 1, bans: rows });
      expect(list.size).toBe(count);
      expect(list.has(rows[0]!.playerId)).toBe(true);
      expect(list.has(rows[count - 1]!.playerId)).toBe(true);
    }
  });

  it('removes one id, updates one reason, and reloads the serialized file', () => {
    const rows = records(10);
    const list = new AdminBanList();
    list.load({ version: 1, bans: rows });
    expect(list.remove(rows[4]!.playerId)).toBe(true);
    expect(list.has(rows[4]!.playerId)).toBe(false);
    expect(list.size).toBe(9);
    list.add({ ...rows[1]!, reason: 'updated' });
    expect(list.size).toBe(9);
    expect(list.get(rows[1]!.playerId)?.reason).toBe('updated');
    const again = new AdminBanList();
    again.load(list.serialize());
    expect(again.size).toBe(9);
    expect(again.has(rows[0]!.playerId)).toBe(true);
    expect(again.has(rows[4]!.playerId)).toBe(false);
    list.load({ version: 1, bans: [{ playerId: 'not-a-player', reason: 'x', adminId: 'a', at: 1 }, ...rows] });
    expect(list.has('not-a-player')).toBe(false);
  });
});

class MemorySink implements ConnectedSink {
  send(): void {}
}

describe('world ban cache', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('refuses a join whose ban would have fallen off a 500-item cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-ban-cache-'));
    dirs.push(dir);
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
      loadBuiltinPlugins: true,
      pluginDir: join(dir, 'plugins'),
      operators: [],
    });
    worlds.push(world);
    await world.initialize();
    const joined = world.join({ sink: new MemorySink(), name: 'Ada' });
    if ('error' in joined) throw new Error(joined.error);
    const extra = records(500);
    world.replaceBanCache([
      { playerId: joined.player.id, reason: 'first', adminId: 'admin-owner', at: 1 },
      ...extra,
    ]);
    expect(world.isPlayerBanned(joined.player.id)).toBe(true);
    expect(world.isPlayerBanned(extra[499]!.playerId)).toBe(true);
    world.disconnect(joined.player.id);
    const again = world.join({ sink: new MemorySink(), name: 'Ada', sessionToken: joined.player.sessionToken });
    expect(again).toEqual({ error: 'banned' });
    const during = world.join({ sink: new MemorySink(), name: 'Bea' });
    if ('error' in during) throw new Error(during.error);
    world.disconnect(during.player.id);
    world.beginBanSync(during.player.id);
    const blocked = world.join({
      sink: new MemorySink(),
      name: 'Bea',
      sessionToken: during.player.sessionToken,
    });
    expect(blocked).toEqual({ error: 'banned' });
    world.endBanSync(during.player.id);
    const back = world.join({
      sink: new MemorySink(),
      name: 'Bea',
      sessionToken: during.player.sessionToken,
    });
    expect('error' in back).toBe(false);
  });
});
