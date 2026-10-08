import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CRAFTING_RECIPES, SMELTING_RECIPES } from '../src/crafting';
import { placeBlockAt, placeFromHit, type UseSimulationContext } from '../src/gameplay';
import { HeadlessEntityHost } from '../src/entities/EntityHost';
import { DroppedItemManager } from '../src/entities/DroppedItemManager';
import { MOB_DEFINITIONS } from '../src/entities/mobDefinitions';
import { PLAYER_REACH } from '../src/core/constants';
import {
  Inventory,
  createItemStack,
  createPortalChestInventory,
} from '../src/inventory';
import {
  COLLECTIBLE_PAINTING_IDS,
  ItemId,
  ITEMS,
  collectiblePaintingDropItemId,
  collectiblePaintingTexture,
  creativeCatalogItems,
  getItemDefinition,
  isCollectiblePaintingItemId,
  isItemObtainable,
  obtainableItems,
} from '../src/items';
import { displayNameFor, itemDescriptionFor } from '../src/i18n';
import { PaintingRenderer } from '../src/rendering/PaintingRenderer';
import { worldDaylightUniform } from '../src/rendering/worldLighting';
import { itemHoverAttributeString } from '../src/ui/itemTooltip';
import { auctionSlotHint, AUCTION_CLAIM_HINT } from '../src/ui/auctionGui';
import { Chunk } from '../src/world/Chunk';
import { blockCollisionBoxes } from '../src/world/collision';
import { selectionLocalBoxes } from '../src/world/blockGeometry';
import {
  PAINTING_ART,
  PAINTING_ART_Z0,
  PAINTING_ART_Z1,
  PAINTING_BACK_Z0,
  PAINTING_BACK_Z1,
  PAINTING_OUTER,
  PAINTING_RAIL,
  PAINTING_RAIL_Z0,
  PAINTING_RAIL_Z1,
  PAINTING_SELECTION_DEPTH,
  paintingArtEdge,
  paintingSelectionLocalBox,
  paintingViewerLeft,
} from '../src/world/painting';
import { applyNetworkBlockChanges } from '../src/world/networkBlockUpdates';
import { VoxelWorld } from '../src/world/World';
import { parseNetworkBlockState } from '../shared/protocol';
import { EventBus } from '../server/events';
import { ServerGameplay, type GameplayPlayer } from '../server/gameplay';
import { CombatSystem } from '../src/combat';
import { PlayerController } from '../src/player';
import { SurvivalSystem } from '../src/survival';
import type { HorizontalFacing } from '../src/blocks';

const NAMES: Record<string, string> = {
  painting_01_villager_hmm: 'Хмм...',
  painting_02_night_guardian: 'Ночной страж',
  painting_03_sunset_cat: 'Закатный кот',
  painting_04_grass_cat: 'Кот на траве',
  painting_05_dark_steve: 'Мрачный Стив',
  painting_06_golden_cat: 'Золотоглазый',
  painting_07_sunny_bee: 'Солнечная пчела',
  painting_08_smirk: 'Прищур',
  painting_09_rainbow_ghast: 'Радужный гаст',
  painting_10_giant_zombie: 'Гигант',
  painting_11_crowd_scream: 'Крик',
  painting_12_underwater_patrick: 'Под водой',
  painting_13_gucci_character: 'Стиль',
  painting_14_minecraft_portrait: 'Блоковый портрет',
  painting_15_confident_beard: 'Уверенность',
  painting_16_grass_steve: 'Стив',
  painting_17_troll_smile: 'Улыбка',
  painting_18_lynx_rabbit: 'Рысь-кролик',
  painting_19_burning_mask: 'Горящая маска',
  painting_20_tiger_musya: 'Муся',
};

