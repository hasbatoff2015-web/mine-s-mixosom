import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { CHUNK_SIZE, chunkKey, floorDiv, positiveMod } from '../../src/core/constants';
import { Chunk } from '../../src/world/Chunk';
import { createItemStack, withItemInstanceId } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { loadServerConfig } from '../../server/config';
import { IdentityIncidentLog } from '../../server/identity/incidents';
import { IDENTITY_TRANSFER_BLOCKED, type IdentityReport } from '../../server/identity/locationScan';
import { AUCTION_MIN_PRICE } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';

const PAINT = ItemId.Painting01VillagerHmm;
const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FURNACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAINTING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STALE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LOADED_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNKNOWN_ID = 'ffffffff-ffff-4fff-afff-ffffffffffff';

const CHEST = { x: -401, y: 80, z: -417 };
const FURNACE = { x: 8200, y: 80, z: 8216 };
const PAINTING = { x: 8304, y: 81, z: -8208 };
const STALE = { x: 8400, y: 80, z: 8408 };
const LOADED = { x: 8504, y: 80, z: 8512 };
const UNKNOWN = { x: 9000, y: 80, z: 9008 };

function tracked(instanceId: string) {
  return withItemInstanceId(createItemStack(PAINT, 1), instanceId);
}

function cellKey(cell: { x: number; y: number; z: number }): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

function chunkOf(cell: { x: number; z: number }): string {
  return chunkKey(floorDiv(cell.x, CHUNK_SIZE), floorDiv(cell.z, CHUNK_SIZE));
}

