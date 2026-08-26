import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PRIMED_TNT_TEXTURE_KEY, RedstoneSystem } from '../src/redstone';
import { ChunkMesher, leverHandleAngle } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';

function place(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  expect(world.setBlock(x, y, z, block)).toBe(true);
}

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function disposeMeshed(result: ReturnType<ChunkMesher['build']>): void {
  result.opaque.dispose();
  result.cutout.dispose();
  result.vegetation.dispose();
  result.translucent.dispose();
  result.water.dispose();
  result.fire.dispose();
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
    const primed = redstone.primedTnt[0]!;
    const material = primed.visual?.material;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    const meshMaterial = material as THREE.MeshBasicMaterial;
    expect(meshMaterial.map).toBeTruthy();
    expect(meshMaterial.map?.name).toBe(PRIMED_TNT_TEXTURE_KEY);
    const mapBefore = meshMaterial.map;
    for (let tick = 0; tick < 40; tick += 1) redstone.update(0.05);
    expect(meshMaterial.map).toBe(mapBefore);
    expect(meshMaterial.map?.name).toBe(PRIMED_TNT_TEXTURE_KEY);
    expect(meshMaterial.color.getHex()).not.toBe(0xc33b2e);
    for (let tick = 0; tick < 39; tick += 1) redstone.update(0.05);
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

  it('changes lever handle angle and round-trips attachment, facing and power', () => {
    const world = new VoxelWorld('oriented-lever');
    const y = 76;
    place(world, 5, y, 5, BlockId.Lever);
    const original = new RedstoneSystem(world);
    expect(original.setLeverOrientation(5, y, 5, 'wall', 'east')).toBe(true);
    expect(original.toggleLever(5, y, 5)).toBe(true);
    expect(leverHandleAngle(true)).not.toBe(leverHandleAngle(false));
    expect(leverHandleAngle(true)).toBeLessThan(0);

    const saved = original.serialize();
    expect(saved.version).toBe(2);
    original.dispose();

    const restored = new RedstoneSystem(world);
    expect(restored.restore(saved)).toBe(1);
    expect(restored.getSource(5, y, 5)).toMatchObject({
      kind: 'lever', active: true, attachment: 'wall', facing: 'east',
    });
    expect(restored.getBlockRenderState(5, y, 5)).toMatchObject({
      powered: true, attachment: 'wall', facing: 'east',
    });
    restored.dispose();
  });

  it('builds bounded non-cube geometry for every lever attachment and facing in both states', () => {
    const world = new VoxelWorld('lever-geometry');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    chunk.set(8, 76, 8, BlockId.Lever);
    const attachments = ['floor', 'wall', 'ceiling'] as const;
    const facings = ['north', 'south', 'east', 'west'] as const;

    for (const attachment of attachments) {
      for (const facing of facings) {
        const centroids: number[] = [];
        for (const powered of [false, true]) {
          const meshed = new ChunkMesher(atlasStub, () => ({ attachment, facing, powered })).build(chunk, world);
          const positions = meshed.cutout.getAttribute('position');
          expect(positions.count, `${attachment}/${facing}/${powered}`).toBe(48);
          const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
          expect(bounds.min.x).toBeGreaterThanOrEqual(7.95);
          expect(bounds.max.x).toBeLessThanOrEqual(9.05);
          expect(bounds.min.y).toBeGreaterThanOrEqual(75.95);
          expect(bounds.max.y).toBeLessThanOrEqual(77.05);
          expect(bounds.min.z).toBeGreaterThanOrEqual(7.95);
          expect(bounds.max.z).toBeLessThanOrEqual(9.05);
          let sum = 0;
          for (let index = 24; index < positions.count; index += 1) {
            sum += positions.getX(index) + positions.getY(index) + positions.getZ(index);
          }
          centroids.push(sum);
          disposeMeshed(meshed);
        }
        expect(centroids[0], `${attachment}/${facing} handle state`).not.toBeCloseTo(centroids[1]!, 5);
      }
    }
  });

  it('restores version-one levers with stable default orientation', () => {
    const world = new VoxelWorld('legacy-lever');
    const y = 76;
    place(world, 5, y, 5, BlockId.Lever);
    const restored = new RedstoneSystem(world);
    expect(restored.restore({
      version: 1,
      sources: [{ kind: 'lever', position: [5, y, 5], active: false }],
      primedTnt: [],
    })).toBe(1);
    expect(restored.getSource(5, y, 5)).toMatchObject({
      attachment: 'floor', facing: 'north',
    });
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