const DESCRIPTIONS: Record<string, string> = {
  painting_01_villager_hmm: 'Даже житель не уверен, что это хорошая идея.',
  painting_02_night_guardian: 'Когда улицы пустеют, он всё ещё на посту.',
  painting_03_sunset_cat: 'Идеальный вечер существует. Кот уже его нашёл.',
  painting_04_grass_cat: 'Маленький блоковый хищник вышел на прогулку.',
  painting_05_dark_steve: 'Он смотрит из темноты чуть дольше, чем хотелось бы.',
  painting_06_golden_cat: 'Слишком сильный, чтобы просто лежать на диване.',
  painting_07_sunny_bee: 'Несёт лето туда, где ещё не прогрузилось солнце.',
  painting_08_smirk: 'Этот взгляд уже знает, что ты собираешься сделать.',
  painting_09_rainbow_ghast: 'Даже Нижнему миру иногда нужен праздник.',
  painting_10_giant_zombie: 'Обычный зомби, если смотреть на него снизу вверх.',
  painting_11_crowd_scream: 'Тот самый момент, когда увидел цену на аукционе.',
  painting_12_underwater_patrick: 'Он всё ещё улыбается. Причины неизвестны.',
  painting_13_gucci_character: 'Когда обычный скин уже не соответствует статусу.',
  painting_14_minecraft_portrait: 'Простой герой из мира, где всё состоит из кубов.',
  painting_15_confident_beard: 'Он не сомневается. Даже когда стоило бы.',
  painting_16_grass_steve: 'Тихий момент между добычей ресурсов и очередной проблемой.',
  painting_17_troll_smile: 'Улыбка, которой лучше не доверять.',
  painting_18_lynx_rabbit: 'Редкий зверь, которого никто не просил объяснять.',
  painting_19_burning_mask: 'Сгорает всё, кроме выражения лица.',
  painting_20_tiger_musya: 'Муся знает, кто здесь настоящий босс.',
};

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}

function ctxFor(world: VoxelWorld, gamemode: 'survival' | 'creative' = 'survival'): UseSimulationContext {
  const inventory = new Inventory();
  return {
    world,
    inventory,
    selectedSlot: 0,
    gamemode,
    reach: PLAYER_REACH,
    hit: undefined,
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
  };
}

function hitAt(
  x: number,
  y: number,
  z: number,
  normal: [number, number, number],
  block = BlockId.Stone,
) {
  return {
    x, y, z, block,
    normal: new THREE.Vector3(normal[0], normal[1], normal[2]),
    distance: 2,
    point: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
  };
}

function hang(
  ctx: UseSimulationContext,
  support: [number, number, number],
  normal: [number, number, number],
  itemId: string,
) {
  ctx.inventory.setSlot(0, createItemStack(itemId, 1));
  const hit = hitAt(support[0], support[1], support[2], normal);
  return placeFromHit(ctx, hit, BlockId.CollectiblePainting);
}

function playerNear(x: number, y: number, z: number, gamemode: 'survival' | 'creative' = 'survival'): GameplayPlayer {
  return {
    id: 'painter', connected: true,
    controller: new PlayerController({ position: [x + 0.5, y, z + 1.5], yaw: 0, pitch: 0 }),
    inventory: new Inventory(), portalChest: createPortalChestInventory(), survival: new SurvivalSystem(),
    combat: new CombatSystem(),
    gamemode, selectedSlot: 0, cursor: null,
    craftSlots: [null, null, null, null], window: { kind: 'inventory' },
    miningTarget: { x, y, z }, miningProgress: 1,
    bowUseTicks: 0, foodUseTicks: 0, lastUse: false, lastSprint: false,
    vehicleForward: 0, inventoryDirty: false,
  };
}