describe('stage 3B unloaded chunks and incident retry', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  function open(dataDir: string, worldId: string): WorldInstance {
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
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(world);
    return world;
  }

  async function start(worldId: string): Promise<{ world: WorldInstance; dataDir: string }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-3b-far-'));
    dirs.push(dataDir);
    const world = open(dataDir, worldId);
    await world.initialize();
    return { world, dataDir };
  }

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string, clearInventory = true): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    if (clearInventory) joined.player.inventory.clear();
    return joined.player;
  }

  function money(world: WorldInstance): EconomyService {
    return world.money as EconomyService;
  }

  it('sees distant saved holders without generating their chunks', async () => {
    const worldId = 'far-blocks';
    const first = await start(worldId);
    const ada = addPlayer(first.world, 'Ada');
    const before = money(first.world).getBalance(ada.id);
    ada.inventory.setSlot(0, tracked(X));
    expect(first.world.world.setBlock(CHEST.x, CHEST.y, CHEST.z, BlockId.Chest)).toBe(true);
    first.world.world.chests.set(cellKey(CHEST), { slots: [tracked(X)] });
    expect(first.world.world.setBlock(FURNACE.x, FURNACE.y, FURNACE.z, BlockId.Furnace)).toBe(true);
    first.world.world.furnaces.set(cellKey(FURNACE), {
      slots: [tracked(FURNACE_ID), null, null],
      burnTime: 0,
      burnTotal: 0,
      cookTime: 0,
    });
    expect(first.world.world.setBlock(PAINTING.x, PAINTING.y, PAINTING.z, BlockId.CollectiblePainting)).toBe(true);
    first.world.world.setBlockState(PAINTING.x, PAINTING.y, PAINTING.z, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: PAINTING_ID,
    });
    expect(first.world.world.setBlock(STALE.x, STALE.y, STALE.z, BlockId.Stone)).toBe(true);
    first.world.world.chests.set(cellKey(STALE), { slots: [tracked(STALE_ID)] });
    expect(first.world.world.setBlock(LOADED.x, LOADED.y, LOADED.z, BlockId.Chest)).toBe(true);
    first.world.world.chests.set(cellKey(LOADED), { slots: [tracked(LOADED_ID)] });
    const token = ada.sessionToken;
    await first.world.save();
    await first.world.stop();
    worlds.pop();

    const world = open(first.dataDir, worldId);
    await world.initialize();
    for (const cell of [CHEST, FURNACE, PAINTING, STALE]) {
      expect(world.world.chunks.has(chunkOf(cell))).toBe(false);
    }
    expect(world.world.knownBlockId(CHEST.x, CHEST.y, CHEST.z)).toBe(BlockId.Chest);
    expect(positiveMod(CHEST.x, CHUNK_SIZE)).toBe(15);
    expect(floorDiv(CHEST.x, CHUNK_SIZE)).toBe(-26);
    const player = addPlayer(world, 'Ada', token, false);
    const seen = world.inspectUniqueItems();
    const chest = seen.locations.filter((location) => location.itemInstanceId === X);
    expect(chest.map((location) => location.kind).sort()).toEqual(['player-inventory', 'world-chest']);
    expect(chest.find((location) => location.kind === 'world-chest')).toMatchObject(CHEST);
    expect(seen.findings.find((finding) => finding.itemInstanceId === X)?.status).toBe('confirmed-duplicate');
    const furnace = seen.locations.find((location) => location.itemInstanceId === FURNACE_ID);
    expect(furnace).toMatchObject({ kind: 'world-furnace', slot: 'input', ...FURNACE });
    const painting = seen.locations.find((location) => location.itemInstanceId === PAINTING_ID);
    expect(painting).toMatchObject({ kind: 'placed-painting', ...PAINTING });
    expect(seen.locations.some((location) => location.itemInstanceId === STALE_ID)).toBe(false);
    expect(player.inventory.count(PAINT)).toBe(1);
    expect(world.world.chests.get(cellKey(CHEST))?.slots[0]?.count).toBe(1);
    expect(money(world).getBalance(player.id)).toBe(before);
    for (const cell of [CHEST, FURNACE, PAINTING, STALE]) {
      expect(world.world.chunks.has(chunkOf(cell))).toBe(false);
    }

    const loadedKey = chunkOf(LOADED);
    expect(world.world.chunks.has(loadedKey)).toBe(false);
    world.world.getChunk(floorDiv(LOADED.x, CHUNK_SIZE), floorDiv(LOADED.z, CHUNK_SIZE), true);
    const loaded = world.world.chunks.get(loadedKey)!;
    loaded.set(positiveMod(LOADED.x, CHUNK_SIZE), LOADED.y, positiveMod(LOADED.z, CHUNK_SIZE), BlockId.Stone);
    expect(world.world.modifications.get(loadedKey)?.get(
      Chunk.index(positiveMod(LOADED.x, CHUNK_SIZE), LOADED.y, positiveMod(LOADED.z, CHUNK_SIZE)),
    )).toBe(BlockId.Chest);
    const afterLive = world.inspectUniqueItems();
    expect(afterLive.locations.some((location) => location.itemInstanceId === LOADED_ID)).toBe(false);
    expect(world.world.chunks.has(loadedKey)).toBe(true);

    world.world.chests.set(cellKey(UNKNOWN), { slots: [tracked(UNKNOWN_ID)] });
    const unknownChunk = chunkOf(UNKNOWN);
    expect(world.world.chunks.has(unknownChunk)).toBe(false);
    const unknown = world.inspectUniqueItems();
    expect(unknown.unresolvedSources).toBeGreaterThan(0);
    expect(unknown.locations.some((location) => location.itemInstanceId === UNKNOWN_ID)).toBe(false);
    expect(world.world.chunks.has(unknownChunk)).toBe(false);
    expect(player.inventory.count(PAINT)).toBe(1);

    world.handleAuctionAction(player, {
      type: 'auction_action', action: 'create', slot: 0, amount: 1, price: AUCTION_MIN_PRICE,
    });
    expect(world.auction.session(player.id).message).toBe(IDENTITY_TRANSFER_BLOCKED);
    expect(player.inventory.count(PAINT)).toBe(1);
    expect(world.world.chests.get(cellKey(CHEST))?.slots[0]?.count).toBe(1);
    expect(world.auction.holdingListings().some((listing) => listing.item.metadata?.itemInstanceId === X)).toBe(false);
    expect(money(world).getBalance(player.id)).toBe(before);
    expect(world.world.chunks.has(chunkOf(CHEST))).toBe(false);

    world.world.chests.delete(cellKey(CHEST));
    world.handleAuctionAction(player, {
      type: 'auction_action', action: 'create', slot: 0, amount: 1, price: AUCTION_MIN_PRICE,
    });
    expect(world.auction.session(player.id).message).not.toBe(IDENTITY_TRANSFER_BLOCKED);
    expect(player.inventory.count(PAINT)).toBe(0);
    expect(world.auction.holdingListings().some((listing) => listing.item.metadata?.itemInstanceId === X)).toBe(true);
    expect(money(world).getBalance(player.id)).toBe(before);
    expect(world.world.chunks.has(chunkOf(CHEST))).toBe(false);
  });

  it('retries a failed incident write without rewriting a clean scan', async () => {
    const { world, dataDir } = await start('incident-retry');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, tracked(X));
    ada.inventory.setSlot(1, tracked(X));
    const store = world.pluginStore;
    const original = store.save.bind(store);
    let failuresLeft = 1;
    store.save = (name, value) => {
      if (name === 'identity-incidents' && failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('identity disk full');
      }
      original(name, value);
    };
    const first = world.inspectUniqueItems();
    expect(first.findings.find((finding) => finding.itemInstanceId === X)?.status).toBe('confirmed-duplicate');
    expect(first.incidents.find((incident) => incident.itemInstanceId === X)?.confirmed).toBe(true);
    await expect(readFile(store.pathFor('identity-incidents'), 'utf8')).rejects.toThrow();
    expect(ada.inventory.count(PAINT)).toBe(2);

    store.save = original;
    const second = world.inspectUniqueItems();
    expect(second.incidents.filter((incident) => incident.itemInstanceId === X)).toHaveLength(1);
    const saved = JSON.parse(await readFile(store.pathFor('identity-incidents'), 'utf8')) as {
      incidents: Array<{ itemInstanceId: string; confirmed: boolean; locations: Array<{ kind: string }> }>;
    };
    const row = saved.incidents.find((incident) => incident.itemInstanceId === X);
    expect(row?.confirmed).toBe(true);
    expect(row?.locations.map((location) => location.kind).sort()).toEqual(['player-inventory', 'player-inventory']);

    let writes = 0;
    store.save = (name, value) => {
      if (name === 'identity-incidents') writes += 1;
      original(name, value);
    };
    world.inspectUniqueItems();
    world.inspectUniqueItems();
    expect(writes).toBe(0);
    store.save = original;

    await world.save();
    await world.stop();
    worlds.pop();
    const restarted = open(dataDir, 'incident-retry');
    await restarted.initialize();
    const loaded = restarted.inspectUniqueItems();
    expect(loaded.incidents.some((incident) => incident.itemInstanceId === X && incident.confirmed)).toBe(true);
    expect(addPlayer(restarted, 'Ada', ada.sessionToken, false).inventory.count(PAINT)).toBe(2);
  });

  it('writes a resolved incident after the first save failed', async () => {
    const { world } = await start('incident-resolve');
    const ada = addPlayer(world, 'Ada');
    ada.inventory.setSlot(0, tracked(X));
    ada.inventory.setSlot(1, tracked(X));
    const store = world.pluginStore;
    const original = store.save.bind(store);
    store.save = (name, value) => {
      if (name === 'identity-incidents') throw new Error('identity disk full');
      original(name, value);
    };
    expect(() => world.inspectUniqueItems()).not.toThrow();
    expect(() => world.inspectUniqueItems()).not.toThrow();
    expect(ada.inventory.count(PAINT)).toBe(2);
    store.save = original;
    ada.inventory.setSlot(1, null);
    world.inspectUniqueItems();
    const saved = JSON.parse(await readFile(store.pathFor('identity-incidents'), 'utf8')) as {
      incidents: Array<{ itemInstanceId: string; confirmed: boolean; locations: unknown[] }>;
    };
    const row = saved.incidents.find((incident) => incident.itemInstanceId === X);
    expect(row?.confirmed).toBe(false);
    expect(row?.locations).toHaveLength(2);
    expect(world.inspectUniqueItems().findings.some((finding) => finding.itemInstanceId === X)).toBe(false);
    expect(ada.inventory.count(PAINT)).toBe(1);
  });

  it('keeps at most 400 incidents and one row per uuid', () => {
    const log = new IdentityIncidentLog();
    for (let index = 0; index < 401; index += 1) {
      const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const report: IdentityReport = {
        worldId: 'cap',
        locations: [],
        skippedMalformed: 0,
        findings: [{
          itemInstanceId: id,
          itemIds: [PAINT],
          status: 'confirmed-duplicate',
          locations: [
            { worldId: 'cap', itemInstanceId: id, itemId: PAINT, kind: 'player-inventory', playerId: 'a', slot: '0' },
            { worldId: 'cap', itemInstanceId: id, itemId: PAINT, kind: 'player-inventory', playerId: 'b', slot: '1' },
          ],
        }],
      };
      log.observe(report, 'recheck', index);
    }
    expect(log.list().length).toBeLessThanOrEqual(400);
    const again = log.list()[0]!;
    log.observe({
      worldId: 'cap',
      locations: [],
      skippedMalformed: 0,
      findings: [{
        itemInstanceId: again.itemInstanceId,
        itemIds: [PAINT],
        status: 'confirmed-duplicate',
        locations: again.locations,
      }],
    }, 'recheck', 500);
    expect(log.list().filter((incident) => incident.itemInstanceId === again.itemInstanceId)).toHaveLength(1);
  });
});
