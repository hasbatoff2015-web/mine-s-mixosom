import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../../src/blocks';
import { craftOnceByRecipeId } from '../../src/crafting/craftOnce';
import { PLAYER_EYE_HEIGHT, PLAYER_REACH } from '../../src/core/constants';
import { placeBlockAt, type UseSimulationContext } from '../../src/gameplay';
import {
  Inventory,
  canStacksMerge,
  cloneStack,
  collectiblePaintingDroppedStack,
  createItemStack,
  createPortalChestInventory,
  createTrackedItemInstances,
  damageItem,
  ensureInventoryInstanceIds,
  ensureItemInstanceId,
  readItemInstanceId,
  requiresUniqueItemIdentity,
  splitItemStack,
  withItemInstanceId,
} from '../../src/inventory';
import { creativeCatalogGrant } from '../../src/inventory/inventoryUiAction';
import { creativeCatalogItems } from '../../src/items';
import { COLLECTIBLE_PAINTING_IDS } from '../../src/items/collectiblePaintings';
import { ItemId, getItemDefinition } from '../../src/items';
import { CombatSystem } from '../../src/combat';
import { PlayerController } from '../../src/player';
import { SurvivalSystem } from '../../src/survival';
import { Chunk } from '../../src/world/Chunk';
import { VoxelWorld } from '../../src/world/World';
import { sanitizeBlockRenderState } from '../../src/world/painting';
import { EventBus } from '../../server/events';
import { ServerGameplay, type GameplayPlayer } from '../../server/gameplay';
import { loadServerConfig } from '../../server/config';
import type { Plugin } from '../../server/PluginManager';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { syncAuction, AuctionService } from '../../server/services/auction';
import { EconomyService } from '../../server/services/economy';
import { JsonFileStore } from '../../server/services/jsonStore';
import { TradeService } from '../../server/services/trade';
import { parseClientMessage, parseNetworkBlockState } from '../../shared/protocol';

const PAINT = ItemId.Painting01VillagerHmm;
const OTHER = ItemId.Painting02NightGuardian;
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const FORGED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}

function playerNear(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  gamemode: 'survival' | 'creative' = 'survival',
): GameplayPlayer {
  return {
    id: 'painter',
    connected: true,
    controller: new PlayerController({ position: [x, y, z], yaw: 0, pitch: 0 }),
    inventory: new Inventory(),
    portalChest: createPortalChestInventory(),
    survival: new SurvivalSystem(),
    combat: new CombatSystem(),
    gamemode,
    selectedSlot: 0,
    cursor: null,
    craftSlots: [null, null, null, null],
    window: { kind: 'inventory' },
    miningTarget: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
    miningProgress: 1,
    bowUseTicks: 0,
    foodUseTicks: 0,
    lastUse: false,
    lastSprint: false,
    vehicleForward: 0,
    inventoryDirty: false,
  };
}

function placeContext(
  world: VoxelWorld,
  gamemode: 'survival' | 'creative',
  mint?: () => string,
): UseSimulationContext {
  const inventory = new Inventory();
  return {
    world,
    inventory,
    selectedSlot: 0,
    gamemode,
    reach: PLAYER_REACH,
    eyePosition: () => new THREE.Vector3(2, 42, 2),
    viewDirection: () => new THREE.Vector3(1, 0, 0),
    yaw: 0,
    position: new THREE.Vector3(2, 40, 2),
    intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false,
    foodUseTicks: 0,
    bowUseTicks: 0,
    minecarts: {
      raycast: () => undefined,
      cartAt: () => undefined,
      nearest: () => undefined,
      isRideable: () => false,
      handleFlintUse: () => 'none' as const,
      insertTnt: () => false,
      spawn: () => undefined,
    } as unknown as UseSimulationContext['minecarts'],
    redstone: {
      notifyBlockChanged: () => undefined,
      setButtonOrientation: () => undefined,
      setLeverOrientation: () => undefined,
      toggleLever: () => undefined,
      pressButton: () => undefined,
      primeTnt: () => undefined,
    } as unknown as UseSimulationContext['redstone'],
    ...(mint ? { mintInstanceId: mint } : {}),
  };
}

