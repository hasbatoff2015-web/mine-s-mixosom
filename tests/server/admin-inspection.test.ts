import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminInspectionService } from '../../server/admin/inspection';
import { AdminIdentityError } from '../../server/admin/errors';
import { AdminIdentityPolicy } from '../../server/admin/identity';
import { WorldInstance } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';
import { Inventory } from '../../src/inventory';

const POLICY = new AdminIdentityPolicy({
  enabled: true,
  ids: ['admin-owner', 'admin-colleague'],
});

describe('admin inspection', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('returns a safe snapshot for either admin and rejects an unknown id', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-admin-view-'));
    dirs.push(dataDir);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'admin-view',
        MAX_PLAYERS: '4',
        CHUNK_VIEW_RADIUS: '1',
        TICK_RATE: '20',
        PERSIST_INTERVAL_MS: '60000',
        FC_NO_BUILTIN_PLUGINS: '1',
        FC_ADMIN_IDS: 'admin-owner,admin-colleague',
      }),
      dataDir,
      port: 0,
      chunkViewRadius: 1,
      loadBuiltinPlugins: false,
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(world);
    await world.initialize();
    const ada = world.join({ sink: { send() {} }, name: 'Ada' });
    const bea = world.join({ sink: { send() {} }, name: 'Bea' });
    if ('error' in ada || 'error' in bea) throw new Error('join failed');
    world.economy.setBalance(ada.player.id, 42, 'seed');
    ada.player.inventory.addItem('diamond', 3);
    const ownerView = world.inspectPlayer('admin-owner', ada.player.id);
    const colleagueView = world.inspectPlayer('admin-colleague', ada.player.id);
    expect(ownerView).toEqual(colleagueView);
    expect(ownerView).toMatchObject({
      playerId: ada.player.id,
      name: 'Ada',
      online: true,
      balance: 42,
      worldId: 'admin-view',
    });
    expect(ownerView?.inventory).toEqual(ada.player.inventory.serialize());
    expect(typeof ownerView?.inventoryRevision).toBe('number');
    expect(ownerView?.position).toBeDefined();
    expect(typeof ownerView?.health).toBe('number');
    const encoded = JSON.stringify(ownerView);
    expect(encoded).not.toContain('sessionToken');
    expect(encoded).not.toContain('postgres');
    expect(encoded).not.toContain('password');
    expect(ownerView).not.toHaveProperty('sink');
    expect(ownerView).not.toHaveProperty('socket');
    expect(() => world.inspectPlayer('intruder', ada.player.id)).toThrow(AdminIdentityError);
    expect(world.inspectPlayer('admin-owner', 'missing-player')).toBeNull();
    const offline = new Inventory();
    const service = new AdminInspectionService(POLICY, {
      worldId: 'admin-view',
      findOnline: () => undefined,
      findStored: () => ({
        id: 'stored-1',
        name: 'Stored',
        gamemode: 'survival',
        inventory: offline.serialize(),
      }),
      balance: () => 7,
    });
    expect(service.inspect('admin-colleague', 'stored-1')).toMatchObject({
      playerId: 'stored-1',
      online: false,
      balance: 7,
      inventoryRevision: 0,
    });
    expect(service.inspect('admin-colleague', 'stored-1')).not.toHaveProperty('position');
    expect(service.inspect('admin-colleague', 'stored-1')).not.toHaveProperty('sessionToken');
  }, 60_000);
});
