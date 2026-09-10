import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, type BlockAttachment, type HorizontalFacing, type RailShape } from '../src/blocks';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import { railAt } from '../src/entities/railPath';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import {
  LANTERN_BODY_END_UV,
  LANTERN_BODY_SIDE_UV,
  RAIL_SURFACE_EPSILON,
  TORCH_BOTTOM_UV,
  TORCH_SIDE_UV,
  TORCH_TOP_UV,
  lanternHangerPlanes,
  lanternMeshCuboids,
  railRenderQuads,
} from '../src/rendering/specialBlockGeometry';
import type { TextureAtlas } from '../src/rendering/TextureAtlas';
import { VoxelWorld } from '../src/world/World';

const RAIL_SHAPES: readonly RailShape[] = [
  'north_south', 'east_west',
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
  'north_east', 'north_west', 'south_east', 'south_west',
];

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function disposeMeshed(meshed: ReturnType<ChunkMesher['build']>): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

function pngSize(path: URL): readonly [number, number] {
  const png = readFileSync(path);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('torch authored face UVs', () => {
  it('keeps the long shaft strip on sides and square authored caps on top and bottom', () => {
    expect(TORCH_SIDE_UV).toEqual([14 / 32, 0, 18 / 32, 20 / 32]);
    expect(TORCH_TOP_UV).toEqual([14 / 32, 16 / 32, 18 / 32, 20 / 32]);
    expect(TORCH_BOTTOM_UV).toEqual([14 / 32, 0, 18 / 32, 4 / 32]);
  });

  it('uses the same face policy for normal/redstone and floor/four wall transforms', () => {
    const attachments: readonly [BlockAttachment, HorizontalFacing][] = [
      ['floor', 'north'], ['wall', 'north'], ['wall', 'south'], ['wall', 'east'], ['wall', 'west'],
    ];
    for (const block of [BlockId.Torch, BlockId.RedstoneTorch]) {
      for (const [attachment, facing] of attachments) {
        const world = new VoxelWorld(`torch-uv-${block}-${attachment}-${facing}`);
        const chunk = world.getChunk(0, 0)!;
        chunk.blocks.fill(BlockId.Air);
        writeBlock(world, 4, 40, 4, block);
        world.setBlockState(4, 40, 4, { attachment, facing });
        const atlas = { tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as TextureAtlas;
        const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
        const uv = meshed.cutout.getAttribute('uv');
        expect(uv.count).toBe(24);
        const vSpans: number[] = [];
        for (let vertex = 0; vertex < uv.count; vertex += 4) {
          const values = [uv.getY(vertex), uv.getY(vertex + 1), uv.getY(vertex + 2), uv.getY(vertex + 3)];
          vSpans.push(Math.max(...values) - Math.min(...values));
        }
        expect(vSpans.filter((span) => Math.abs(span - 20 / 32) < 1e-6)).toHaveLength(4);
        expect(vSpans.filter((span) => Math.abs(span - 4 / 32) < 1e-6)).toHaveLength(2);
        disposeMeshed(meshed);
      }
    }
  });
});

describe('lantern authored model', () => {
  it('uses the authored body/cap cuboids and distinct standing/hanging hanger planes', () => {
    const standing = lanternMeshCuboids({ attachment: 'floor' });
    const hanging = lanternMeshCuboids({ attachment: 'ceiling' });
    expect(standing).toHaveLength(2);
    expect(standing[0]).toMatchObject({
      box: { minY: 0, maxY: 7 / 16 },
      uvDown: LANTERN_BODY_END_UV,
      uvUp: LANTERN_BODY_END_UV,
      uvSide: LANTERN_BODY_SIDE_UV,
    });
    expect(standing[1]?.box).toMatchObject({ minY: 7 / 16, maxY: 9 / 16 });
    expect(hanging[0]?.box).toMatchObject({ minY: 1 / 16, maxY: 8 / 16 });
    expect(hanging[1]?.box).toMatchObject({ minY: 8 / 16, maxY: 10 / 16 });
    expect(Math.max(...lanternHangerPlanes({ attachment: 'floor' }).flatMap((plane) => plane.corners.map((corner) => corner[1])))).toBe(11 / 16);
    expect(Math.max(...lanternHangerPlanes({ attachment: 'ceiling' }).flatMap((plane) => plane.corners.map((corner) => corner[1])))).toBe(1);
  });
});

describe('render-only rail surfaces', () => {
  it('covers all ten shapes with one thin plane and the curve texture on corners', () => {
    for (const shape of RAIL_SHAPES) {
      const planes = railRenderQuads(shape);
      expect(planes, shape).toHaveLength(1);
      expect(planes[0]?.corners, shape).toHaveLength(4);
      expect(planes[0]?.texture, shape).toBe(shape.includes('_') && !shape.startsWith('ascending_') && shape !== 'north_south' && shape !== 'east_west'
        ? 'corner'
        : 'straight');
      const ys = new Set(planes[0]!.corners.map((corner) => corner[1]));
      expect(ys.size, shape).toBe(shape.startsWith('ascending_') ? 2 : 1);
      expect(Math.min(...ys), shape).toBe(RAIL_SURFACE_EPSILON);
      if (shape.startsWith('ascending_')) expect(Math.max(...ys), shape).toBe(1 + RAIL_SURFACE_EPSILON);
    }
  });

  it('meshes every stored shape as exactly one double-sided surface and selects the corner asset', () => {
    for (const shape of RAIL_SHAPES) {
      const world = new VoxelWorld(`rail-render-${shape}`);
      const chunk = world.getChunk(0, 0)!;
      chunk.blocks.fill(BlockId.Air);
      writeBlock(world, 4, 40, 4, BlockId.Rail);
      world.setBlockState(4, 40, 4, { railShape: shape });
      const textureKeys: string[] = [];
      const atlas = {
        tile: (key: string) => {
          textureKeys.push(key);
          return { u0: 0, v0: 0, u1: 1, v1: 1 };
        },
      } as unknown as TextureAtlas;
      const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
      expect(meshed.cutout.getAttribute('position').count, shape).toBe(8);
      expect(textureKeys, shape).toContain(shape.includes('_') && !shape.startsWith('ascending_') && shape !== 'north_south' && shape !== 'east_west'
        ? 'block/rail_corner'
        : 'block/rail');
      disposeMeshed(meshed);
    }
  });

  it('uses live neighbors for minecart topology after a branch is broken', () => {
    const world = new VoxelWorld('rail-live-neighbors');
    world.getChunk(0, 0)!.blocks.fill(BlockId.Air);
    writeBlock(world, 5, 40, 5, BlockId.Rail);
    writeBlock(world, 5, 40, 4, BlockId.Rail);
    writeBlock(world, 6, 40, 5, BlockId.Rail);
    expect(railAt(world, 5, 40, 5)).toBe('north_east');
    writeBlock(world, 6, 40, 5, BlockId.Air);
    expect(railAt(world, 5, 40, 5)).toBe('north_south');
  });

  it('ships distinct authored straight and curved rail PNGs and keeps render code off collision boxes', () => {
    const straight = new URL('../public/textures/block/rail.png', import.meta.url);
    const corner = new URL('../public/textures/block/rail_corner.png', import.meta.url);
    expect(pngSize(straight)).toEqual([32, 32]);
    expect(pngSize(corner)).toEqual([32, 32]);
    expect(readFileSync(straight).equals(readFileSync(corner))).toBe(false);
    expect(getBlockDefinition(BlockId.Rail).textures.corner).toBe('block/rail_corner');
    const mesherSource = readFileSync(new URL('../src/rendering/ChunkMesher.ts', import.meta.url), 'utf8');
    const factorySource = readFileSync(new URL('../src/rendering/ItemVisualFactory.ts', import.meta.url), 'utf8');
    const importerSource = readFileSync(new URL('../scripts/import-assets.mjs', import.meta.url), 'utf8');
    expect(mesherSource).not.toContain('railLocalBoxes');
    expect(factorySource).not.toContain('railLocalBoxes');
    expect(importerSource).toContain("'blocks/rail_normal_turned.png': 'block/rail_corner.png'");
  });
});