describe('collectible painting items', () => {
  it('registers twenty unique resource items and one generic block', () => {
    expect(COLLECTIBLE_PAINTING_IDS).toHaveLength(20);
    expect(new Set(COLLECTIBLE_PAINTING_IDS).size).toBe(20);
    expect(BlockId.CollectiblePainting).toBe(170);
    const block = getBlockDefinition(BlockId.CollectiblePainting);
    expect(block.renderShape).toBe('painting');
    expect(block.hasItem).toBe(false);
    expect(block.solid).toBe(false);
    expect(block.opaque).toBe(false);
    expect(block.occludesFaces).toBe(false);
    expect(block.liquid).toBeFalsy();
    expect(block.replaceable).toBeFalsy();
    expect(block.fluidDisplaceable).toBeFalsy();
    expect(block.breakable).not.toBe(false);
    expect(block.hardness).toBe(0);
    expect(block.drop).toBeUndefined();
    expect(ITEMS.filter((item) => item.kind === 'block' && item.blockId === BlockId.CollectiblePainting)).toHaveLength(0);
    const catalog = creativeCatalogItems();
    for (const id of COLLECTIBLE_PAINTING_IDS) {
      const item = getItemDefinition(id);
      expect(item.kind).toBe('resource');
      expect(item.maxStack).toBe(1);
      expect(item.placesBlockId).toBe(BlockId.CollectiblePainting);
      expect(item.hiddenFromGameplay).toBe(true);
      expect(item.creativeCatalog).toBe(true);
      expect(item.texture).toBe(`painting/collectibles/${id}`);
      expect(item.tags).toEqual([
        'collectible',
        'painting',
        'collectible_painting',
        `painting:${id.slice(9, 11)}`,
      ]);
      expect(item.name).toBe(NAMES[id]);
      expect(item.description).toBe(DESCRIPTIONS[id]);
      expect(itemDescriptionFor(id)).toBe(DESCRIPTIONS[id]);
      expect(displayNameFor(id, 'en')).not.toBe(id);
      expect(isItemObtainable(id)).toBe(false);
      expect(catalog.some((entry) => entry.id === id)).toBe(true);
      expect(ItemId[Object.keys(ItemId).find((key) => ItemId[key as keyof typeof ItemId] === id)! as keyof typeof ItemId]).toBe(id);
    }
    expect(catalog.some((entry) => entry.id === 'collectible_painting')).toBe(false);
    expect(obtainableItems().some((item) => isCollectiblePaintingItemId(item.id))).toBe(false);
  });

  it('keeps paintings out of recipes, smelting, and mob loot', () => {
    const blob = JSON.stringify({ CRAFTING_RECIPES, SMELTING_RECIPES });
    for (const id of COLLECTIBLE_PAINTING_IDS) expect(blob.includes(id)).toBe(false);
    expect(blob.includes('collectible_painting')).toBe(false);
    for (const definition of Object.values(MOB_DEFINITIONS)) {
      for (const loot of definition.loot) expect(isCollectiblePaintingItemId(loot.itemId)).toBe(false);
    }
    const generator = readFileSync(new URL('../src/world/Generator.ts', import.meta.url), 'utf8');
    expect(generator.includes('CollectiblePainting')).toBe(false);
    expect(generator.includes('painting_')).toBe(false);
  });

  it('sends the yellow description through the existing hint attribute', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.mc-item-tooltip-hint\s*\{[^}]*color:\s*#ffff55/);
    const attrs = itemHoverAttributeString(
      NAMES.painting_01_villager_hmm!,
      ItemId.Painting01VillagerHmm,
      (value) => value,
      DESCRIPTIONS.painting_01_villager_hmm,
    );
    expect(attrs).toContain('data-item-tooltip="Хмм..."');
    expect(attrs).toContain(`data-item-tooltip-hint="${DESCRIPTIONS.painting_01_villager_hmm}"`);
    expect(auctionSlotHint(undefined, DESCRIPTIONS.painting_20_tiger_musya)).toBe(DESCRIPTIONS.painting_20_tiger_musya);
    expect(auctionSlotHint('CANCELLED', DESCRIPTIONS.painting_20_tiger_musya)).toBe(AUCTION_CLAIM_HINT);
    expect(auctionSlotHint('EXPIRED', DESCRIPTIONS.painting_01_villager_hmm)).toBe(AUCTION_CLAIM_HINT);
  });
});