function wallHit(x: number, y: number, z: number) {
  return {
    x, y, z,
    block: BlockId.Stone,
    normal: new THREE.Vector3(1, 0, 0),
    distance: 2,
    point: new THREE.Vector3(x + 1, y + 0.5, z + 0.5),
  };
}

function catalogIndex(itemId: string): number {
  const index = creativeCatalogItems().findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error(`missing catalog item ${itemId}`);
  return index;
}

function clickCreative(gameplay: ServerGameplay, player: GameplayPlayer, itemId: string): void {
  const result = gameplay.applyInventory(player, {
    type: 'inventory_action',
    action: 'click',
    key: `creative-${catalogIndex(itemId)}`,
    button: 'left',
  });
  expect(result.ok).toBe(true);
}

function idsOf(inventory: Inventory, itemId: string): string[] {
  const ids: string[] = [];
  for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
    const stack = inventory.getSlot(index);
    if (stack?.itemId !== itemId) continue;
    const id = readItemInstanceId(stack);
    if (id) ids.push(id);
  }
  return ids;
}

describe('stage 3A item identity', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop().catch(() => undefined);
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function start(worldId: string): Promise<WorldInstance> {
    const dataDir = await mkdtemp(join(tmpdir(), 'fc-id-'));
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
      pluginDir: join(dataDir, 'plugins'),
    });
    worlds.push(world);
    await world.initialize();
    return world;
  }

  async function openSaved(dataDir: string, worldId: string): Promise<WorldInstance> {
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
    await world.initialize();
    return world;
  }

  function addPlayer(world: WorldInstance, name: string, sessionToken?: string): ServerPlayer {
    const joined = world.join({ sink: { send() {} }, name, ...(sessionToken ? { sessionToken } : {}) });
    if ('error' in joined) throw new Error(joined.error);
    return joined.player;
  }

  it('mints a distinct server id for each creative grant and leaves ordinary items alone', () => {
    const world = emptyWorld('grant');
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(world, 8, 40, 8, 'creative');
    const original = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    let mints = 0;
    globalThis.crypto.randomUUID = () => {
      mints += 1;
      return original();
    };
    try {
      clickCreative(gameplay, player, PAINT);
      const first = readItemInstanceId(player.cursor);
      expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(mints).toBe(1);
      gameplay.applyInventory(player, {
        type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left',
      });
      clickCreative(gameplay, player, PAINT);
      const second = readItemInstanceId(player.cursor);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(readItemInstanceId(player.inventory.getSlot(0))).toBe(first);

      clickCreative(gameplay, player, OTHER);
      expect(readItemInstanceId(player.cursor)).toBeDefined();
      expect(player.cursor?.itemId).toBe(OTHER);
      gameplay.applyInventory(player, {
        type: 'inventory_action', action: 'click', key: 'inventory-2', button: 'left',
      });

      const beforeDiamond = mints;
      clickCreative(gameplay, player, 'diamond');
      expect(player.cursor?.itemId).toBe('diamond');
      expect(player.cursor?.metadata).toBeUndefined();
      expect(readItemInstanceId(player.cursor)).toBeUndefined();
      expect(mints).toBe(beforeDiamond);

      player.inventory.addItem('cobblestone', 70);
      const cobble = player.inventory.slots.filter((stack) => stack?.itemId === 'cobblestone');
      expect(cobble.length).toBeGreaterThan(0);
      expect(cobble.every((stack) => stack?.metadata === undefined)).toBe(true);
    } finally {
      globalThis.crypto.randomUUID = original;
    }

    const swordPlayer = playerNear(world, 8, 40, 8, 'creative');
    clickCreative(gameplay, swordPlayer, ItemId.GodSword);
    expect(swordPlayer.cursor?.itemId).toBe(ItemId.GodSword);
    expect(readItemInstanceId(swordPlayer.cursor)).toMatch(/^[0-9a-f-]{36}$/);
    expect(creativeCatalogGrant(catalogIndex(PAINT), 'left')?.metadata).toBeUndefined();

    const parsed = parseClientMessage({
      type: 'inventory_action',
      action: 'click',
      key: `creative-${catalogIndex(PAINT)}`,
      button: 'left',
      itemInstanceId: FORGED,
      metadata: { itemInstanceId: FORGED },
    });
    expect(parsed).not.toHaveProperty('itemInstanceId');
    expect(parsed).not.toHaveProperty('metadata');
    if (!('error' in parsed) && parsed.type === 'inventory_action') {
      const forged = playerNear(world, 8, 40, 8, 'creative');
      gameplay.applyInventory(forged, parsed);
      expect(readItemInstanceId(forged.cursor)).not.toBe(FORGED);
    }
  });

  it('gives three paintings three ids and leaves a diamond stack untracked', async () => {
    const world = await start('give-ids');
    const player = addPlayer(world, 'Giver');
    player.inventory.clear();
    world.handleChat(player, `/give ${PAINT} 3`);
    const ids = idsOf(player.inventory, PAINT);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    world.handleChat(player, '/give diamond 64');
    const diamond = player.inventory.slots.find((stack) => stack?.itemId === 'diamond');
    expect(diamond?.count).toBe(64);
    expect(diamond?.metadata).toBeUndefined();
    const minted = createTrackedItemInstances('cobblestone', 3, () => ID_A);
    expect(minted).toBeUndefined();
    expect(requiresUniqueItemIdentity('diamond')).toBe(false);
    expect(requiresUniqueItemIdentity(ItemId.GodSword)).toBe(true);
    expect(COLLECTIBLE_PAINTING_IDS.filter((id) => requiresUniqueItemIdentity(id))).toHaveLength(20);
  });

  it('preserves an id through clone, save, slot, cursor, hotbar, container, and drop pickup', () => {
    const stamped = withItemInstanceId(createItemStack(PAINT, 1, {
      durability: undefined,
      metadata: { note: 'kept', enchant: 'silk' },
    }), ID_A);
    expect(readItemInstanceId(cloneStack(stamped))).toBe(ID_A);
    expect(cloneStack(stamped)?.metadata?.note).toBe('kept');
    const inventory = new Inventory();
    inventory.setSlot(0, stamped);
    inventory.setSlot(1, withItemInstanceId(createItemStack(ItemId.GodSword, 1, { durability: 1 }), ID_B));
    const restored = Inventory.deserialize(inventory.serialize());
    expect(readItemInstanceId(restored.getSlot(0))).toBe(ID_A);
    expect(restored.getSlot(0)?.metadata?.note).toBe('kept');
    expect(restored.getSlot(0)?.metadata?.enchant).toBe('silk');
    expect(restored.getSlot(1)?.durability).toBe(1);
    expect(readItemInstanceId(restored.getSlot(1))).toBe(ID_B);
    expect(ensureItemInstanceId(restored.getSlot(0)!, () => {
      throw new Error('must not remint');
    })).toBeTruthy();
    expect(readItemInstanceId(restored.getSlot(0))).toBe(ID_A);

    const world = emptyWorld('moves');
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(world, 4, 40, 4, 'survival');
    player.inventory.setSlot(9, withItemInstanceId(createItemStack(PAINT), ID_A));
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'inventory-9', button: 'left',
    });
    expect(readItemInstanceId(player.cursor)).toBe(ID_A);
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'inventory-3', button: 'left',
    });
    expect(readItemInstanceId(player.inventory.getSlot(3))).toBe(ID_A);
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'hotbar_swap', key: 'inventory-3', slot: 0,
    });
    expect(readItemInstanceId(player.inventory.getSlot(0))).toBe(ID_A);
    player.window = { kind: 'portal-chest' };
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'inventory-0', button: 'left',
    });
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'click', key: 'container-0', button: 'left',
    });
    expect(readItemInstanceId(player.portalChest.slots[0] ?? null)).toBe(ID_A);

    player.inventory.setSlot(1, withItemInstanceId(createItemStack(OTHER), ID_B));
    gameplay.dropFromPlayer(player, player.inventory.getSlot(1)!);
    const dropped = gameplay.drops.entities.at(-1)!;
    expect(readItemInstanceId(dropped.stack)).toBe(ID_B);
    dropped.pickupDelaySeconds = 0;
    dropped.position.copy(player.controller.position);
    player.inventory.setSlot(1, null);
    gameplay.collectFor(player);
    expect(idsOf(player.inventory, OTHER)).toEqual([ID_B]);

    const again = player.inventory.slots.findIndex((stack) => stack?.itemId === OTHER);
    gameplay.applyInventory(player, {
      type: 'inventory_action', action: 'drop_selected', slot: again, all: true,
    });
    const second = gameplay.drops.entities.at(-1)!;
    expect(readItemInstanceId(second.stack)).toBe(ID_B);
    second.pickupDelaySeconds = 0;
    second.position.copy(player.controller.position);
    gameplay.collectFor(player);
    expect(idsOf(player.inventory, OTHER)).toEqual([ID_B]);

    const left = withItemInstanceId(createItemStack(PAINT), ID_A);
    const right = withItemInstanceId(createItemStack(PAINT), ID_B);
    expect(canStacksMerge(left, right)).toBe(false);
    expect(canStacksMerge(left, cloneStack(left)!)).toBe(true);
    const parts = splitItemStack(createItemStack('cobblestone', 64), 20);
    expect(parts?.taken.count).toBe(20);
    expect(parts?.taken.metadata).toBeUndefined();
    expect(parts?.remainder?.metadata).toBeUndefined();
  });

  it('keeps a survival painting id, mints creative copies, and restores the drop', () => {
    const world = emptyWorld('place');
    world.setBlock(5, 40, 5, BlockId.Stone);
    world.setBlock(5, 41, 5, BlockId.Stone);
    const ids = [ID_B, '33333333-3333-4333-8333-333333333333'];
    const survival = placeContext(world, 'survival', () => ids.shift() ?? ID_A);
    survival.inventory.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    const hit = wallHit(5, 40, 5);
    expect(placeBlockAt(survival, 6, 40, 5, BlockId.CollectiblePainting, hit)).toEqual({ ok: true });
    expect(survival.inventory.getSlot(0)).toBeNull();
    expect(world.getBlockState(6, 40, 5)).toMatchObject({
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: ID_A,
    });

    const creative = placeContext(world, 'creative', () => ids.shift() ?? '44444444-4444-4444-8444-444444444444');
    creative.inventory.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    expect(placeBlockAt(creative, 6, 41, 5, BlockId.CollectiblePainting, wallHit(5, 41, 5))).toEqual({ ok: true });
    expect(readItemInstanceId(creative.inventory.getSlot(0))).toBe(ID_A);
    const firstPlaced = world.getBlockState(6, 41, 5)?.paintingInstanceId;
    expect(firstPlaced).toBe(ID_B);
    expect(placeBlockAt(creative, 6, 42, 5, BlockId.CollectiblePainting, wallHit(5, 42, 5))).toEqual({ ok: false, reason: 'no-anchor' });

    world.setBlock(5, 42, 5, BlockId.Stone);
    expect(placeBlockAt(creative, 6, 42, 5, BlockId.CollectiblePainting, wallHit(5, 42, 5))).toEqual({ ok: true });
    const secondPlaced = world.getBlockState(6, 42, 5)?.paintingInstanceId;
    expect(secondPlaced).toBe('33333333-3333-4333-8333-333333333333');
    expect(secondPlaced).not.toBe(firstPlaced);
    expect(readItemInstanceId(creative.inventory.getSlot(0))).toBe(ID_A);

    const rejected = placeContext(world, 'survival', () => {
      throw new Error('rejected placement must not mint');
    });
    rejected.inventory.setSlot(0, withItemInstanceId(createItemStack(OTHER), ID_B));
    expect(placeBlockAt(rejected, 5, 40, 5, BlockId.CollectiblePainting, wallHit(5, 40, 5)).ok).toBe(false);
    expect(world.getBlock(5, 40, 5)).toBe(BlockId.Stone);
    expect(world.getBlockState(5, 40, 5)?.paintingInstanceId).toBeUndefined();
    expect(readItemInstanceId(rejected.inventory.getSlot(0))).toBe(ID_B);

    const gameplay = new ServerGameplay(world, new EventBus());
    const breaker = playerNear(world, 6.5, 40, 6.5, 'survival');
    expect(gameplay.breakBlock(breaker, 6, 40, 5)).toEqual({ ok: true });
    expect(readItemInstanceId(gameplay.drops.entities.at(-1)?.stack)).toBe(ID_A);
    const drop = gameplay.drops.entities.at(-1)!;
    drop.pickupDelaySeconds = 0;
    drop.position.copy(breaker.controller.position);
    gameplay.collectFor(breaker);
    expect(readItemInstanceId(breaker.inventory.slots.find((stack) => stack?.itemId === PAINT) ?? null)).toBe(ID_A);

    breaker.inventory.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    const replay = placeContext(world, 'survival');
    replay.inventory.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    world.setBlock(5, 40, 5, BlockId.Stone);
    expect(placeBlockAt(replay, 6, 40, 5, BlockId.CollectiblePainting, wallHit(5, 40, 5)).ok).toBe(true);
    expect(world.getBlockState(6, 40, 5)?.paintingInstanceId).toBe(ID_A);
    expect(world.getBlockState(6, 40, 5)?.facing).toBe('east');
    expect(world.getBlockState(6, 40, 5)?.paintingItemId).toBe(PAINT);

    const beforeDrops = gameplay.drops.count;
    const creativeBreak = playerNear(world, 6.5, 41, 6.5, 'creative');
    expect(gameplay.breakBlock(creativeBreak, 6, 41, 5).ok).toBe(true);
    expect(gameplay.drops.count).toBe(beforeDrops);
    expect(world.getBlock(6, 41, 5, false)).toBe(BlockId.Air);
  });

  it('keeps the placed id through TNT, support loss, and world restore', () => {
    const world = emptyWorld('blast');
    world.setBlock(5, 40, 5, BlockId.Stone);
    world.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    world.setBlockState(6, 40, 5, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: ID_A,
    });
    const gameplay = new ServerGameplay(world, new EventBus());
    gameplay.explosions.enqueue({ x: 6.5, y: 40.5, z: 5.5, radius: 3, power: 8 });
    gameplay.tick([], 0.05, { tickPlayers: () => undefined });
    gameplay.tick([], 0.05, { tickPlayers: () => undefined });
    expect(world.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(readItemInstanceId(gameplay.drops.entities[0]?.stack)).toBe(ID_A);

    const support = emptyWorld('support');
    support.setBlock(5, 40, 5, BlockId.Stone);
    support.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    support.setBlockState(6, 40, 5, {
      attachment: 'wall',
      facing: 'south',
      paintingItemId: OTHER,
      paintingInstanceId: ID_B,
    });
    const loose = new ServerGameplay(support, new EventBus());
    support.setBlock(5, 40, 5, BlockId.Air);
    loose.tick([], 0.05, { tickPlayers: () => undefined });
    expect(support.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(readItemInstanceId(loose.drops.entities[0]?.stack)).toBe(ID_B);
    expect(loose.drops.entities[0]?.stack.count).toBe(1);

    const saved = support.serializeBlockStates();
    const hung = emptyWorld('reload');
    hung.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    hung.setBlockState(6, 40, 5, {
      attachment: 'wall',
      facing: 'south',
      paintingItemId: OTHER,
      paintingInstanceId: ID_B,
    });
    const packed = hung.serializeBlockStates();
    const loaded = emptyWorld('loaded');
    loaded.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    loaded.restore({
      timeOfDay: 0,
      modifications: {},
      chests: {},
      furnaces: {},
      blockStates: packed,
      signs: {},
    });
    expect(loaded.getBlockState(6, 40, 5)).toMatchObject({
      facing: 'south',
      paintingItemId: OTHER,
      paintingInstanceId: ID_B,
    });
    expect(saved).toBeDefined();
    const legacy = sanitizeBlockRenderState({
      attachment: 'wall',
      facing: 'west',
      paintingItemId: PAINT,
    });
    expect(legacy.paintingItemId).toBe(PAINT);
    expect(legacy.facing).toBe('west');
    expect(legacy.paintingInstanceId).toBeUndefined();
  });

  it('assigns a legacy inventory id once and gives a legacy painting a drop id', async () => {
    const world = await start('legacy-id');
    const player = addPlayer(world, 'Legacy');
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack(PAINT, 1));
    player.inventory.setSlot(1, createItemStack('diamond', 3));
    const token = player.sessionToken;
    await world.save();
    await world.stop();
    worlds.pop();

    const dataDir = dirs[0]!;
    const second = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'legacy-id',
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
    worlds.push(second);
    await second.initialize();
    const returned = addPlayer(second, 'Legacy', token);
    const migrated = readItemInstanceId(returned.inventory.getSlot(0));
    expect(migrated).toBeDefined();
    expect(returned.inventory.getSlot(0)?.count).toBe(1);
    expect(returned.inventory.count(PAINT)).toBe(1);
    expect(returned.inventory.getSlot(1)?.metadata).toBeUndefined();
    expect((second as unknown as { dirty: boolean }).dirty).toBe(true);
    await second.save();
    await second.stop();
    worlds.pop();

    const third = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        WORLD: 'legacy-id',
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
    worlds.push(third);
    await third.initialize();
    const again = addPlayer(third, 'Legacy', token);
    expect(readItemInstanceId(again.inventory.getSlot(0))).toBe(migrated);
    expect(again.inventory.count(PAINT)).toBe(1);

    const bare = Inventory.deserialize({
      version: 1,
      slots: [createItemStack(ItemId.GodSword, 1), ...Array.from({ length: 35 }, () => null)],
      armor: { head: null, chest: null, legs: null, feet: null },
      offhand: null,
    });
    expect(readItemInstanceId(bare.getSlot(0))).toBeUndefined();
    expect(ensureInventoryInstanceIds(bare, () => ID_A)).toBe(true);
    expect(readItemInstanceId(bare.getSlot(0))).toBe(ID_A);
    expect(ensureInventoryInstanceIds(bare, () => ID_B)).toBe(false);
    expect(readItemInstanceId(bare.getSlot(0))).toBe(ID_A);

    const old = emptyWorld('old-paint');
    old.setBlock(4, 40, 4, BlockId.CollectiblePainting);
    old.setBlockState(4, 40, 4, { attachment: 'wall', facing: 'north', paintingItemId: PAINT });
    expect(old.getBlockState(4, 40, 4)?.paintingItemId).toBe(PAINT);
    expect(collectiblePaintingDroppedStack(BlockId.CollectiblePainting, old.getBlockState(4, 40, 4))?.metadata).toBeUndefined();
    const play = new ServerGameplay(old, new EventBus());
    const breaker = playerNear(old, 4.5, 40, 5.5);
    expect(play.breakBlock(breaker, 4, 40, 4).ok).toBe(true);
    const droppedId = readItemInstanceId(play.drops.entities[0]?.stack);
    expect(droppedId).toBeDefined();
    expect(play.drops.entities).toHaveLength(1);
    expect(play.drops.entities[0]?.stack.count).toBe(1);
    expect(old.getBlock(4, 40, 4, false)).toBe(BlockId.Air);
  });

  it('preserves identity through auction, trade, and heldReturns without a second mint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fc-id-econ-'));
    dirs.push(dir);
    const economy = new EconomyService(new JsonFileStore(dir));
    economy.setBalance('buyer', 1_000, 'ADMIN_SET');
    const auction = new AuctionService(new JsonFileStore(dir), economy);
    const seller = new Inventory();
    seller.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    const listed = syncAuction(auction.createListing('seller', 'Ada', seller, 0, 1, 10));
    expect(listed.ok).toBe(true);
    expect(readItemInstanceId(listed.listing?.item)).toBe(ID_A);
    const buyer = new Inventory();
    const bought = auction.buyListing('buyer', 'Bob', buyer, listed.listing!.listingId);
    expect(bought.ok).toBe(true);
    expect(readItemInstanceId(buyer.getSlot(0))).toBe(ID_A);
    const claim = syncAuction(auction.claimListing('seller', new Inventory(), listed.listing!.listingId));
    expect(claim.ok).toBe(false);
    expect(buyer.count(PAINT)).toBe(1);
    expect(readItemInstanceId(buyer.getSlot(0))).toBe(ID_A);

    const inventories = new Map<string, Inventory>([
      ['ada', new Inventory()],
      ['bob', new Inventory()],
    ]);
    const trade = new TradeService(economy);
    trade.setRuntime({
      isOnline: () => true,
      displayName: (id) => id,
      lookupPlayer: (raw) => {
        const name = raw.trim().toLowerCase();
        if (name === 'ada' || name === 'bob') return { id: name, name, connected: true };
        return undefined;
      },
      inventory: (id) => inventories.get(id),
      balance: (id) => economy.getBalance(id),
      sendMessage: () => undefined,
    });
    inventories.get('ada')!.setSlot(0, withItemInstanceId(createItemStack(ItemId.GodSword, 1, { durability: 1 }), ID_B));
    expect(trade.request('ada', 'bob').ok).toBe(true);
    expect(trade.acceptRequest('bob', trade.incomingRequests('bob')[0]!.requestId).ok).toBe(true);
    expect(trade.putItem('ada', 0, 0).ok).toBe(true);
    expect(readItemInstanceId(trade.sessionFor('ada')!.offers.ada!.slots[0])).toBe(ID_B);
    expect(trade.ready('ada').ok).toBe(true);
    expect(trade.ready('bob').ok).toBe(true);
    expect(trade.accept('ada').ok).toBe(true);
    const done = trade.accept('bob');
    expect(done.ok).toBe(true);
    expect(readItemInstanceId(inventories.get('bob')!.slots.find((stack) => stack?.itemId === ItemId.GodSword) ?? null)).toBe(ID_B);

    const world = await start('held-dirty');
    const ada = addPlayer(world, 'Ada');
    const bob = addPlayer(world, 'Bob');
    ada.inventory.clear();
    ada.inventory.setSlot(0, withItemInstanceId(createItemStack(PAINT), ID_A));
    expect(world.trade.request(ada.id, 'Bob').ok).toBe(true);
    expect(world.trade.acceptRequest(bob.id, world.trade.incomingRequests(bob.id)[0]!.requestId).ok).toBe(true);
    expect(world.trade.putItem(ada.id, 0, 0).ok).toBe(true);
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      ada.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    (world as unknown as { dirty: boolean }).dirty = false;
    expect(world.trade.cancel(ada.id).ok).toBe(true);
    expect(readItemInstanceId(ada.heldReturns.find((stack) => stack.itemId === PAINT))).toBe(ID_A);
    expect(ada.heldReturns.filter((stack) => stack.itemId === PAINT)).toHaveLength(1);
    expect((world as unknown as { dirty: boolean }).dirty).toBe(true);
    (world as unknown as { dirty: boolean }).dirty = false;
    expect(world.trade.cancel(ada.id).ok).toBe(true);
    expect(ada.heldReturns.filter((stack) => stack.itemId === PAINT)).toHaveLength(1);
    expect(readItemInstanceId(ada.heldReturns[0])).toBe(ID_A);
    expect((world as unknown as { dirty: boolean }).dirty).toBe(false);
  });

  it('keeps god sword combat numbers, crafting, and block-state parsing unchanged', () => {
    const definition = getItemDefinition(ItemId.GodSword);
    expect(definition.kind).toBe('weapon');
    if (definition.kind === 'weapon') {
      expect(definition.durability).toBe(1);
      expect(definition.attackDamage).toBe(10);
      expect(definition.maxStack).toBe(1);
    }
    const sword = withItemInstanceId(createItemStack(ItemId.GodSword), ID_A);
    expect(damageItem(sword, 1)).toBeNull();
    expect(readItemInstanceId(sword)).toBe(ID_A);

    const bench = new Inventory();
    bench.addItem('oak_planks', 2);
    const crafted = craftOnceByRecipeId(bench, 'sticks');
    expect(crafted.ok).toBe(true);
    if (crafted.ok) expect(crafted.output.item).toBe('stick');
    expect(bench.slots.some((stack) => stack?.itemId === 'stick' && stack.metadata !== undefined)).toBe(false);

    const parsed = parseNetworkBlockState({
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: ID_A.toUpperCase(),
    });
    expect(parsed).toMatchObject({
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: ID_A,
    });
    expect(parseNetworkBlockState({
      attachment: 'wall',
      facing: 'east',
      paintingItemId: PAINT,
      paintingInstanceId: 'not-a-uuid',
    })?.paintingInstanceId).toBeUndefined();
    expect(PLAYER_EYE_HEIGHT).toBeGreaterThan(0);
  });

  it('mints a server placement id that is not the creative held id', () => {
    const world = emptyWorld('server-place');
    world.setBlock(5, 40, 5, BlockId.Stone);
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(world, 8.5, 40, 8, 'creative');
    player.inventory.setSlot(0, createItemStack(PAINT, 1));
    const look = {
      yaw: Math.atan2(-(5.5 - 8.5), -(5.5 - 8)),
      pitch: Math.atan2(40.5 - (40 + PLAYER_EYE_HEIGHT), Math.hypot(5.5 - 8.5, 5.5 - 8)),
    };
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    const placed = gameplay.placeBlock(player, 6, 40, 5, BlockId.CollectiblePainting);
    expect(placed).toEqual({ ok: true });
    const blockId = world.getBlockState(6, 40, 5)?.paintingInstanceId;
    const heldId = readItemInstanceId(player.inventory.getSlot(0));
    expect(blockId).toBeDefined();
    expect(heldId).toBeDefined();
    expect(blockId).not.toBe(heldId);
    expect(world.getBlockState(6, 40, 5)?.paintingItemId).toBe(PAINT);
    expect(world.getBlockState(6, 40, 5)?.facing).toBe('east');
    expect(player.inventory.getSlot(0)?.count).toBe(1);
  });

  it('marks a /give and a plugin give dirty and keeps the minted id across save', async () => {
    const worldId = 'grant-dirty';
    const first = await start(worldId);
    const dataDir = dirs.at(-1)!;
    const player = addPlayer(first, 'Keeper');
    player.inventory.clear();
    const flag = first as unknown as { dirty: boolean };
    flag.dirty = false;
    first.handleChat(player, '/give not_a_real_item 1');
    expect(flag.dirty).toBe(false);

    first.handleChat(player, `/give ${PAINT} 1`);
    expect(player.inventory.count(PAINT)).toBe(1);
    const minted = readItemInstanceId(player.inventory.slots.find((stack) => stack?.itemId === PAINT) ?? null);
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(flag.dirty).toBe(true);
    await first.save();
    const saved = JSON.parse(await readFile(join(dataDir, worldId, 'players.json'), 'utf8')) as {
      players: Record<string, { inventory: { slots: Array<{ itemId?: string; count?: number; metadata?: { itemInstanceId?: string } } | null> } }>;
    };
    const savedStack = saved.players[player.id]?.inventory.slots.find((stack) => stack?.itemId === PAINT);
    expect(savedStack?.count).toBe(1);
    expect(savedStack?.metadata?.itemInstanceId).toBe(minted);
    const token = player.sessionToken;
    await first.stop();
    worlds.pop();

    const second = await openSaved(dataDir, worldId);
    const returned = addPlayer(second, 'Keeper', token);
    expect(returned.inventory.count(PAINT)).toBe(1);
    expect(readItemInstanceId(returned.inventory.slots.find((stack) => stack?.itemId === PAINT) ?? null)).toBe(minted);

    const again = second as unknown as { dirty: boolean };
    again.dirty = false;
    second.handleChat(returned, '/give diamond 4');
    expect(again.dirty).toBe(true);
    const diamonds = returned.inventory.slots.find((stack) => stack?.itemId === 'diamond');
    expect(diamonds?.count).toBe(4);
    expect(diamonds?.metadata).toBeUndefined();
    expect(readItemInstanceId(diamonds ?? null)).toBeUndefined();

    again.dirty = false;
    second.plugins.register({
      name: 'grant-probe',
      onEnable(api) {
        const view = api.getPlayer('Keeper');
        if (!view) throw new Error('plugin player missing');
        const rejected = view.give('not_a_real_item', 1);
        if (rejected.given !== 0) throw new Error('unknown item was granted');
        if (again.dirty) throw new Error('rejected plugin give marked the world dirty');
        const granted = view.give(ItemId.GodSword, 1);
        if (granted.given !== 1) throw new Error('plugin give did not insert the sword');
      },
    } satisfies Plugin);
    await second.plugins.enableAll();
    expect(again.dirty).toBe(true);
    const sword = returned.inventory.slots.find((stack) => stack?.itemId === ItemId.GodSword);
    const swordId = readItemInstanceId(sword ?? null);
    expect(sword?.count).toBe(1);
    expect(swordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(swordId).not.toBe(minted);

    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      returned.inventory.setSlot(slot, createItemStack('cobblestone', 64));
    }
    again.dirty = false;
    second.handleChat(returned, `/give ${OTHER} 1`);
    expect(again.dirty).toBe(true);
    expect(returned.inventory.count(OTHER)).toBe(0);
    expect(second.gameplay.drops.entities).toHaveLength(1);
    const droppedId = readItemInstanceId(second.gameplay.drops.entities[0]?.stack);
    expect(droppedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.gameplay.drops.entities[0]?.stack.itemId).toBe(OTHER);
    expect(second.gameplay.drops.entities[0]?.stack.count).toBe(1);
  });
});
