import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

class MemorySink implements ConnectedSink {
  send(): void {}
}

describe('stage 5 player list, kick and ban', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-admin-world-'));
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
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  it('lists duplicate nicknames separately, kicks one connection, and blocks a banned id', async () => {
    const world = await boot();
    const ada = world.join({ sink: new MemorySink(), name: 'Ada' });
    const other = world.join({ sink: new MemorySink(), name: 'Ada' });
    if ('error' in ada || 'error' in other) throw new Error('join failed');
    const page = world.listAdminPlayers('Ada', undefined, 20);
    expect(page.players.map((row) => row.playerId).sort()).toEqual([ada.player.id, other.player.id].sort());
    expect(page.players.every((row) => row.name === 'Ada' && row.online)).toBe(true);

    const connectionId = ada.player.connectionId;
    expect(world.disconnectAdminConnection(ada.player.id, connectionId)).toBe('closed');
    expect(ada.player.connected).toBe(false);
    expect(other.player.connected).toBe(true);
    expect(world.disconnectAdminConnection(ada.player.id, connectionId)).toBe('offline');

    world.setPlayerBan({
      playerId: other.player.id,
      reason: 'проверка',
      adminId: 'admin-owner',
      at: 1,
    });
    world.disconnect(other.player.id);
    const banned = world.join({ sink: new MemorySink(), name: 'Ada', sessionToken: other.player.sessionToken });
    expect(banned).toEqual({ error: 'banned' });
    world.clearPlayerBan(other.player.id);
    const back = world.join({ sink: new MemorySink(), name: 'Ada', sessionToken: other.player.sessionToken });
    expect('error' in back).toBe(false);

    const resources = world.adminResources();
    expect(resources.scanned).toBe(false);
    expect(resources.knownGaps).toContain('drop-despawn');
    expect(world.adminIncidents()).toEqual([]);
  });
});