describe('collectible painting placement', () => {
  it('hangs on the four vertical faces and stores the held item id', () => {
    const world = emptyWorld('paint-faces');
    world.setBlock(5, 40, 5, BlockId.Stone);
    const ctx = ctxFor(world);
    const faces: Array<[string, [number, number, number], [number, number, number], HorizontalFacing]> = [
      [ItemId.Painting01VillagerHmm, [0, 0, -1], [5, 40, 4], 'north'],
      [ItemId.Painting03SunsetCat, [0, 0, 1], [5, 40, 6], 'south'],
      [ItemId.Painting09RainbowGhast, [1, 0, 0], [6, 40, 5], 'east'],
      [ItemId.Painting20TigerMusya, [-1, 0, 0], [4, 40, 5], 'west'],
    ];
    for (const [itemId, normal, cell, facing] of faces) {
      expect(hang(ctx, [5, 40, 5], normal, itemId)).toEqual({ ok: true });
      expect(world.getBlock(cell[0], cell[1], cell[2], false)).toBe(BlockId.CollectiblePainting);
      expect(world.getBlockState(cell[0], cell[1], cell[2])).toMatchObject({
        attachment: 'wall',
        facing,
        paintingItemId: itemId,
      });
      expect(ctx.inventory.getSlot(0)).toBeNull();
    }
  });

  it('refuses floor, ceiling, liquids, weak supports, and a forged block id', () => {
    const world = emptyWorld('paint-deny');
    world.setBlock(5, 40, 5, BlockId.Stone);
    world.setBlock(5, 42, 5, BlockId.Stone);
    world.setBlock(6, 40, 5, BlockId.Water);
    world.setBlock(8, 40, 5, BlockId.TallGrass);
    const ctx = ctxFor(world);
    ctx.inventory.setSlot(0, createItemStack(ItemId.Painting05DarkSteve));
    expect(placeFromHit(ctx, hitAt(5, 40, 5, [0, 1, 0]), BlockId.CollectiblePainting).ok).toBe(false);
    expect(placeFromHit(ctx, hitAt(5, 42, 5, [0, -1, 0]), BlockId.CollectiblePainting).ok).toBe(false);
    expect(placeFromHit(ctx, hitAt(5, 40, 5, [1, 0, 0]), BlockId.CollectiblePainting).ok).toBe(false);
    expect(world.getBlock(6, 40, 5, false)).toBe(BlockId.Water);
    expect(placeBlockAt(
      ctx,
      9,
      40,
      5,
      BlockId.CollectiblePainting,
      hitAt(8, 40, 5, [1, 0, 0], BlockId.TallGrass),
    ).ok).toBe(false);
    expect(world.getBlock(8, 40, 5, false)).toBe(BlockId.TallGrass);
    expect(ctx.inventory.getSlot(0)?.itemId).toBe(ItemId.Painting05DarkSteve);
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.Air);
    expect(world.getBlock(5, 41, 5, false)).not.toBe(BlockId.CollectiblePainting);

    const creative = ctxFor(world, 'creative');
    creative.inventory.setSlot(0, createItemStack('dirt'));
    expect(placeBlockAt(creative, 4, 40, 5, BlockId.CollectiblePainting, hitAt(5, 40, 5, [-1, 0, 0])).ok).toBe(false);
    expect(world.getBlock(4, 40, 5, false)).toBe(BlockId.Air);

    const claimed = ctxFor(world);
    claimed.allowPlace = () => false;
    claimed.inventory.setSlot(0, createItemStack(ItemId.Painting05DarkSteve));
    expect(placeFromHit(claimed, hitAt(5, 40, 5, [0, 0, -1]), BlockId.CollectiblePainting)).toEqual({ ok: false, reason: 'cancelled' });
    expect(world.getBlock(5, 40, 4, false)).toBe(BlockId.Air);
    expect(claimed.inventory.getSlot(0)?.count).toBe(1);
  });

  it('does not consume a creative copy and stays inside the world border', () => {
    const world = emptyWorld('paint-creative');
    world.setBlock(5, 40, 5, BlockId.Stone);
    const ctx = ctxFor(world, 'creative');
    ctx.inventory.setSlot(0, createItemStack(ItemId.Painting07SunnyBee));
    expect(hang(ctx, [5, 40, 5], [1, 0, 0], ItemId.Painting07SunnyBee).ok).toBe(true);
    expect(ctx.inventory.getSlot(0)?.itemId).toBe(ItemId.Painting07SunnyBee);
    expect(ctx.inventory.getSlot(0)?.count).toBe(1);
    expect(world.getBlockState(6, 40, 5)?.paintingItemId).toBe(ItemId.Painting07SunnyBee);

    const border = new VoxelWorld('paint-border');
    const chunkX = Math.floor(9999 / 16);
    border.chunks.set(`${chunkX},0`, new Chunk(chunkX, 0));
    border.setBlock(9999, 40, 5, BlockId.Stone);
    const edge = ctxFor(border);
    edge.inventory.setSlot(0, createItemStack(ItemId.Painting11CrowdScream));
    expect(placeFromHit(edge, hitAt(9999, 40, 5, [1, 0, 0]), BlockId.CollectiblePainting)).toEqual({ ok: false, reason: 'bounds' });
    expect(border.getBlock(10000, 40, 5, false)).not.toBe(BlockId.CollectiblePainting);
    expect(placeFromHit(edge, hitAt(9999, 40, 5, [-1, 0, 0]), BlockId.CollectiblePainting).ok).toBe(true);
    expect(border.getBlock(9998, 40, 5, false)).toBe(BlockId.CollectiblePainting);
    expect(border.getBlockState(9998, 40, 5)?.facing).toBe('west');
  });
});

