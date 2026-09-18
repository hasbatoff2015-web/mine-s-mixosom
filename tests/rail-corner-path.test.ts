import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/blocks';
import { doorHingeFromPlacement, occupiedDoorFacing } from '../src/blocks/placement';
import { CHUNK_SIZE } from '../src/core/constants';
import { MinecartManager } from '../src/entities';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { VoxelWorld } from '../src/world/World';
import { signLocalBoxes } from '../src/world/blockGeometry';

function writeRail(world: VoxelWorld, x: number, y: number, z: number): void {
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  world.setBlock(x, y - 1, z, BlockId.Stone);
  world.setBlock(x, y, z, BlockId.Rail);
}

describe('rail corner pathing', () => {
  it('lets a minecart complete a four-corner loop without stalling', () => {
    const world = new VoxelWorld('rail-loop');
    const y = 41;
    writeRail(world, 5, y, 5);
    writeRail(world, 6, y, 5);
    writeRail(world, 6, y, 6);
    writeRail(world, 5, y, 6);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, y, 5)!;
    cart.alongSpeed = 4;
    const visited = new Set<string>();
    for (let tick = 0; tick < 80; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: 0 });
      expect(manager.isOnRail(cart), `tick ${tick}`).toBe(true);
      visited.add(`${Math.floor(cart.position.x)},${Math.floor(cart.position.z)}`);
    }
    expect(visited.has('5,5')).toBe(true);
    expect(visited.has('6,5')).toBe(true);
    expect(visited.has('6,6')).toBe(true);
    expect(visited.has('5,6')).toBe(true);
    manager.dispose();
  });
});

describe('door hinge occupancy', () => {
  it('opens around the outside-left hinge, not the handle', () => {
    expect(occupiedDoorFacing('south', true, 'left')).toBe('west');
    expect(occupiedDoorFacing('south', true, 'right')).toBe('east');
    expect(doorHingeFromPlacement('south', { x: 5.2, z: 5.9 }, 5, 5)).toBe('left');
    expect(doorHingeFromPlacement('south', { x: 5.8, z: 5.9 }, 5, 5)).toBe('right');
  });
});

describe('sign selection boxes', () => {
  it('keeps standing and wall outlines inside a thin board, not a near-full cube', () => {
    const standing = signLocalBoxes({ attachment: 'floor' });
    expect(standing).toHaveLength(2);
    expect(Math.max(...standing.map((box) => box.maxX - box.minX))).toBeLessThanOrEqual(1);
    expect(Math.max(...standing.map((box) => box.maxZ - box.minZ))).toBeLessThan(0.2);
    const wall = signLocalBoxes({ attachment: 'wall', facing: 'south' });
    expect(wall).toHaveLength(1);
    expect(wall[0]!.maxZ - wall[0]!.minZ).toBeCloseTo(2 / 16);
    expect(wall[0]!.minZ).toBe(0);
  });
});
