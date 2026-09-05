import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { ChunkMesher, disposeMeshedChunk, type MeshedChunk } from '../src/rendering/ChunkMesher';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';

const atlasStub = {
  tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
} as unknown as TextureAtlas;

describe('ChunkMesher hot path', () => {
  it('reuses generated surface and biome column caches instead of resampling noise per face', () => {
    const world = new VoxelWorld('mesher-column-cache');
    const chunk = world.getChunk(0, 0)!;
    expect(chunk.generated).toBe(true);
    const columnAt = vi.spyOn(world.generator, 'columnAt');
    const meshed = new ChunkMesher(atlasStub).build(chunk, world);
    expect(columnAt).not.toHaveBeenCalled();
    expect(meshed.faces).toBeGreaterThan(0);
    expect(meshed.opaque.getAttribute('position').count).toBeGreaterThan(0);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
  });

  it('cheap vertex light keeps the same face count as full AO', () => {
    const world = new VoxelWorld('mesher-cheap-light');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    const mesher = new ChunkMesher(atlasStub);
    const full = mesher.build(chunk, world);
    const cheap = mesher.build(chunk, world, { cheapVertexLight: true });
    expect(cheap.faces).toBe(full.faces);
    expect(cheap.opaque.getAttribute('position').count).toBe(full.opaque.getAttribute('position').count);
    full.opaque.dispose();
    full.cutout.dispose();
    full.vegetation.dispose();
    full.translucent.dispose();
    full.water.dispose();
    full.fire.dispose();
    cheap.opaque.dispose();
    cheap.cutout.dispose();
    cheap.vegetation.dispose();
    cheap.translucent.dispose();
    cheap.water.dispose();
    cheap.fire.dispose();
  });

  it('neighborhood light cache keeps the same vertex count and sky samples as uncached AO', () => {
    const world = new VoxelWorld('mesher-light-cache');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    world.getChunk(1, 0);
    world.getChunk(-1, 0);
    world.getChunk(0, 1);
    world.getChunk(0, -1);
    const mesher = new ChunkMesher(atlasStub);
    const full = mesher.build(chunk, world, { vertexLight: 'full' });
    const cached = mesher.build(chunk, world, { vertexLight: 'full', neighborhoodLightCache: true });
    expect(cached.faces).toBe(full.faces);
    const fullSky = full.opaque.getAttribute('skyLight') as { array: ArrayLike<number> };
    const cachedSky = cached.opaque.getAttribute('skyLight') as { array: ArrayLike<number> };
    expect(cachedSky.array.length).toBe(fullSky.array.length);
    let mismatch = 0;
    for (let i = 0; i < fullSky.array.length; i += 1) {
      if (Math.abs(fullSky.array[i]! - cachedSky.array[i]!) > 1e-5) mismatch += 1;
    }
    expect(mismatch).toBe(0);
    full.opaque.dispose();
    full.cutout.dispose();
    full.vegetation.dispose();
    full.translucent.dispose();
    full.water.dispose();
    full.fire.dispose();
    cached.opaque.dispose();
    cached.cutout.dispose();
    cached.vegetation.dispose();
    cached.translucent.dispose();
    cached.water.dispose();
    cached.fire.dispose();
  });

  it('reuses typed emit buffers without changing vertex, index, AO, or light arrays', () => {
    const world = new VoxelWorld('mesher-typed-emit');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    world.getChunk(1, 0);
    world.getChunk(-1, 0);
    world.getChunk(0, 1);
    world.getChunk(0, -1);
    const mesher = new ChunkMesher(atlasStub);
    const first = mesher.build(chunk, world, { vertexLight: 'full', collectDetail: true });
    const firstProfile = { ...mesher.lastProfile };
    const second = mesher.build(chunk, world, { vertexLight: 'full', collectDetail: true });
    expect(second.faces).toBe(first.faces);
    expect(mesher.lastProfile.positionFloats).toBe(firstProfile.positionFloats);
    expect(mesher.lastProfile.indexCount).toBe(firstProfile.indexCount);
    expect(attributeMismatch(first, second)).toBe(0);
    disposeMeshedChunk(first);
    disposeMeshedChunk(second);
  });

  it('keeps slab and glass neighbors from occluding cube faces', () => {
    const world = new VoxelWorld('mesher-face-lut');
    const chunk = world.getChunk(0, 0)!;
    const y = Math.min(120, chunk.occupancyTop + 3);
    world.setBlock(4, y, 4, BlockId.Stone);
    const mesher = new ChunkMesher(atlasStub);
    const stoneOnly = mesher.build(world.getChunk(0, 0)!, world, { vertexLight: 'flat' });
    world.setBlock(5, y, 4, BlockId.OakSlab);
    const withSlab = mesher.build(world.getChunk(0, 0)!, world, { vertexLight: 'flat' });
    world.setBlock(5, y, 4, BlockId.Air);
    world.setBlock(3, y, 4, BlockId.Glass);
    const withGlass = mesher.build(world.getChunk(0, 0)!, world, { vertexLight: 'flat' });
    expect(withSlab.faces).toBeGreaterThan(stoneOnly.faces);
    expect(withGlass.faces).toBeGreaterThan(stoneOnly.faces);
    disposeMeshedChunk(stoneOnly);
    disposeMeshedChunk(withSlab);
    disposeMeshedChunk(withGlass);
  });

  it('budgeted Y slices emit the same geometry as a one-shot build', () => {
    const world = new VoxelWorld('mesher-sliced-build');
    const chunk = world.getChunk(0, 0)!;
    world.ensureChunkLighting(chunk);
    world.getChunk(1, 0);
    world.getChunk(-1, 0);
    world.getChunk(0, 1);
    world.getChunk(0, -1);
    const mesher = new ChunkMesher(atlasStub);
    const full = mesher.build(chunk, world, { vertexLight: 'full' });
    mesher.startBuild(chunk, world, { vertexLight: 'full' });
    let slices = 0;
    while (!mesher.pumpBuild(0)) slices += 1;
    expect(mesher.pumpBuild(0)).toBe(true);
    const sliced = mesher.takeBuild();
    expect(sliced).not.toBeNull();
    expect(slices).toBeGreaterThan(0);
    expect(sliced!.faces).toBe(full.faces);
    expect(attributeMismatch(full, sliced!)).toBe(0);
    disposeMeshedChunk(full);
    disposeMeshedChunk(sliced!);
  });
});