describe('collectible painting break, support, and persistence', () => {
  it('drops the exact item once in survival and nothing in creative', () => {
    const world = emptyWorld('paint-break');
    world.setBlock(5, 40, 5, BlockId.Stone);
    world.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    world.setBlockState(6, 40, 5, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: ItemId.Painting03SunsetCat,
    });
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(6, 40, 5);
    expect(gameplay.breakBlock(player, 6, 40, 5)).toEqual({ ok: true });
    expect(world.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(gameplay.drops.entities.map((entity) => entity.stack.itemId)).toEqual([ItemId.Painting03SunsetCat]);

    const creativeWorld = emptyWorld('paint-creative-break');
    creativeWorld.setBlock(6, 40, 5, BlockId.CollectiblePainting);
    creativeWorld.setBlockState(6, 40, 5, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: ItemId.Painting03SunsetCat,
    });
    const creative = new ServerGameplay(creativeWorld, new EventBus());
    expect(creative.breakBlock(playerNear(6, 40, 5, 'creative'), 6, 40, 5).ok).toBe(true);
    expect(creative.drops.entities).toHaveLength(0);
  });

  it('drops each supported painting once when the wall is removed', () => {
    const world = emptyWorld('paint-support');
    world.setBlock(5, 40, 5, BlockId.Stone);
    const ctx = ctxFor(world);
    expect(hang(ctx, [5, 40, 5], [1, 0, 0], ItemId.Painting01VillagerHmm).ok).toBe(true);
    expect(hang(ctx, [5, 40, 5], [0, 0, -1], ItemId.Painting20TigerMusya).ok).toBe(true);
    const gameplay = new ServerGameplay(world, new EventBus());
    const player = playerNear(5, 40, 5);
    expect(gameplay.breakBlock(player, 5, 40, 5).ok).toBe(true);
    gameplay.tick([], 0.05, { tickPlayers() {} });
    gameplay.tick([], 0.05, { tickPlayers() {} });
    const paintings = gameplay.drops.entities
      .map((entity) => entity.stack.itemId)
      .filter((id) => isCollectiblePaintingItemId(id))
      .sort();
    expect(paintings).toEqual([ItemId.Painting01VillagerHmm, ItemId.Painting20TigerMusya].sort());
    expect(world.getBlock(6, 40, 5, false)).toBe(BlockId.Air);
    expect(world.getBlock(5, 40, 4, false)).toBe(BlockId.Air);
    expect(collectiblePaintingDropItemId(BlockId.CollectiblePainting, { paintingItemId: '../../something' })).toBeUndefined();
  });

  it('keeps state across prune, reload, and snapshot restore', () => {
    const world = emptyWorld('paint-save');
    world.setBlock(2, 40, 2, BlockId.Stone);
    world.setBlock(3, 40, 2, BlockId.CollectiblePainting);
    world.setBlockState(3, 40, 2, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: ItemId.Painting09RainbowGhast,
    });
    const version = world.paintingVersion;
    world.setBlock(1, 40, 1, BlockId.Water);
    world.setBlockState(1, 40, 1, { fluidLevel: 6 });
    expect(world.paintingVersion).toBe(version);
    expect(world.chunks.has('0,0')).toBe(true);
    expect(world.pruneChunks(10_000, 0, 0)).toContain('0,0');
    expect(world.chunks.has('0,0')).toBe(false);
    expect(world.getBlockState(3, 40, 2)?.paintingItemId).toBe(ItemId.Painting09RainbowGhast);
    world.getChunk(0, 0);
    expect(world.getBlock(3, 40, 2, false)).toBe(BlockId.CollectiblePainting);
    expect(world.getBlockState(3, 40, 2)?.facing).toBe('east');

    const restored = new VoxelWorld('paint-restore');
    restored.restore({
      timeOfDay: 1_000,
      modifications: world.serializeModifications(),
      chests: {},
      furnaces: {},
      signs: {},
      blockStates: {
        ...world.serializeBlockStates(),
        '8,40,2': { facing: 'west', attachment: 'wall', paintingItemId: '../../something' },
        '9,40,2': { facing: 'south', attachment: 'wall', paintingItemId: 'unknown_painting' },
      },
    });
    restored.getChunk(0, 0);
    expect(restored.getBlock(3, 40, 2, false)).toBe(BlockId.CollectiblePainting);
    expect(restored.getBlockState(3, 40, 2)?.paintingItemId).toBe(ItemId.Painting09RainbowGhast);
    expect(restored.getBlockState(8, 40, 2)?.paintingItemId).toBeUndefined();
    expect(JSON.stringify(restored.getBlockState(8, 40, 2))).not.toContain('..');
    expect(restored.getBlockState(8, 40, 2)?.facing).toBe('west');
    expect(restored.getBlockState(9, 40, 2)?.paintingItemId).toBeUndefined();
  });

  it('whitelists the network field and ignores unknown texture paths', () => {
    const good = parseNetworkBlockState({
      facing: 'west',
      attachment: 'wall',
      paintingItemId: ItemId.Painting05DarkSteve,
    });
    expect(good).toMatchObject({
      facing: 'west',
      attachment: 'wall',
      paintingItemId: ItemId.Painting05DarkSteve,
    });
    const bad = parseNetworkBlockState({ facing: 'north', paintingItemId: '../../something' });
    expect(bad?.paintingItemId).toBeUndefined();
    expect(JSON.stringify(bad)).not.toContain('something');
    expect(parseNetworkBlockState({ paintingItemId: 'unknown_painting' })).toBeUndefined();

    const world = emptyWorld('paint-net');
    applyNetworkBlockChanges(world, [{
      x: 4, y: 40, z: 4, blockId: BlockId.CollectiblePainting, state: good,
    }]);
    expect(world.getBlock(4, 40, 4, false)).toBe(BlockId.CollectiblePainting);
    expect(world.getBlockState(4, 40, 4)?.paintingItemId).toBe(ItemId.Painting05DarkSteve);
    expect(collectiblePaintingTexture('../../something')).toBeUndefined();
    expect(collectiblePaintingTexture(ItemId.Painting05DarkSteve)).toBe('painting/collectibles/painting_05_dark_steve');
  });
});

