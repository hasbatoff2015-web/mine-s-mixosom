import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import {
  CRAFTING_RECIPES,
  findCraftingRecipe,
  getCraftingResult,
} from '../src/crafting';
import {
  Inventory,
  PORTAL_CHEST_SLOT_COUNT,
  createItemStack,
  createPortalChestInventory,
  isChestLikeBlock,
  isChestWindowKind,
  normalizePortalChestSlots,
} from '../src/inventory';
import { applyInventoryUiAction, isSharedContainerWindow } from '../src/inventory/inventoryUiAction';
import { itemHeldMeshKind, itemIconDescriptor } from '../src/items';
import { ItemId } from '../src/items';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  CHEST_TEXTURE_KEY,
  PORTAL_CHEST_TEXTURE_KEY,
  chestTextureKeyForBlock,
} from '../src/rendering/chestModel';
import { ChestRenderer } from '../src/rendering/ChestRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import { blockCollisionBoxes } from '../src/world/collision';
import { isUseTargetBlock } from '../src/world/blockInteraction';
import { resolveUseIntent } from '../src/gameplay/useInteraction';
import { parseWorldSnapshot } from '../src/save/snapshot';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { showsCreativeCatalog } from '../src/ui/containerInteractions';
import { containerStageSize } from '../src/ui/containerTheme';
import { CONTAINER_STRINGS } from '../src/ui/containerStrings';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

const portalRecipeGrid = [
  null, ItemId.RedstoneDust, null,
  null, 'chest', null,
  'obsidian', 'obsidian', 'obsidian',
];

describe('portal chest registration', () => {
  it('is a distinct chest-shaped block with its own id and texture', () => {
    expect(BlockId.PortalChest).not.toBe(BlockId.Chest);
    expect(getBlockDefinition(BlockId.PortalChest).key).toBe('portal_chest');
    expect(getBlockDefinition(BlockId.PortalChest).name).toBe('Портальный сундук');
    expect(getBlockDefinition(BlockId.PortalChest).renderShape).toBe('chest');
    expect(getBlockDefinition(BlockId.PortalChest).soundGroup).toBe('wood');
    expect(isChestLikeBlock(BlockId.PortalChest)).toBe(true);
    expect(isChestLikeBlock(BlockId.Chest)).toBe(true);
    expect(isUseTargetBlock(BlockId.PortalChest)).toBe(true);
    expect(chestTextureKeyForBlock(BlockId.PortalChest)).toBe(PORTAL_CHEST_TEXTURE_KEY);
    expect(chestTextureKeyForBlock(BlockId.Chest)).toBe(CHEST_TEXTURE_KEY);
    expect(itemHeldMeshKind('portal_chest')).toBe('special_model');
    expect(itemIconDescriptor('portal_chest')).toEqual({ kind: 'special_preview', category: 'chest' });
    expect(getBlockDefinition(BlockId.PortalChest).drop).toEqual({ item: 'portal_chest', count: 1 });
    expect(CONTAINER_STRINGS.portalChest).toBe('Портальный сундук');
  });

  it('does not emit cube faces and uses inset collision like a normal chest', () => {
    const world = new VoxelWorld('portal-chest-mesh');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    writeBlock(world, 3, 10, 4, BlockId.PortalChest);
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.chests).toEqual([{ x: 3, y: 10, z: 4 }]);
    expect(meshed.faces).toBe(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
    const box = blockCollisionBoxes({
      getBlock: () => BlockId.PortalChest,
      getBlockState: () => undefined,
    }, 0, 0, 0)[0]!;
    expect(box.minX).toBeCloseTo(1 / 16, 8);
    expect(box.maxY).toBeCloseTo(14 / 16, 8);
  });
});

describe('portal chest recipe', () => {
  it('crafts one portal chest from redstone, a chest and three obsidian', () => {
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id === 'portal_chest')).toBe(true);
    expect(findCraftingRecipe(portalRecipeGrid)?.id).toBe('portal_chest');
    expect(getCraftingResult(portalRecipeGrid)).toEqual({ itemId: 'portal_chest', count: 1 });
    expect(findCraftingRecipe([
      ItemId.RedstoneDust, null, null,
      null, 'chest', null,
      'obsidian', 'obsidian', 'obsidian',
    ])).toBeUndefined();
  });
});

describe('portal chest personal inventory', () => {
  it('has 27 slots, is not a shared world container, and restores empty missing saves', () => {
    expect(PORTAL_CHEST_SLOT_COUNT).toBe(27);
    expect(createPortalChestInventory().slots).toHaveLength(27);
    expect(isChestWindowKind('portal-chest')).toBe(true);
    expect(isSharedContainerWindow({ kind: 'portal-chest', x: 1, y: 2, z: 3 })).toBe(false);
    expect(isSharedContainerWindow({ kind: 'chest', x: 1, y: 2, z: 3 })).toBe(true);
    expect(showsCreativeCatalog('portal-chest', 'creative')).toBe(false);
    expect(containerStageSize('portal-chest', false).height).toBe(containerStageSize('chest', false).height);
    expect(normalizePortalChestSlots(undefined).every((slot) => slot === null)).toBe(true);
    expect(normalizePortalChestSlots([{ itemId: 'diamond', count: 10 }])[0]).toEqual(createItemStack('diamond', 10));
  });

  it('opens via use intent without placing a world chest record', () => {
    expect(resolveUseIntent({ hit: { block: BlockId.PortalChest, distance: 2 } })).toBe('open-portal-chest');
    const world = new VoxelWorld('portal-no-world-chest');
    expect(world.chests.size).toBe(0);
    const inventory = new Inventory();
    inventory.addItem('diamond', 1);
    const portal = createPortalChestInventory();
    const state = {
      inventory,
      cursor: null as ReturnType<Inventory['getSlot']>,
      craftSlots: [null, null, null, null],
      window: { kind: 'portal-chest' as const, x: 8, y: 40, z: 8 },
      gamemode: 'survival' as const,
      chest: portal,
    };
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'inventory-0',
      button: 'left',
    }).ok).toBe(true);
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
    }).ok).toBe(true);
    expect(portal.slots[0]).toEqual(createItemStack('diamond', 1));
    expect(world.chests.size).toBe(0);
  });

  it('keeps personal slots through a world snapshot parse', () => {
    const snapshot = parseWorldSnapshot({
      schemaVersion: WORLD_SCHEMA_VERSION,
      summary: {
        id: 'portal-save', name: 'Portal', seed: 's', mode: 'survival',
        createdAt: 1, updatedAt: 1, playTimeSeconds: 0,
      },
      timeOfDay: 0,
      weather: 'clear',
      player: {
        position: [0, 64, 0], velocity: [0, 0, 0], yaw: 0, pitch: 0,
        health: 20, hunger: 20, saturation: 5, selectedSlot: 0,
        inventory: new Inventory().serialize(),
        portalChest: [{ itemId: 'diamond', count: 4 }, ...Array.from({ length: 26 }, () => null)],
      },
      modifications: {},
      chests: {},
      furnaces: {},
      droppedItems: [],
    });
    expect(normalizePortalChestSlots(snapshot.player.portalChest)[0]).toEqual(createItemStack('diamond', 4));
  });
});

describe('portal chest renderer', () => {
  it('can bind a different entity texture than a wooden chest', () => {
    const renderer = new ChestRenderer();
    renderer.sync([
      { x: 1, y: 2, z: 3, facing: 'north', textureKey: PORTAL_CHEST_TEXTURE_KEY },
    ], 0.05);
    expect(renderer.instanceCount).toBe(1);
    renderer.dispose();
  });
});
