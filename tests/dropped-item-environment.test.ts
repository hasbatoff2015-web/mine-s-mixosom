import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  DROPPED_ITEM_MAX_HEALTH,
  DroppedItemManager,
  type DroppedItemRemovalReason,
  type SerializedDroppedItem,
} from '../src/entities';
import { VoxelWorld } from '../src/world/World';

function itemWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  for (let z = 0; z < 16; z += 1) {
    for (let x = 0; x < 16; x += 1) chunk.set(x, 20, z, BlockId.Stone);
  }
  return world;
}

function spawnAt(
  world: VoxelWorld,
  position = new THREE.Vector3(8.5, 21, 8.5),
  onRemove?: (reason: DroppedItemRemovalReason) => void,
): { manager: DroppedItemManager; id: string } {
  const manager = new DroppedItemManager(new THREE.Scene(), world, {
    despawnSeconds: 600,
    pickupDelaySeconds: 600,
    onRemove: (_entity, reason) => onRemove?.(reason),
  });
  const entity = manager.spawn({ itemId: 'cobblestone', count: 1 }, position);
  return { manager, id: entity.id };
}

describe('dropped-item fire and lava damage', () => {
  it('uses Java 1.9-style five health and burns in lava after two 20 TPS contacts', () => {
    const world = itemWorld('item-lava-health');
    world.setBlock(8, 21, 8, BlockId.Lava);
    const reasons: DroppedItemRemovalReason[] = [];
    const { manager, id } = spawnAt(world, undefined, (reason) => reasons.push(reason));

    manager.update(0.05);
    expect(manager.get(id)?.environmentHealth).toBe(1);
    manager.update(0.05);
    expect(manager.get(id)).toBeUndefined();
    expect(reasons).toEqual(['burned']);
  });

  it('takes one point per fire-contact tick and is removed on the fifth contact', () => {
    const world = itemWorld('item-fire-health');
    world.setBlock(8, 21, 8, BlockId.Fire);
    const { manager, id } = spawnAt(world);

    for (let tick = 0; tick < 4; tick += 1) manager.update(0.05);
    expect(manager.get(id)?.environmentHealth).toBe(1);
    manager.update(0.05);
    expect(manager.get(id)).toBeUndefined();
  });

  it('uses the item AABB instead of a single center-cell sample', () => {
    const world = itemWorld('item-lava-aabb');
    world.setBlock(8, 21, 8, BlockId.Lava);
    const { manager, id } = spawnAt(world, new THREE.Vector3(9.1, 21, 8.5));

    manager.update(0.1);
    expect(manager.get(id)).toBeUndefined();
  });

  it('does not damage or destroy items in water', () => {
    const world = itemWorld('item-water-safe');
    world.setBlock(8, 21, 8, BlockId.Water);
    const { manager, id } = spawnAt(world);

    for (let tick = 0; tick < 40; tick += 1) manager.update(0.05);
    expect(manager.get(id)?.environmentHealth).toBe(DROPPED_ITEM_MAX_HEALTH);
  });

  it('restores old entries without health and round-trips damaged health', () => {
    const world = itemWorld('item-health-save');
    const oldEntry: SerializedDroppedItem = {
      id: 'old-item',
      stack: { itemId: 'cobblestone', count: 1 },
      position: [8.5, 21, 8.5],
      velocity: [0, 0, 0],
      ageSeconds: 2,
      pickupDelaySeconds: 1,
    };
    const restored = new DroppedItemManager(new THREE.Scene(), world);
    expect(restored.restore([oldEntry])).toBe(1);
    expect(restored.get('old-item')?.environmentHealth).toBe(DROPPED_ITEM_MAX_HEALTH);

    world.setBlock(8, 21, 8, BlockId.Fire);
    restored.update(0.05);
    const serialized = restored.serialize();
    expect(serialized[0]?.environmentHealth).toBe(4);

    const roundTripped = new DroppedItemManager(new THREE.Scene(), world);
    expect(roundTripped.restore(serialized)).toBe(1);
    expect(roundTripped.get('old-item')?.environmentHealth).toBe(4);
  });
});
