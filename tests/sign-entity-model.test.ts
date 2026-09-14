import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { ChunkMesher } from '../src/rendering/ChunkMesher';
import { SIGN_SHEET_KEY, type TextureAtlas } from '../src/rendering/TextureAtlas';
import { signVisualParts } from '../src/rendering/specialBlockGeometry';
import { VoxelWorld } from '../src/world/World';

const atlas = { tile: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as TextureAtlas;

function signMesh(state: { attachment: 'floor' | 'wall'; facing?: 'north' | 'east' | 'south' | 'west'; signRotation?: number }) {
  const world = new VoxelWorld('sign-model');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  chunk.set(8, 40, 8, BlockId.OakSign);
  world.setBlockState(8, 40, 8, state);
  const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
  meshed.cutout.computeBoundingBox();
  const bounds = meshed.cutout.boundingBox!.clone();
  const vertices = meshed.cutout.getAttribute('position').count;
  for (const value of Object.values(meshed)) if (value instanceof THREE.BufferGeometry) value.dispose();
  return { bounds, vertices };
}

describe('sign entity model', () => {
  it('maps distinct board faces and the whole standing post to ModelSign source texels', () => {
    const standing = signVisualParts('floor');
    const wall = signVisualParts('wall');
    expect(standing).toHaveLength(2);
    expect(wall).toHaveLength(1);
    expect(standing.every((part) => part.texture === SIGN_SHEET_KEY)).toBe(true);
    expect(wall[0]!.faces).toBe(standing[0]!.faces);
    const board = standing[0]!;
    expect(board.faces.south?.uv).toEqual([2 / 64, 1 - 14 / 32, 26 / 64, 1 - 2 / 32]);
    expect(board.faces.north?.uv).toEqual([28 / 64, 1 - 14 / 32, 52 / 64, 1 - 2 / 32]);
    expect(board.faces.up?.uv).toEqual([2 / 64, 1 - 2 / 32, 26 / 64, 1]);
    expect(board.faces.west?.uv).not.toEqual(board.faces.east?.uv);
    expect(standing[1]!.faces.south?.uv).toEqual([2 / 64, 1 - 30 / 32, 4 / 64, 1 - 16 / 32]);
    expect(standing[1]!.faces.west?.uv).not.toEqual(board.faces.west?.uv);
    expect(board.size[0] / board.size[1]).toBeCloseTo(24 / 12);
    expect(standing[1]!.size[1] / board.size[1]).toBeCloseTo(14 / 12);
  });

  it('meshes board + post for floor, but board only for wall', () => {
    expect(signMesh({ attachment: 'floor', signRotation: 0 }).vertices).toBe(48);
    expect(signMesh({ attachment: 'wall', facing: 'south' }).vertices).toBe(24);
  });

  it('honors 16 standing rotations and four wall facings without moving the sign cell', () => {
    const floor0 = signMesh({ attachment: 'floor', signRotation: 0 }).bounds;
    const floor4 = signMesh({ attachment: 'floor', signRotation: 4 }).bounds;
    const floor8 = signMesh({ attachment: 'floor', signRotation: 8 }).bounds;
    expect(floor0.max.x - floor0.min.x).toBeCloseTo(1.2);
    expect(floor4.max.z - floor4.min.z).toBeCloseTo(1.2);
    expect(floor8.getCenter(new THREE.Vector3()).x).toBeCloseTo(8.5);
    for (const facing of ['north', 'east', 'south', 'west'] as const) {
      const { bounds, vertices } = signMesh({ attachment: 'wall', facing });
      expect(vertices, facing).toBe(24);
      const span = facing === 'east' || facing === 'west'
        ? bounds.max.z - bounds.min.z : bounds.max.x - bounds.min.x;
      expect(span, facing).toBeCloseTo(1.2);
    }
  });
});
