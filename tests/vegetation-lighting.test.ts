import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, blockLightingMode, getBlockDefinition } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { ChunkMesher, bakedVertexLight, biomeGrassTint } from '../src/rendering/ChunkMesher';
import { composeWorldLight } from '../src/rendering/worldLighting';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { WorldRenderer } from '../src/rendering/WorldRenderer';
import { recomputeChunkSky, seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  texture: new THREE.Texture(),
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

function emptyChunk(world: VoxelWorld) {
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  return chunk;
}

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

function plantColor(geometry: THREE.BufferGeometry, x: number, z: number): [number, number, number] {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index);
    const pz = position.getZ(index);
    if (px >= x && px <= x + 1 && pz >= z && pz <= z + 1) {
      return litVertex(geometry, index);
    }
  }
  throw new Error(`No vegetation vertex in cell ${x},${z}`);
}

function plantTint(geometry: THREE.BufferGeometry, x: number, z: number): [number, number, number] {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index);
    const pz = position.getZ(index);
    if (px >= x && px <= x + 1 && pz >= z && pz <= z + 1) {
      return [color.getX(index), color.getY(index), color.getZ(index)];
    }
  }
  throw new Error(`No vegetation vertex in cell ${x},${z}`);
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

function topFaceColor(geometry: THREE.BufferGeometry): [number, number, number] {
  const normal = geometry.getAttribute('normal');
  for (let index = 0; index < normal.count; index += 1) {
    if (normal.getY(index) > 0.99) return litVertex(geometry, index);
  }
  throw new Error('No upward cube face in opaque mesh');
}

