import { describe, expect, it } from 'vitest';
import { BlockId, chestFacingFromYaw, doorFacingFromYaw, furnaceFacingFromYaw, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { itemHeldMeshKind, itemIconDescriptor } from '../src/items';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  CHEST_TEXTURE_KEY,
  chestGeometryHasCoplanarBodyLidOverlap,
  chestLatchWorldNormal,
  chestLidAngle,
  chestLidFrontTopY,
  chestLidIncludesInteriorFace,
  chestYaw,
  createChestLidGeometry,
  createClosedChestGeometry,
  defaultChestFacing,
  isChestEntityTextureKey,
  stepChestOpenProgress,
} from '../src/rendering/chestModel';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { ChestRenderer } from '../src/rendering/ChestRenderer';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';
import { blockCollisionBoxes } from '../src/world/collision';
import { createItemStack } from '../src/inventory';
import { Inventory } from '../src/inventory';
import { shiftMoveStack, showsCreativeCatalog } from '../src/ui/containerInteractions';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

describe('chest world model', () => {
  it('is not an oak full cube and uses the entity chest texture', () => {
    expect(getBlockDefinition(BlockId.Chest).renderShape).toBe('chest');
    expect(getBlockDefinition(BlockId.Chest).renderShape).not.toBe('cube');
    expect(getBlockDefinition(BlockId.Chest).textures.all).not.toBe('block/oak_planks');
    expect(CHEST_TEXTURE_KEY).toBe('entity/chest/normal');
    expect(isChestEntityTextureKey(CHEST_TEXTURE_KEY)).toBe(true);
    expect(itemHeldMeshKind('chest')).toBe('special_model');
    expect(itemIconDescriptor('chest')).toEqual({ kind: 'special_preview', category: 'chest' });
  });

  it('does not emit chunk cube faces for a placed chest', () => {
    const world = new VoxelWorld('chest-mesh');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    writeBlock(world, 3, 10, 4, BlockId.Chest);
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.chests).toEqual([{ x: 3, y: 10, z: 4 }]);
    expect(meshed.faces).toBe(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
  });

  it('faces the player lock-forward and defaults legacy chests to north', () => {
    expect(defaultChestFacing(undefined)).toBe('north');
    expect(doorFacingFromYaw(0)).toBe('north');
    expect(chestFacingFromYaw(0)).toBe('south');
    expect(furnaceFacingFromYaw(0)).toBe('south');
    expect(chestFacingFromYaw(0)).not.toBe(doorFacingFromYaw(0));
    expect(chestYaw('east')).toBeCloseTo(-Math.PI / 2, 8);
    expect(chestYaw('south')).toBeCloseTo(Math.PI, 8);
    expect(chestLatchWorldNormal('north')[0]).toBeCloseTo(0, 8);
    expect(chestLatchWorldNormal('north')[2]).toBeCloseTo(-1, 8);
    expect(chestLatchWorldNormal('south')[2]).toBeCloseTo(1, 8);
    expect(chestLatchWorldNormal('west')[0]).toBeCloseTo(-1, 8);
    expect(chestLatchWorldNormal('east')[0]).toBeCloseTo(1, 8);
  });

  it('opens the lid up around the rear hinge, not down', () => {
    expect(chestLidAngle(0)).toBe(0);
    expect(chestLidAngle(1)).toBeCloseTo(Math.PI / 2, 8);
    expect(chestLidFrontTopY(1)).toBeGreaterThan(chestLidFrontTopY(0));
    expect(chestGeometryHasCoplanarBodyLidOverlap()).toBe(false);
    const lid = createChestLidGeometry();
    expect(chestLidIncludesInteriorFace(lid)).toBe(true);
    expect(lid.getIndex()?.count).toBe(36);
    lid.dispose();
  });

  it('interpolates lid progress without teleporting and keeps animation FPS-independent', () => {
    expect(chestLidAngle(0)).toBe(0);
    expect(chestLidAngle(1)).toBeCloseTo(Math.PI / 2, 8);
    const slow = stepChestOpenProgress(0, 1, 0.05);
    const fast = stepChestOpenProgress(0, 1, 0.2);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(1);
    expect(fast).toBeGreaterThan(slow);
    expect(stepChestOpenProgress(1, 1, 1)).toBe(1);
  });

  it('held/icon geometry is a chest model, not a 24-vertex cube', () => {
    const geometry = createClosedChestGeometry();
    expect(geometry.userData.chestModel).toBe(true);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(24);
    geometry.dispose();
    const factory = new ItemVisualFactory();
    const model = factory.createItemModel('chest');
    expect(model.userData.heldMeshKind).toBe('special_model');
    expect((model.children[0] as { name: string }).name).toContain(':special');
    factory.dispose();
  });

  it('keeps 27-slot contents through save restore and uses inset collision', () => {
    const world = new VoxelWorld('chest-save');
    world.getChest(2, 8, -4).slots[3] = createItemStack('diamond', 7);
    const restored = new VoxelWorld('chest-save');
    restored.restore({
      timeOfDay: 1000,
      modifications: {},
      chests: Object.fromEntries(world.chests),
      furnaces: {},
    });
    expect(restored.getChest(2, 8, -4).slots).toHaveLength(27);
    expect(restored.getChest(2, 8, -4).slots[3]).toEqual(createItemStack('diamond', 7));
    const box = blockCollisionBoxes({
      getBlock: () => BlockId.Chest,
      getBlockState: () => undefined,
    }, 0, 0, 0)[0]!;
    expect(box.minX).toBeCloseTo(1 / 16, 8);
    expect(box.maxY).toBeCloseTo(14 / 16, 8);
  });

  it('does not mount the Creative catalog inside a chest screen', () => {
    expect(showsCreativeCatalog('chest', 'creative')).toBe(false);
    expect(showsCreativeCatalog('furnace', 'creative')).toBe(false);
    expect(showsCreativeCatalog('crafting-table', 'creative')).toBe(false);
    expect(showsCreativeCatalog('inventory', 'creative')).toBe(true);
    expect(showsCreativeCatalog('inventory', 'survival')).toBe(false);
  });

  it('shift-transfers between chest and inventory without duplicating', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('cobblestone', 7));
    const chest = Array.from({ length: 27 }, () => null as ReturnType<typeof createItemStack> | null);
    const moved = shiftMoveStack(inventory.getSlot(0)!, chest);
    inventory.setSlot(0, moved.remainder);
    expect(inventory.getSlot(0)).toBeNull();
    expect(moved.targets[0]).toEqual(createItemStack('cobblestone', 7));
    const back = shiftMoveStack(moved.targets[0]!, inventory.slots as Array<ReturnType<typeof createItemStack> | null>);
    expect(back.remainder).toBeNull();
  });
});

describe('chest open target', () => {
  it('tracks a single open chest key and clears it on close', () => {
    const renderer = new ChestRenderer();
    renderer.setOpenTarget('1,2,3');
    renderer.sync([
      { x: 1, y: 2, z: 3, facing: 'north' },
      { x: 4, y: 2, z: 3, facing: 'east' },
    ], 0.05);
    expect(renderer.getOpenTarget()).toBe('1,2,3');
    expect(renderer.targetFor('1,2,3')).toBe(1);
    expect(renderer.targetFor('4,2,3')).toBe(0);
    expect(renderer.progressFor('1,2,3')).toBeGreaterThan(0);
    expect(renderer.progressFor('4,2,3')).toBe(0);
    renderer.setOpenTarget(undefined);
    renderer.sync([
      { x: 1, y: 2, z: 3, facing: 'north' },
      { x: 4, y: 2, z: 3, facing: 'east' },
    ], 1);
    expect(renderer.targetFor('1,2,3')).toBe(0);
    expect(renderer.getOpenTarget()).toBeUndefined();
    renderer.dispose();
  });
});
