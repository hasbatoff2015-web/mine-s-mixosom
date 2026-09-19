import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import {
  isChestLikeBlock,
  isSharedWorldChestBlock,
} from '../src/inventory';
import { isUseTargetBlock } from '../src/world/blockInteraction';
import { itemHeldMeshKind, itemIconDescriptor } from '../src/items';
import {
  CHEST_TEXTURE_KEY,
  EVENT_CHEST_TEXTURE_KEY,
  PORTAL_CHEST_TEXTURE_KEY,
  chestTextureKeyForBlock,
  isChestEntityTextureKey,
} from '../src/rendering/chestModel';
import { CONTAINER_STRINGS } from '../src/ui/containerStrings';
import { resolveUseIntent } from '../src/gameplay/useInteraction';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import { VoxelWorld } from '../src/world/World';
import { blockCollisionBoxes } from '../src/world/collision';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

describe('event chest registration', () => {
  it('reuses the chest model with a dedicated entity texture', () => {
    expect(getBlockDefinition(BlockId.EventChest).renderShape).toBe('chest');
    expect(isChestLikeBlock(BlockId.EventChest)).toBe(true);
    expect(isSharedWorldChestBlock(BlockId.EventChest)).toBe(true);
    expect(isSharedWorldChestBlock(BlockId.PortalChest)).toBe(false);
    expect(isUseTargetBlock(BlockId.EventChest)).toBe(true);
    expect(chestTextureKeyForBlock(BlockId.EventChest)).toBe(EVENT_CHEST_TEXTURE_KEY);
    expect(chestTextureKeyForBlock(BlockId.Chest)).toBe(CHEST_TEXTURE_KEY);
    expect(chestTextureKeyForBlock(BlockId.PortalChest)).toBe(PORTAL_CHEST_TEXTURE_KEY);
    expect(isChestEntityTextureKey(EVENT_CHEST_TEXTURE_KEY)).toBe(true);
    expect(itemHeldMeshKind('event_chest')).toBe('special_model');
    expect(itemIconDescriptor('event_chest')).toEqual({ kind: 'special_preview', category: 'chest' });
    expect(CONTAINER_STRINGS.eventChest).toBe('Ивентовый сундук');
    expect(resolveUseIntent({ hit: { block: BlockId.EventChest, distance: 2 } })).toBe('open-chest');
  });

  it('does not emit cube faces and uses inset collision', () => {
    const world = new VoxelWorld('event-chest-mesh');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    writeBlock(world, 3, 10, 4, BlockId.EventChest);
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.chests).toEqual([{ x: 3, y: 10, z: 4 }]);
    expect(meshed.faces).toBe(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
    expect(blockCollisionBoxes({ getBlock: () => BlockId.EventChest, getBlockState: () => undefined }, 3, 10, 4)[0]?.maxY).toBeCloseTo(10 + 14 / 16);
  });
});
