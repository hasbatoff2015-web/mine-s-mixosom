import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  createSelectionGeometry,
  selectionBoxesForBlock,
  selectionShapeKey,
  torchEndpoints,
} from '../src/rendering/specialBlockGeometry';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import { composeWorldLight } from '../src/rendering/worldLighting';
import { recomputeChunkSky, seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function refreshLight(world: VoxelWorld, x: number, z: number): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  recomputeChunkSky(world, chunk);
  seedChunkBlockLight(world, chunk);
}

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
}

function litVertex(geometry: THREE.BufferGeometry, index: number): [number, number, number] {
  const color = geometry.getAttribute('color');
  const [r, g, b] = composeWorldLight(
    geometry.getAttribute('skyLight').getX(index),
    geometry.getAttribute('blockLight').getX(index),
    geometry.getAttribute('emissionLight').getX(index),
    geometry.getAttribute('faceShade').getX(index),
  );
  return [color.getX(index) * r, color.getY(index) * g, color.getZ(index) * b];
}

function faceLitColors(
  geometry: THREE.BufferGeometry,
  predicate: (nx: number, ny: number, nz: number) => boolean,
): [number, number, number][] {
  const normal = geometry.getAttribute('normal');
  const colors: [number, number, number][] = [];
  for (let index = 0; index < normal.count; index += 1) {
    if (predicate(normal.getX(index), normal.getY(index), normal.getZ(index))) {
      colors.push(litVertex(geometry, index));
    }
  }
  return colors;
}

function boxSize(box: { size: readonly [number, number, number] }): [number, number, number] {
  return [...box.size].sort((a, b) => a - b) as [number, number, number];
}

