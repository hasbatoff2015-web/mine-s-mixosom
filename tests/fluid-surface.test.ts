import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE } from '../src/core/constants';
import { FLUID_SOURCE_LEVEL } from '../src/world/fluids';
import {
  fluidCellGeometry,
  fluidCornerHeight,
  fluidTopHasSlope,
} from '../src/world/fluidSurface';
import { VoxelWorld } from '../src/world/World';

function loadFlat(world: VoxelWorld, floorY = 40): void {
  world.getChunk(0, 0);
  world.getChunk(1, 0);
  world.getChunk(-1, 0);
  world.getChunk(0, 1);
  world.getChunk(0, -1);
  world.getChunk(1, 1);
  world.getChunk(-1, -1);
  world.getChunk(1, -1);
  world.getChunk(-1, 1);
  for (const chunk of world.chunks.values()) {
    chunk.blocks.fill(BlockId.Air);
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        chunk.set(x, floorY, z, BlockId.Stone);
        chunk.set(x, 0, z, BlockId.Bedrock);
      }
    }
  }
}

describe('fluid surface geometry', () => {
  it('keeps a 3×3 source pool flat and culls internal vertical faces', () => {
    const world = new VoxelWorld('fluid-flat-pool');
    loadFlat(world, 30);
    for (let z = 7; z <= 9; z += 1) {
      for (let x = 7; x <= 9; x += 1) world.setBlock(x, 31, z, BlockId.Water);
    }
    const corners = new Set<number>();
    let internalSides = 0;
    for (let z = 7; z <= 9; z += 1) {
      for (let x = 7; x <= 9; x += 1) {
        const geom = fluidCellGeometry(world, x, 31, z);
        expect(geom?.top).not.toBeNull();
        const top = geom!.top!;
        expect(top.h00).toBeCloseTo(top.h10, 6);
        expect(top.h00).toBeCloseTo(top.h01, 6);
        expect(top.h00).toBeCloseTo(top.h11, 6);
        corners.add(top.h00);
        if (x < 9) expect(geom!.sides.px).toBe(false);
        if (x > 7) expect(geom!.sides.nx).toBe(false);
        if (z < 9) expect(geom!.sides.pz).toBe(false);
        if (z > 7) expect(geom!.sides.nz).toBe(false);
        internalSides += Number(x < 9 && geom!.sides.px) + Number(z < 9 && geom!.sides.pz);
      }
    }
    expect(corners.size).toBe(1);
    expect(internalSides).toBe(0);
    expect([...corners][0]!).toBeLessThan(1);
    expect([...corners][0]!).toBeGreaterThan(0.8);
  });

  it('builds four independent corner heights and a flowing slope', () => {
    const world = new VoxelWorld('fluid-slope');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.setBlock(9, 31, 8, BlockId.Water);
    world.setBlockState(9, 31, 8, { fluidLevel: 6, fluidFalling: false });
    world.setBlock(10, 31, 8, BlockId.Water);
    world.setBlockState(10, 31, 8, { fluidLevel: 4, fluidFalling: false });
    world.setBlock(11, 31, 8, BlockId.Water);
    world.setBlockState(11, 31, 8, { fluidLevel: 2, fluidFalling: false });
    const source = fluidCellGeometry(world, 8, 31, 8)!.top!;
    const mid = fluidCellGeometry(world, 10, 31, 8)!.top!;
    const tip = fluidCellGeometry(world, 11, 31, 8)!.top!;
    expect(fluidTopHasSlope(mid) || fluidTopHasSlope(tip)).toBe(true);
    const midMean = (mid.h00 + mid.h10 + mid.h01 + mid.h11) / 4;
    const tipMean = (tip.h00 + tip.h10 + tip.h01 + tip.h11) / 4;
    expect(midMean).toBeGreaterThan(tipMean);
    expect(source.h10).toBeGreaterThanOrEqual(mid.h00 - 1e-6);
  });

  it('matches shared-edge heights between adjacent cells', () => {
    const world = new VoxelWorld('fluid-shared-edge');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Water);
    world.setBlock(9, 31, 8, BlockId.Water);
    world.setBlockState(9, 31, 8, { fluidLevel: 5, fluidFalling: false });
    const left = fluidCellGeometry(world, 8, 31, 8)!.top!;
    const right = fluidCellGeometry(world, 9, 31, 8)!.top!;
    expect(left.h10).toBeCloseTo(right.h00, 10);
    expect(left.h11).toBeCloseTo(right.h01, 10);
    expect(fluidCornerHeight(world, 9, 31, 8, BlockId.Water)).toBe(left.h10);
    expect(fluidCornerHeight(world, 9, 31, 8, BlockId.Water)).toBe(right.h00);
  });

  it('omits the top face when the same fluid is above', () => {
    const world = new VoxelWorld('fluid-column');
    loadFlat(world, 20);
    world.setBlock(4, 21, 4, BlockId.Water);
    world.setBlock(4, 22, 4, BlockId.Water);
    expect(fluidCellGeometry(world, 4, 21, 4)?.top).toBeNull();
    expect(fluidCellGeometry(world, 4, 22, 4)?.top).not.toBeNull();
  });

  it('produces identical chunk-border corners from either side', () => {
    const world = new VoxelWorld('fluid-border-corners');
    loadFlat(world, 30);
    world.setBlock(15, 31, 8, BlockId.Water);
    world.setBlock(16, 31, 8, BlockId.Water);
    world.setBlockState(16, 31, 8, { fluidLevel: 5, fluidFalling: false });
    const west = fluidCellGeometry(world, 15, 31, 8)!.top!;
    const east = fluidCellGeometry(world, 16, 31, 8)!.top!;
    expect(west.h10).toBe(east.h00);
    expect(west.h11).toBe(east.h01);
    expect(fluidCellGeometry(world, 15, 31, 8)!.sides.px).toBe(false);
    expect(fluidCellGeometry(world, 16, 31, 8)!.sides.nx).toBe(false);
  });

  it('uses the same lava surface algorithm as water', () => {
    const world = new VoxelWorld('fluid-lava-geom');
    loadFlat(world, 30);
    world.setBlock(8, 31, 8, BlockId.Lava);
    world.setBlock(9, 31, 8, BlockId.Lava);
    world.setBlockState(9, 31, 8, { fluidLevel: 4, fluidFalling: false });
    const source = fluidCellGeometry(world, 8, 31, 8);
    const flow = fluidCellGeometry(world, 9, 31, 8);
    expect(source?.type).toBe(BlockId.Lava);
    expect(flow?.sides.nx).toBe(false);
    expect(source?.sides.px).toBe(false);
    expect(fluidTopHasSlope(flow!.top!) || flow!.top!.h00 !== flow!.top!.h10).toBe(true);
  });

  it('keeps falling columns full height', () => {
    const world = new VoxelWorld('fluid-fall-geom');
    loadFlat(world, 20);
    world.setBlock(5, 21, 5, BlockId.Water);
    world.setBlockState(5, 21, 5, { fluidLevel: FLUID_SOURCE_LEVEL, fluidFalling: true });
    const geom = fluidCellGeometry(world, 5, 21, 5);
    expect(geom?.top).not.toBeNull();
    expect(geom!.top!.h00).toBeCloseTo(14 / 16, 6);
    expect(geom!.top!.h11).toBeCloseTo(14 / 16, 6);
  });
});