const LAYER_KEYS = ['opaque', 'cutout', 'vegetation', 'translucent', 'water', 'fire'] as const;

function attributeMismatch(a: MeshedChunk, b: MeshedChunk): number {
  let mismatch = 0;
  for (const key of LAYER_KEYS) {
    const ga = a[key];
    const gb = b[key];
    for (const attr of ['position', 'normal', 'color', 'uv', 'skyLight', 'blockLight', 'faceShade', 'emissionLight']) {
      const aa = ga.getAttribute(attr);
      const ba = gb.getAttribute(attr);
      if (!aa || !ba) {
        if (aa || ba) mismatch += 1;
        continue;
      }
      if (aa.count !== ba.count) {
        mismatch += Math.abs(aa.count - ba.count);
        continue;
      }
      const av = aa.array as ArrayLike<number>;
      const bv = ba.array as ArrayLike<number>;
      for (let i = 0; i < av.length; i += 1) {
        if (Math.abs(av[i]! - bv[i]!) > 1e-5) mismatch += 1;
      }
    }
    const ia = ga.getIndex();
    const ib = gb.getIndex();
    if (!ia || !ib) {
      if (ia || ib) mismatch += 1;
      continue;
    }
    if (ia.count !== ib.count) {
      mismatch += Math.abs(ia.count - ib.count);
      continue;
    }
    const av = ia.array as ArrayLike<number>;
    const bv = ib.array as ArrayLike<number>;
    for (let i = 0; i < av.length; i += 1) {
      if (av[i] !== bv[i]) mismatch += 1;
    }
  }
  return mismatch;
}