describe('collectible painting geometry and storage', () => {
  it('uses one thin frame and does not mirror east or west', () => {
    expect(PAINTING_OUTER).toBeCloseTo(0.94);
    expect(PAINTING_RAIL).toBeGreaterThanOrEqual(0.07);
    expect(PAINTING_RAIL).toBeLessThanOrEqual(0.08);
    expect(PAINTING_OUTER - PAINTING_RAIL * 2).toBeCloseTo(0.79);
    expect(PAINTING_ART).toBeCloseTo(0.81);
    expect(PAINTING_BACK_Z1).toBeLessThan(PAINTING_ART_Z0);
    expect(PAINTING_ART_Z1).toBeLessThan(PAINTING_RAIL_Z0);
    expect(PAINTING_RAIL_Z1 - PAINTING_BACK_Z0).toBeCloseTo(0.074);
    expect(PAINTING_SELECTION_DEPTH).toBeCloseTo(0.12);
    for (const facing of ['north', 'south', 'east', 'west'] as const) {
      const box = paintingSelectionLocalBox(facing);
      const sizeX = box.maxX - box.minX;
      const sizeY = box.maxY - box.minY;
      const sizeZ = box.maxZ - box.minZ;
      const thin = Math.min(sizeX, sizeZ);
      expect(thin).toBeCloseTo(0.12);
      expect(Math.max(sizeX, sizeZ)).toBeCloseTo(0.94);
      expect(sizeY).toBeCloseTo(0.94);
      expect(sizeX * sizeY * sizeZ).toBeLessThan(0.2);
      const left = paintingArtEdge(facing, 'left');
      const right = paintingArtEdge(facing, 'right');
      const viewerLeft = paintingViewerLeft(facing);
      const dot = (left.x - right.x) * viewerLeft.x + (left.z - right.z) * viewerLeft.z;
      expect(dot).toBeGreaterThan(0.5);
    }
    const world = emptyWorld('paint-collision');
    world.setBlock(3, 40, 3, BlockId.CollectiblePainting);
    world.setBlockState(3, 40, 3, { attachment: 'wall', facing: 'south', paintingItemId: ItemId.Painting16GrassSteve });
    expect(blockCollisionBoxes(world, 3, 40, 3)).toEqual([]);
    const selection = selectionLocalBoxes(BlockId.CollectiblePainting, { facing: 'south' });
    expect(selection[0]?.maxZ).toBeCloseTo(0.12);
    expect(selection[0]?.maxX).toBeLessThan(1);
  });

  it('rebuilds a visual when the chunk unloads and comes back', () => {
    const world = emptyWorld('paint-visual');
    world.setBlock(3, 40, 2, BlockId.CollectiblePainting);
    world.setBlockState(3, 40, 2, {
      attachment: 'wall',
      facing: 'east',
      paintingItemId: ItemId.Painting09RainbowGhast,
    });
    const renderer = new PaintingRenderer(world, (key) => world.chunks.has(key));
    const daylight = worldDaylightUniform.value;
    worldDaylightUniform.value = 1;
    renderer.sync();
    expect(renderer.group.children).toHaveLength(1);
    const day = meshColor(renderer);
    expect(day.r).toBeGreaterThan(0.05);
    expect(day.r).toBeLessThan(0.25);
    worldDaylightUniform.value = 0.08;
    renderer.sync();
    const night = meshColor(renderer);
    expect(night.r).toBeLessThan(day.r);
    expect(night.r).toBeGreaterThan(0);
    worldDaylightUniform.value = 1;
    const chunk = world.chunks.get('0,0')!;
    chunk.blockLight[Chunk.index(3, 40, 2)] = 2;
    renderer.sync();
    const torch = meshColor(renderer);
    expect(torch.r).toBeGreaterThan(day.r);
    expect(torch.r).toBeGreaterThan(torch.b);
    world.pruneChunks(10_000, 0, 0);
    renderer.invalidateVisibility();
    renderer.sync();
    expect(renderer.group.children).toHaveLength(0);
    world.getChunk(0, 0);
    renderer.invalidateVisibility();
    renderer.sync();
    expect(renderer.group.children).toHaveLength(1);
    worldDaylightUniform.value = daylight;
    renderer.dispose();
  });

  it('stores separate copies in inventory, chests, and dropped items', () => {
    const inventory = new Inventory();
    expect(inventory.add(createItemStack(ItemId.Painting07SunnyBee))).toBeNull();
    expect(inventory.add(createItemStack(ItemId.Painting07SunnyBee))).toBeNull();
    expect(inventory.getSlot(0)?.count).toBe(1);
    expect(inventory.getSlot(1)?.itemId).toBe(ItemId.Painting07SunnyBee);
    expect(() => createItemStack(ItemId.Painting07SunnyBee, 2)).toThrow();

    const world = emptyWorld('paint-chest');
    world.chests.set('1,40,1', { slots: [createItemStack(ItemId.Painting14MinecraftPortrait), null] });
    expect(world.chests.get('1,40,1')?.slots[0]?.itemId).toBe(ItemId.Painting14MinecraftPortrait);
    const portal = createPortalChestInventory();
    portal.slots[3] = createItemStack(ItemId.Painting18LynxRabbit);
    expect(portal.slots[3]?.itemId).toBe(ItemId.Painting18LynxRabbit);

    const drops = new DroppedItemManager(new HeadlessEntityHost(), world, { pickupDelaySeconds: 0 });
    drops.spawn(createItemStack(ItemId.Painting07SunnyBee), { x: 1, y: 40, z: 1 }, { pickupDelaySeconds: 0 });
    const picked: string[] = [];
    drops.collectNearby({ x: 1, y: 40, z: 1 }, (stack) => {
      picked.push(stack.itemId);
      return true;
    });
    expect(picked).toEqual([ItemId.Painting07SunnyBee]);
    expect(drops.count).toBe(0);
  });
});

function meshColor(renderer: PaintingRenderer): { r: number; g: number; b: number } {
  const root = renderer.group.children[0] as THREE.Group;
  const art = root.children[1] as THREE.Mesh;
  const color = (art.material as THREE.MeshBasicMaterial).color;
  return { r: color.r, g: color.g, b: color.b };
}