describe('vegetation lighting profile', () => {
  it('keeps a min sunlight factor and prefers nearby torch block light', () => {
    expect(bakedVertexLight(1, 0, 0, 1)).toBeCloseTo(0.92, 5);
    expect(bakedVertexLight(0, 0, 0, 1)).toBeCloseTo(0.09, 5);
    const torch = composeWorldLight(0, 14 / 15, 0, 1);
    expect(torch[0]).toBeGreaterThan(torch[1]);
    expect(torch[1]).toBeGreaterThan(torch[2]);
    expect(bakedVertexLight(0, 14 / 15, 0, 1)).toBeGreaterThan(bakedVertexLight(0, 0, 0, 1));
  });

  it('defaults cross plants to the vegetation lighting profile without per-name checks', () => {
    expect(blockLightingMode(getBlockDefinition(BlockId.TallGrass))).toBe('vegetation');
    expect(blockLightingMode(getBlockDefinition(BlockId.Poppy))).toBe('vegetation');
    expect(blockLightingMode(getBlockDefinition(BlockId.OakLeaves))).toBe('standard');
    expect(blockLightingMode(getBlockDefinition(BlockId.GrassBlock))).toBe('standard');
    expect(blockLightingMode({ renderShape: 'cross' })).toBe('vegetation');
  });

  it('tints tall grass and fern with the grass biome color and leaves flowers untouched', () => {
    expect(getBlockDefinition(BlockId.TallGrass)).toMatchObject({
      lightingMode: 'vegetation', biomeTint: 'grass', renderLayer: 'cutout',
    });
    expect(getBlockDefinition(BlockId.Fern).biomeTint).toBe('grass');
    expect(getBlockDefinition(BlockId.Dandelion).lightingMode).toBe('vegetation');
    expect(getBlockDefinition(BlockId.Dandelion).biomeTint).toBeUndefined();
    expect(biomeGrassTint(0)[1]).toBeGreaterThan(biomeGrassTint(0)[0]);
  });

  it('writes two-sided cross plants into the vegetation layer with upward lighting normals', () => {
    const world = new VoxelWorld('veg-normals');
    const chunk = emptyChunk(world);
    writeBlock(world, 8, 40, 8, BlockId.GrassBlock);
    writeBlock(world, 8, 41, 8, BlockId.TallGrass);
    refreshLight(world, 8, 8);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const positions = meshed.vegetation.getAttribute('position');
    const normals = meshed.vegetation.getAttribute('normal');
    expect(positions.count).toBe(16);
    expect(meshed.vegetation.getIndex()!.count).toBe(24);
    for (let index = 0; index < normals.count; index += 1) {
      expect(normals.getX(index)).toBeCloseTo(0, 5);
      expect(normals.getY(index)).toBeCloseTo(1, 5);
      expect(normals.getZ(index)).toBeCloseTo(0, 5);
    }
    expect(meshed.cutout.getAttribute('position').count).toBe(0);
    disposeMeshed(meshed);
  });

  it('matches tall-grass vertex color to the grass-top lighting profile', () => {
    const world = new VoxelWorld('veg-grass-match');
    const chunk = emptyChunk(world);
    writeBlock(world, 8, 40, 8, BlockId.GrassBlock);
    writeBlock(world, 8, 41, 8, BlockId.TallGrass);
    refreshLight(world, 8, 8);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const grassTop = topFaceColor(meshed.opaque);
    const plant = plantColor(meshed.vegetation, 8, 8);
    expect(plant[0]).toBeCloseTo(grassTop[0], 4);
    expect(plant[1]).toBeCloseTo(grassTop[1], 4);
    expect(plant[2]).toBeCloseTo(grassTop[2], 4);
    expect(plant[1]).toBeGreaterThan(plant[0]);
    disposeMeshed(meshed);
  });

  it('does not apply grass biome tint to colorful flowers', () => {
    const world = new VoxelWorld('veg-flower');
    const chunk = emptyChunk(world);
    writeBlock(world, 7, 40, 7, BlockId.GrassBlock);
    writeBlock(world, 7, 41, 7, BlockId.TallGrass);
    writeBlock(world, 8, 40, 8, BlockId.GrassBlock);
    writeBlock(world, 8, 41, 8, BlockId.Dandelion);
    refreshLight(world, 7, 7);
    refreshLight(world, 8, 8);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const grassPlant = plantTint(meshed.vegetation, 7, 7);
    const flower = plantTint(meshed.vegetation, 8, 8);
    expect(flower[0]).toBeCloseTo(flower[1], 4);
    expect(flower[1]).toBeCloseTo(flower[2], 4);
    expect(flower[0]).toBeGreaterThan(grassPlant[0]);
    disposeMeshed(meshed);
  });

  it('keeps leaves on the shared DoubleSide cutout path', () => {
    const world = new VoxelWorld('veg-leaves');
    const chunk = emptyChunk(world);
    writeBlock(world, 5, 50, 5, BlockId.OakLeaves);
    refreshLight(world, 5, 5);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(meshed.vegetation.getAttribute('position').count).toBe(0);
    expect(meshed.cutout.getAttribute('position').count).toBeGreaterThan(0);
    const renderer = new WorldRenderer(world, atlasStub);
    expect(renderer.cutoutSide).toBe(THREE.DoubleSide);
    expect(renderer.vegetationSide).toBe(THREE.FrontSide);
    renderer.dispose();
    disposeMeshed(meshed);
  });

  it('raises plant vertex light from torch block light when sky is occluded', () => {
    const world = new VoxelWorld('veg-torch');
    const chunk = emptyChunk(world);
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) writeBlock(world, x, 50, z, BlockId.Stone);
    }
    writeBlock(world, 5, 40, 5, BlockId.TallGrass);
    writeBlock(world, 12, 40, 5, BlockId.TallGrass);
    writeBlock(world, 6, 40, 5, BlockId.Torch);
    refreshLight(world, 5, 5);

    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    const nearTorch = plantColor(meshed.vegetation, 5, 5);
    const farPlant = plantColor(meshed.vegetation, 12, 5);
    expect(world.blockLightAt(5, 40, 5)).toBeGreaterThan(world.blockLightAt(12, 40, 5));
    expect(nearTorch[1]).toBeGreaterThan(farPlant[1]);
    disposeMeshed(meshed);
  });
});