describe('torch lighting, orientation and selection', () => {
  it('propagates torch block light through air and stops at occluding stone', () => {
    const world = new VoxelWorld('torch-flood');
    for (let x = 4; x <= 10; x += 1) {
      for (let y = 38; y <= 44; y += 1) writeBlock(world, x, y, 4, BlockId.Air);
    }
    writeBlock(world, 7, 40, 4, BlockId.Stone);
    refreshLight(world, 4, 4);
    world.setBlock(4, 40, 4, BlockId.Torch);
    expect(world.blockLightAt(4, 40, 4)).toBe(14);
    expect(world.blockLightAt(5, 40, 4)).toBeGreaterThanOrEqual(13);
    expect(world.blockLightAt(6, 40, 4)).toBeGreaterThan(world.blockLightAt(8, 40, 4));
    expect(world.blockLightAt(7, 40, 4)).toBe(0);
  });

  it('lights downward cube faces from adjacent torch block light instead of leaving them black', () => {
    const world = new VoxelWorld('bottom-face-light');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    for (let x = 4; x <= 8; x += 1) {
      for (let z = 4; z <= 8; z += 1) {
        writeBlock(world, x, 38, z, BlockId.Sandstone);
        writeBlock(world, x, 42, z, BlockId.Sandstone);
        for (let y = 39; y <= 41; y += 1) writeBlock(world, x, y, z, BlockId.Air);
      }
    }
    for (let y = 38; y <= 42; y += 1) {
      writeBlock(world, 4, y, 4, BlockId.Sandstone);
      writeBlock(world, 8, y, 8, BlockId.Sandstone);
    }
    writeBlock(world, 6, 40, 6, BlockId.Torch);
    refreshLight(world, 6, 6);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const bottoms = faceLitColors(meshed.opaque, (_x, y) => y < -0.9);
    expect(bottoms.length).toBeGreaterThan(0);
    const brightest = bottoms.reduce((max, color) => Math.max(max, (color[0] + color[1] + color[2]) / 3), 0);
    expect(brightest).toBeGreaterThan(0.2);
    const warm = bottoms.find((color) => color[0] > color[2] + 0.05);
    expect(warm).toBeDefined();
    disposeMeshed(meshed);
  });

  it('keeps unlit cave bottoms dark without raising a global ambient floor', () => {
    const world = new VoxelWorld('dark-cave');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Stone);
    writeBlock(world, 6, 40, 6, BlockId.Air);
    writeBlock(world, 6, 41, 6, BlockId.Air);
    refreshLight(world, 6, 6);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const bottoms = faceLitColors(meshed.opaque, (_x, y) => y < -0.9);
    expect(bottoms.length).toBeGreaterThan(0);
    for (const color of bottoms) {
      const luminance = (color[0] + color[1] + color[2]) / 3;
      expect(luminance).toBeLessThan(0.12);
      expect(luminance).toBeGreaterThan(0);
    }
    disposeMeshed(meshed);
  });

  it('tints torch block light warm orange without tinting pure sky light', () => {
    const sky = composeWorldLight(1, 0, 0, 1);
    expect(sky[0]).toBeCloseTo(sky[1], 5);
    expect(sky[1]).toBeCloseTo(sky[2], 5);
    const torch = composeWorldLight(0, 1, 0, 1);
    expect(torch[0]).toBeGreaterThan(torch[1]);
    expect(torch[1]).toBeGreaterThan(torch[2]);
    expect(torch[0] - torch[2]).toBeGreaterThan(0.3);
  });

  it('orients wall torches with the wooden base against the wall for all four facings', () => {
    const cases = [
      { facing: 'east' as const, towardWall: (base: THREE.Vector3, flame: THREE.Vector3) => flame.x > base.x && base.x < 0.5 },
      { facing: 'west' as const, towardWall: (base: THREE.Vector3, flame: THREE.Vector3) => flame.x < base.x && base.x > 0.5 },
      { facing: 'south' as const, towardWall: (base: THREE.Vector3, flame: THREE.Vector3) => flame.z > base.z && base.z < 0.5 },
      { facing: 'north' as const, towardWall: (base: THREE.Vector3, flame: THREE.Vector3) => flame.z < base.z && base.z > 0.5 },
    ];
    for (const test of cases) {
      const { base, flame } = torchEndpoints(0, 0, 0, 'wall', test.facing);
      expect(flame.y, test.facing).toBeGreaterThan(base.y);
      expect(test.towardWall(base, flame), test.facing).toBe(true);
    }
    const floor = torchEndpoints(0, 0, 0, 'floor', 'north');
    expect(floor.flame.y).toBeGreaterThan(floor.base.y);
    expect(floor.flame.x).toBeCloseTo(floor.base.x, 5);
    expect(floor.flame.z).toBeCloseTo(floor.base.z, 5);
  });

  it('builds selection boxes that match special geometry instead of a full voxel cube', () => {
    const cube = selectionBoxesForBlock({ renderShape: 'cube' });
    expect(cube).toHaveLength(1);
    expect(cube[0]!.size[0]).toBeCloseTo(1.008);

    const torch = selectionBoxesForBlock({ renderShape: 'torch' }, { attachment: 'wall', facing: 'east' });
    expect(torch).toHaveLength(1);
    expect(Math.max(...torch[0]!.size)).toBeLessThan(0.9);
    expect(Math.min(...torch[0]!.size)).toBeLessThan(0.2);

    const button = selectionBoxesForBlock({ renderShape: 'button' }, { attachment: 'wall', facing: 'south' });
    expect(Math.max(...button[0]!.size)).toBeLessThan(0.5);

    const lever = selectionBoxesForBlock({ renderShape: 'lever' }, { attachment: 'floor', facing: 'north', powered: false });
    expect(lever).toHaveLength(2);

    const plate = selectionBoxesForBlock({ renderShape: 'pressure_plate' });
    expect(plate[0]!.size[1]).toBeLessThan(0.1);

    const door = selectionBoxesForBlock({ renderShape: 'door' }, { facing: 'south', open: false });
    expect(boxSize(door[0]!)[0]).toBeCloseTo(3 / 16);

    const wire = selectionBoxesForBlock({ renderShape: 'wire' });
    expect(wire[0]!.size[1]).toBeLessThan(0.1);
  });

  it('caches distinct selection keys for cube vs torch orientation and reuses geometry', () => {
    expect(selectionShapeKey({ renderShape: 'cube' }, undefined))
      .not.toBe(selectionShapeKey({ renderShape: 'torch' }, { attachment: 'wall', facing: 'east' }));
    expect(selectionShapeKey({ renderShape: 'torch' }, { attachment: 'wall', facing: 'east' }))
      .not.toBe(selectionShapeKey({ renderShape: 'torch' }, { attachment: 'wall', facing: 'west' }));
    const geometry = createSelectionGeometry(selectionBoxesForBlock({ renderShape: 'torch' }, { attachment: 'floor' }));
    expect(geometry.getAttribute('position').count).toBeGreaterThan(8);
    geometry.dispose();
  });

  it('applies shape-aware outlines on the existing WorldRenderer selection mesh', () => {
    const world = new VoxelWorld('selection-target');
    const chunk = world.getChunk(0, 0)!;
    chunk.blocks.fill(BlockId.Air);
    writeBlock(world, 5, 40, 5, BlockId.Torch);
    world.setBlockState(5, 40, 5, { attachment: 'wall', facing: 'east' });
    const renderer = new WorldRenderer(world, atlasStub, (x, y, z) => world.getBlockState(x, y, z));
    renderer.setTarget({ x: 5, y: 40, z: 5, block: BlockId.Torch, distance: 1, normal: new THREE.Vector3(1, 0, 0) });
    expect(renderer.selection.visible).toBe(true);
    expect(renderer.selection.position.x).toBe(5);
    renderer.selection.geometry.computeBoundingBox();
    const size = renderer.selection.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.95);
    renderer.setTarget(undefined);
    expect(renderer.selection.visible).toBe(false);
    renderer.dispose();
  });

  it('keeps torch and stone-button special shapes in the registry', () => {
    expect(getBlockDefinition(BlockId.Torch).renderShape).toBe('torch');
    expect(getBlockDefinition(BlockId.RedstoneTorch).renderShape).toBe('torch');
    expect(getBlockDefinition(BlockId.StoneButton).renderShape).toBe('button');
    expect(getBlockDefinition(BlockId.Lever).renderShape).toBe('lever');
  });
});
