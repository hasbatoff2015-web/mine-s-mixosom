import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { RedstoneSystem } from '../src/redstone';
import { VoxelWorld } from '../src/world/World';

function place(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  expect(world.setBlock(x, y, z, block)).toBe(true);
}

describe('RedstoneSystem', () => {
  it('propagates 0..15 power through six-neighbour dust with attenuation', () => {
    const world = new VoxelWorld('redstone-line');
    const y = 76;
    place(world, 5, y, 5, BlockId.Lever);
    place(world, 6, y, 5, BlockId.RedstoneWire);
    place(world, 7, y, 5, BlockId.RedstoneWire);
    place(world, 8, y, 5, BlockId.RedstoneWire);
    const redstone = new RedstoneSystem(world);
    redstone.notifyBlockChanged(5, y, 5);

    expect(redstone.toggleLever(5, y, 5)).toBe(true);
    redstone.flushPropagation();
    expect(redstone.getPower(6, y, 5)).toBe(15);
    expect(redstone.getPower(7, y, 5)).toBe(14);
    expect(redstone.getPower(8, y, 5)).toBe(13);

    expect(redstone.toggleLever(5, y, 5)).toBe(false);
    redstone.flushPropagation();
    expect(redstone.getPower(6, y, 5)).toBe(0);
    expect(redstone.getPower(8, y, 5)).toBe(0);
    redstone.dispose();
  });

  it('expires button pulses and exposes explicit pressure-plate occupancy', () => {
    const world = new VoxelWorld('timed-sources');
    const y = 76;
    place(world, 5, y, 5, BlockId.StoneButton);
    place(world, 6, y, 5, BlockId.RedstoneWire);
    place(world, 9, y, 5, BlockId.OakPressurePlate);
    const redstone = new RedstoneSystem(world);

    expect(redstone.pressButton(5, y, 5, 0.2)).toBe(true);
    redstone.flushPropagation();
    expect(redstone.getPower(6, y, 5)).toBe(15);
    redstone.update(0.1);
    expect(redstone.getSource(5, y, 5)?.active).toBe(true);
    redstone.update(0.11);
    redstone.flushPropagation();
    expect(redstone.getSource(5, y, 5)?.active).toBe(false);
    expect(redstone.getPower(6, y, 5)).toBe(0);

    expect(redstone.updatePressurePlateOccupancy(9, y, 5, [
      new THREE.Vector3(9.5, y + 0.1, 5.5),
    ])).toBe(true);
    expect(redstone.getPower(9, y, 5)).toBe(15);
    expect(redstone.setPressurePlateOccupied(9, y, 5, false)).toBe(true);
    expect(redstone.getPower(9, y, 5)).toBe(0);
    redstone.dispose();
  });

  it('automatically primes powered TNT, runs a four-second fuse and emits an event', () => {
    const world = new VoxelWorld('powered-tnt');
    const scene = new THREE.Scene();
    const y = 76;
    place(world, 5, y, 5, BlockId.Lever);
    place(world, 6, y, 5, BlockId.Tnt);
    const redstone = new RedstoneSystem(world, { root: scene });
    redstone.notifyBlockChanged(5, y, 5);

    redstone.toggleLever(5, y, 5);
    expect(world.getBlock(6, y, 5)).toBe(BlockId.Air);
    expect(redstone.primedTntCount).toBe(1);
    expect(scene.children).toHaveLength(1);
    for (let tick = 0; tick < 79; tick += 1) redstone.update(0.05);
    expect(redstone.consumeExplosionEvents()).toHaveLength(0);
    redstone.update(0.05);
    const explosions = redstone.consumeExplosionEvents();
    expect(explosions).toHaveLength(1);
    expect(explosions[0]?.power).toBe(4);
    expect(redstone.primedTntCount).toBe(0);
    expect(scene.children).toHaveLength(0);
    redstone.dispose();
  });

  it('round-trips powered sources and primed TNT without persisting derived wire power', () => {
    const world = new VoxelWorld('redstone-save');
    const y = 76;
    place(world, 5, y, 5, BlockId.Lever);
    place(world, 6, y, 5, BlockId.RedstoneWire);
    place(world, 10, y, 5, BlockId.Tnt);
    const original = new RedstoneSystem(world);
    original.toggleLever(5, y, 5);
    original.flushPropagation();
    original.primeTnt(10, y, 5);
    original.update(0.5);
    const saved = original.serialize();
    original.dispose();

    const restored = new RedstoneSystem(world);
    expect(restored.restore(saved)).toBe(2);
    restored.flushPropagation();
    expect(restored.getSource(5, y, 5)?.active).toBe(true);
    expect(restored.getPower(6, y, 5)).toBe(15);
    expect(restored.primedTnt[0]?.fuseSeconds).toBeCloseTo(3.5);
    restored.dispose();
  });

  it('bounds per-update propagation work', () => {
    const world = new VoxelWorld('bounded-redstone');
    const y = 76;
    place(world, 5, y, 5, BlockId.RedstoneTorch);
    for (let x = 6; x < 15; x += 1) place(world, x, y, 5, BlockId.RedstoneWire);
    const redstone = new RedstoneSystem(world, { maxPropagationStepsPerUpdate: 2 });
    redstone.notifyBlockChanged(5, y, 5);
    const stats = redstone.update(0.05);
    expect(stats.propagationSteps).toBeLessThanOrEqual(2);
    expect(stats.pendingPropagation).toBeGreaterThan(0);
    redstone.flushPropagation();
    expect(redstone.getPower(14, y, 5)).toBe(7);
    redstone.dispose();
  });
});
