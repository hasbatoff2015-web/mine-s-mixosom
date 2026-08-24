import { describe, expect, it } from 'vitest';
import {
  BlockId,
  DEFAULT_FURNACE_FACING,
  furnaceCubeFaceSlot,
  furnaceFaceTextureKey,
  furnaceFacingFromYaw,
  getBlockDefinition,
  torchBlockEmission,
} from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';
import { createItemStack } from '../src/inventory';
import { CONTAINER_STRINGS, RECIPE_CATEGORY_LABELS_EN } from '../src/ui/containerStrings';
import { getItemDefinition, usesFrontFacingGuiTexture } from '../src/items';
import { blockItemIconTexture } from '../src/blocks/placement';

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function clearRoom(world: VoxelWorld, cx: number, cy: number, cz: number): void {
  for (let x = cx - 2; x <= cx + 2; x += 1) {
    for (let y = cy - 2; y <= cy + 2; y += 1) {
      for (let z = cz - 2; z <= cz + 2; z += 1) writeBlock(world, x, y, z, BlockId.Air);
    }
  }
}

function recordingAtlas(): { atlas: TextureAtlas; keys: string[] } {
  const keys: string[] = [];
  const atlas = {
    tile(key: string) {
      keys.push(key);
      return { u0: 0, v0: 0, u1: 1, v1: 1 };
    },
  } as unknown as TextureAtlas;
  return { atlas, keys };
}

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

describe('furnace facing and lit visuals', () => {
  it('maps N/S/E/W front to the latch-facing world face', () => {
    const textures = getBlockDefinition(BlockId.Furnace).textures;
    expect(DEFAULT_FURNACE_FACING).toBe('north');
    expect(furnaceCubeFaceSlot(0, 0, -1, 'north')).toBe('front');
    expect(furnaceCubeFaceSlot(0, 0, 1, 'south')).toBe('front');
    expect(furnaceCubeFaceSlot(1, 0, 0, 'east')).toBe('front');
    expect(furnaceCubeFaceSlot(-1, 0, 0, 'west')).toBe('front');
    expect(furnaceCubeFaceSlot(0, 0, -1, 'south')).toBe('side');
    expect(furnaceFacingFromYaw(0)).toBe('south');
    expect(furnaceFaceTextureKey(textures, 'front', false)).toBe('block/furnace_front');
    expect(furnaceFaceTextureKey(textures, 'front', true)).toBe('block/furnace_front_on');
    expect(furnaceFaceTextureKey(textures, 'side', true)).toBe('block/furnace_side');
    expect(furnaceFaceTextureKey(textures, 'top', true)).toBe('block/furnace_top');
    expect(blockItemIconTexture(textures, 'furnace')).toBe('block/furnace_front');
    expect(getItemDefinition('furnace').texture).toBe('block/furnace_front');
    expect(getItemDefinition('furnace').texture).not.toBe('block/furnace_side');
    expect(usesFrontFacingGuiTexture('furnace')).toBe(true);
    expect(getItemDefinition('crafting_table').texture).toBe('block/crafting_table');
    expect(usesFrontFacingGuiTexture('crafting_table')).toBe(true);
  });

  it('meshes the lit front on the facing world side only', () => {
    const world = new VoxelWorld('furnace-mesh');
    clearRoom(world, 4, 40, 4);
    writeBlock(world, 4, 40, 4, BlockId.Furnace);
    world.setBlockState(4, 40, 4, { facing: 'south' });
    world.getFurnace(4, 40, 4).burnTime = 20;
    const { atlas, keys } = recordingAtlas();
    const chunk = world.getChunk(0, 0)!;
    const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
    expect(keys).toContain('block/furnace_front_on');
    expect(keys.filter((key) => key === 'block/furnace_front_on')).toHaveLength(1);
    expect(keys).toContain('block/furnace_side');
    expect(keys).toContain('block/furnace_top');
    disposeMeshed(meshed);

    world.getFurnace(4, 40, 4).burnTime = 0;
    const unlit = recordingAtlas();
    const meshedOff = new ChunkMesher(unlit.atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
    expect(unlit.keys).toContain('block/furnace_front');
    expect(unlit.keys).not.toContain('block/furnace_front_on');
    disposeMeshed(meshedOff);
  });

  it('uses torch emission while burning and zero when unlit, with light updates', () => {
    const world = new VoxelWorld('furnace-light');
    clearRoom(world, 8, 40, 8);
    writeBlock(world, 8, 40, 8, BlockId.Furnace);
    const chunk = world.getChunk(0, 0)!;
    seedChunkBlockLight(world, chunk);
    expect(world.blockEmissionAt(8, 40, 8)).toBe(0);
    expect(torchBlockEmission()).toBe(getBlockDefinition(BlockId.Torch).emission);
    const furnace = world.getFurnace(8, 40, 8);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack('coal');
    world.tick();
    expect(world.isFurnaceBurning(8, 40, 8)).toBe(true);
    expect(world.blockEmissionAt(8, 40, 8)).toBe(torchBlockEmission());
    expect(world.blockLightAt(8, 40, 8)).toBe(torchBlockEmission());
    furnace.slots[0] = null;
    furnace.slots[1] = null;
    furnace.burnTime = 1;
    furnace.burnTotal = 1;
    world.tick();
    expect(world.isFurnaceBurning(8, 40, 8)).toBe(false);
    expect(world.blockEmissionAt(8, 40, 8)).toBe(0);
    expect(world.blockLightAt(8, 40, 8)).toBe(0);
  });

  it('restores a burning furnace as lit with torch light after save/load', () => {
    const original = new VoxelWorld('furnace-save');
    original.setBlock(5, 42, 5, BlockId.Furnace);
    original.setBlockState(5, 42, 5, { facing: 'east' });
    const furnace = original.getFurnace(5, 42, 5);
    furnace.burnTime = 400;
    furnace.burnTotal = 1_600;
    furnace.slots[0] = createItemStack('iron_ore');
    const restored = new VoxelWorld('furnace-save');
    restored.restore({
      timeOfDay: 1000,
      modifications: original.serializeModifications(),
      chests: {},
      furnaces: Object.fromEntries(original.furnaces),
      blockStates: original.serializeBlockStates(),
    });
    restored.getChunk(0, 0);
    expect(restored.getBlock(5, 42, 5)).toBe(BlockId.Furnace);
    expect(restored.getBlockState(5, 42, 5)?.facing).toBe('east');
    expect(restored.isFurnaceBurning(5, 42, 5)).toBe(true);
    expect(restored.blockEmissionAt(5, 42, 5)).toBe(torchBlockEmission());
    expect(restored.blockLightAt(5, 42, 5)).toBe(torchBlockEmission());
  });
});

describe('container CSS contracts', () => {
  it('keeps canonical slot size labels for RU and EN categories', () => {
    expect(CONTAINER_STRINGS.catalog).toBe('Каталог');
    expect(CONTAINER_STRINGS.building).toBe('Строительство');
    expect(CONTAINER_STRINGS.equipment.length).toBeGreaterThan(3);
    expect(RECIPE_CATEGORY_LABELS_EN.building).toBe('Building');
    expect(RECIPE_CATEGORY_LABELS_EN.equipment).toBe('Equipment');
    expect(RECIPE_CATEGORY_LABELS_EN.redstone).toBe('Redstone');
    expect(RECIPE_CATEGORY_LABELS_EN.misc.length).toBeGreaterThan(3);
  });
});
