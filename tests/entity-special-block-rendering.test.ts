import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
  RAIL_CORNER_UV,
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

function decodePngRgba(bytes: Buffer): { width: number; height: number; data: Buffer } {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (bitDepth !== 8 || bytes[28] !== 0) throw new Error('unsupported png');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`unsupported png color type ${colorType}`);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const data = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] ?? 0 : 0;
      const up = prev[x] ?? 0;
      const ul = x >= channels ? prev[x - channels] ?? 0 : 0;
      const p = left + up - ul;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - ul);
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? (left + up) >> 1
              : pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      row[x] = ((row[x] ?? 0) + predictor) & 255;
    }
    row.copy(prev);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (channels === 4) {
        data[i] = row[x * 4]!; data[i + 1] = row[x * 4 + 1]!; data[i + 2] = row[x * 4 + 2]!; data[i + 3] = row[x * 4 + 3]!;
      } else if (channels === 3) {
        data[i] = row[x * 3]!; data[i + 1] = row[x * 3 + 1]!; data[i + 2] = row[x * 3 + 2]!; data[i + 3] = 255;
      } else if (channels === 2) {
        data[i] = row[x * 2]!; data[i + 1] = row[x * 2]!; data[i + 2] = row[x * 2]!; data[i + 3] = row[x * 2 + 1]!;
      } else {
        data[i] = row[x]!; data[i + 1] = row[x]!; data[i + 2] = row[x]!; data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function opaqueOnEdge(
  image: { width: number; height: number; data: Buffer },
  edge: 'top' | 'right' | 'bottom' | 'left',
): number {
  const strip = 4;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const onEdge = edge === 'top' ? y < strip
        : edge === 'bottom' ? y >= image.height - strip
          : edge === 'left' ? x < strip
            : x >= image.width - strip;
      if (!onEdge) continue;
      const i = (y * image.width + x) * 4;
      const alpha = image.data[i + 3] ?? 0;
      const luma = ((image.data[i] ?? 0) + (image.data[i + 1] ?? 0) + (image.data[i + 2] ?? 0)) / 3;
      if (alpha > 48 && luma > 24) count += 1;
    }
  }
  return count;
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

  it('maps rail_corner.png so south+east is identity and the other three corners flip that L', () => {
    expect(railRenderQuads('south_east')[0]?.uv).toEqual(RAIL_CORNER_UV.south_east);
    expect(railRenderQuads('south_west')[0]?.uv).toEqual(RAIL_CORNER_UV.south_west);
    expect(railRenderQuads('north_east')[0]?.uv).toEqual(RAIL_CORNER_UV.north_east);
    expect(railRenderQuads('north_west')[0]?.uv).toEqual(RAIL_CORNER_UV.north_west);
    expect(RAIL_CORNER_UV.south_east).toEqual([0, 0, 1, 1]);
    expect(RAIL_CORNER_UV.south_west).toEqual([1, 0, 0, 1]);
    expect(RAIL_CORNER_UV.north_east).toEqual([0, 1, 1, 0]);
    expect(RAIL_CORNER_UV.north_west).toEqual([1, 1, 0, 0]);
  });

  it('proves raw rail_corner.png is authored south+east (image bottom+right), so identity UV is south_east', () => {
    const image = decodePngRgba(readFileSync(new URL('../public/textures/block/rail_corner.png', import.meta.url)));
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);
    const top = opaqueOnEdge(image, 'top');
    const right = opaqueOnEdge(image, 'right');
    const bottom = opaqueOnEdge(image, 'bottom');
    const left = opaqueOnEdge(image, 'left');
    expect(bottom).toBeGreaterThan(top * 2 + 8);
    expect(right).toBeGreaterThan(left * 2 + 8);
    expect(railRenderQuads('south_east')[0]?.uv).toEqual([0, 0, 1, 1]);
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
