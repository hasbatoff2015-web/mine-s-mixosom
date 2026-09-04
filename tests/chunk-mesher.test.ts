import { describe, expect, it, vi } from 'vitest';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
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
});
