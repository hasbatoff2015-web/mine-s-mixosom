import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId, type RailShape } from '../src/blocks';
import { doorHingeEdge, doorHingeFromPlacement, occupiedDoorFacing } from '../src/blocks/placement';
import { CHUNK_SIZE } from '../src/core/constants';
import { MinecartManager } from '../src/entities';
import { entryProgress, nextRail, railLength } from '../src/entities/railPath';
import { refreshNeighborRails } from '../src/gameplay';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { VoxelWorld } from '../src/world/World';
import {
  isolatedRailShapeFromYaw,
  railConnectsToward,
  railEndDirections,
  resolveRailShape,
  signLocalBoxes,
} from '../src/world/blockGeometry';

function writeRail(world: VoxelWorld, x: number, y: number, z: number): void {
  world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  world.setBlock(x, y - 1, z, BlockId.Stone);
  world.setBlock(x, y, z, BlockId.Rail);
}

function placeRail(world: VoxelWorld, x: number, y: number, z: number, yaw: number): void {
  writeRail(world, x, y, z);
  world.setBlockState(x, y, z, { railShape: isolatedRailShapeFromYaw(yaw) });
  refreshNeighborRails(world, x, y, z);
}

function shapeAt(world: VoxelWorld, x: number, y: number, z: number): RailShape {
  return resolveRailShape(world, x, y, z);
}

describe('rail corner pathing', () => {
  it('lets a minecart complete a four-corner loop without stalling', () => {
    const world = new VoxelWorld('rail-loop');
    const y = 41;
    writeRail(world, 5, y, 5);
    writeRail(world, 6, y, 5);
    writeRail(world, 6, y, 6);
    writeRail(world, 5, y, 6);
    const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
    const cart = manager.spawn(5, y, 5)!;
    cart.alongSpeed = 4;
    const visited = new Set<string>();
    for (let tick = 0; tick < 80; tick += 1) {
      manager.update(0.05, { riderId: cart.id, forward: 1, riderYaw: 0 });
      expect(manager.isOnRail(cart), `tick ${tick}`).toBe(true);
      visited.add(`${Math.floor(cart.position.x)},${Math.floor(cart.position.z)}`);
    }
    expect(visited.has('5,5')).toBe(true);
    expect(visited.has('6,5')).toBe(true);
    expect(visited.has('6,6')).toBe(true);
    expect(visited.has('5,6')).toBe(true);
    manager.dispose();
  });

  it('resolves the four simple L corners through the placement/refresh pipeline', () => {
    const y = 41;
    const corners: ReadonlyArray<{
      name: RailShape;
      north?: true;
      south?: true;
      east?: true;
      west?: true;
    }> = [
      { name: 'north_east', north: true, east: true },
      { name: 'north_west', north: true, west: true },
      { name: 'south_east', south: true, east: true },
      { name: 'south_west', south: true, west: true },
    ];
    for (const corner of corners) {
      const world = new VoxelWorld(`rail-l-${corner.name}`);
      const x = 8;
      const z = 8;
      if (corner.north) placeRail(world, x, y, z - 1, 0);
      if (corner.south) placeRail(world, x, y, z + 1, 0);
      if (corner.east) placeRail(world, x + 1, y, z, -Math.PI / 2);
      if (corner.west) placeRail(world, x - 1, y, z, Math.PI / 2);
      placeRail(world, x, y, z, 0);
      expect(shapeAt(world, x, y, z), corner.name).toBe(corner.name);
    }
  });

  it('resolves the same L regardless of horizontal-then-vertical placement order', () => {
    const y = 41;
    const build = (order: 'horizontal-first' | 'vertical-first'): RailShape => {
      const world = new VoxelWorld(`rail-order-${order}`);
      const steps = order === 'horizontal-first'
        ? [
            () => placeRail(world, 9, y, 8, -Math.PI / 2),
            () => placeRail(world, 8, y, 7, 0),
            () => placeRail(world, 8, y, 8, 0),
          ]
        : [
            () => placeRail(world, 8, y, 7, 0),
            () => placeRail(world, 9, y, 8, -Math.PI / 2),
            () => placeRail(world, 8, y, 8, 0),
          ];
      for (const step of steps) step();
      return shapeAt(world, 8, y, 8);
    };
    expect(build('horizontal-first')).toBe('north_east');
    expect(build('vertical-first')).toBe('north_east');
  });

  it('keeps an existing NS connection when a third rail sits to the east', () => {
    const world = new VoxelWorld('rail-three');
    const y = 41;
    placeRail(world, 8, y, 7, 0);
    placeRail(world, 8, y, 8, 0);
    placeRail(world, 8, y, 9, 0);
    expect(shapeAt(world, 8, y, 8)).toBe('north_south');
    placeRail(world, 9, y, 8, -Math.PI / 2);
    expect(shapeAt(world, 8, y, 8)).toBe('north_south');
    expect(shapeAt(world, 8, y, 8)).not.toBe('east_west');
  });

  it('rejects a physically adjacent rail that has no reciprocal endpoint', () => {
    const world = new VoxelWorld('rail-nonreciprocal');
    const y = 41;
    placeRail(world, 6, y, 7, 0);
    placeRail(world, 6, y, 8, 0);
    placeRail(world, 6, y, 9, 0);
    placeRail(world, 5, y, 8, -Math.PI / 2);
    placeRail(world, 4, y, 8, -Math.PI / 2);
    expect(shapeAt(world, 6, y, 8)).toBe('north_south');
    expect(shapeAt(world, 5, y, 8)).toBe('east_west');
    const current = { x: 5, y, z: 8, shape: shapeAt(world, 5, y, 8) };
    expect(railConnectsToward(current.shape, 1, 0, 0)).toBe(true);
    expect(railConnectsToward(shapeAt(world, 6, y, 8), -1, 0, 0)).toBe(false);
    expect(nextRail(world, current, 1)).toBeUndefined();
    expect(entryProgress('north_south', -1, 0, 0)).toBeUndefined();
    expect(entryProgress('east_west', 0, 0, -1)).toBeUndefined();
  });

  it('runs a cart through straight → corner → straight for every corner orientation', () => {
    const y = 41;
    const tracks: ReadonlyArray<{
      shape: RailShape;
      cells: ReadonlyArray<{ x: number; z: number; shape: RailShape }>;
      start: { x: number; z: number };
      through: { x: number; z: number };
      exit: { x: number; z: number };
      speed: number;
      exitProgress: 0 | 1;
    }> = [
      {
        shape: 'north_east',
        cells: [
          { x: 5, z: 5, shape: 'north_south' },
          { x: 5, z: 6, shape: 'north_east' },
          { x: 6, z: 6, shape: 'east_west' },
        ],
        start: { x: 5, z: 5 },
        through: { x: 5, z: 6 },
        exit: { x: 6, z: 6 },
        speed: 4,
        exitProgress: 0,
      },
      {
        shape: 'north_west',
        cells: [
          { x: 8, z: 5, shape: 'north_south' },
          { x: 8, z: 6, shape: 'north_west' },
          { x: 7, z: 6, shape: 'east_west' },
        ],
        start: { x: 8, z: 5 },
        through: { x: 8, z: 6 },
        exit: { x: 7, z: 6 },
        speed: 4,
        exitProgress: 1,
      },
      {
        shape: 'south_east',
        cells: [
          { x: 5, z: 10, shape: 'north_south' },
          { x: 5, z: 9, shape: 'south_east' },
          { x: 6, z: 9, shape: 'east_west' },
        ],
        start: { x: 5, z: 10 },
        through: { x: 5, z: 9 },
        exit: { x: 6, z: 9 },
        speed: -4,
        exitProgress: 0,
      },
      {
        shape: 'south_west',
        cells: [
          { x: 8, z: 10, shape: 'north_south' },
          { x: 8, z: 9, shape: 'south_west' },
          { x: 7, z: 9, shape: 'east_west' },
        ],
        start: { x: 8, z: 10 },
        through: { x: 8, z: 9 },
        exit: { x: 7, z: 9 },
        speed: -4,
        exitProgress: 1,
      },
    ];

    for (const track of tracks) {
      const world = new VoxelWorld(`cart-${track.shape}`);
      for (const cell of track.cells) {
        writeRail(world, cell.x, y, cell.z);
        world.setBlockState(cell.x, y, cell.z, { railShape: cell.shape });
      }
      expect(shapeAt(world, track.through.x, y, track.through.z)).toBe(track.shape);
      const manager = new MinecartManager(new THREE.Scene(), world, new ItemVisualFactory());
      const cart = manager.spawn(track.start.x, y, track.start.z)!;
      cart.alongSpeed = track.speed;
      const entries: Array<{ cell: string; progress: number }> = [];
      let last = `${cart.rail?.x},${cart.rail?.z}`;
      let finished = false;
      for (let tick = 0; tick < 40; tick += 1) {
        manager.update(0.05);
        expect(manager.isOnRail(cart), `${track.shape} tick ${tick}`).toBe(true);
        const key = `${cart.rail?.x},${cart.rail?.z}`;
        if (key !== last) {
          entries.push({ cell: key, progress: cart.progress });
          last = key;
        }
        if (key === `${track.exit.x},${track.exit.z}`) {
          const traveled = track.exitProgress === 0 ? cart.progress > 0.35 : cart.progress < 0.65;
          if (traveled) {
            finished = true;
            break;
          }
        }
      }
      expect(finished, `${track.shape} completed`).toBe(true);
      expect(entries.map((entry) => entry.cell)).toEqual([
        `${track.through.x},${track.through.z}`,
        `${track.exit.x},${track.exit.z}`,
      ]);
      expect(entries[0]!.progress, `${track.shape} corner entry`).toBeLessThan(0.2);
      expect(
        Math.abs(entries[1]!.progress - track.exitProgress),
        `${track.shape} exit entry`,
      ).toBeLessThan(0.2);
      manager.dispose();
    }
  });

  it('autoconnects NS, EW, curves and ascending without occupancy-only EW fallback', () => {
    const world = new VoxelWorld('rail-topology');
    world.getChunk(0, 0);
    for (let x = 4; x <= 10; x += 1) {
      for (let z = 4; z <= 10; z += 1) world.setBlock(x, 40, z, BlockId.Stone);
    }
    for (let z = 5; z <= 8; z += 1) world.setBlock(6, 41, z, BlockId.Rail);
    expect(resolveRailShape(world, 6, 41, 6)).toBe('north_south');

    world.setBlock(7, 41, 6, BlockId.Rail);
    world.setBlock(8, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 7, 41, 6)).toBe('east_west');

    world.setBlock(6, 41, 5, BlockId.Air);
    world.setBlock(6, 41, 7, BlockId.Air);
    world.setBlock(6, 41, 8, BlockId.Air);
    world.setBlock(6, 41, 6, BlockId.Rail);
    world.setBlock(6, 41, 5, BlockId.Rail);
    world.setBlock(7, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 6, 41, 6)).toBe('north_east');

    world.setBlock(9, 41, 6, BlockId.Stone);
    world.setBlock(9, 42, 6, BlockId.Rail);
    world.setBlock(8, 41, 6, BlockId.Rail);
    expect(resolveRailShape(world, 8, 41, 6)).toBe('ascending_east');
  });

  it('uses the geometric quarter-circle arc length for every corner', () => {
    const expected = Math.PI / 4;
    for (const shape of ['north_east', 'north_west', 'south_east', 'south_west'] as const) {
      expect(railLength(shape)).toBeCloseTo(expected);
      const [end0, end1] = railEndDirections(shape);
      expect(Math.abs(end0.dx) + Math.abs(end0.dz)).toBe(1);
      expect(Math.abs(end1.dx) + Math.abs(end1.dz)).toBe(1);
    }
  });
});

describe('door hinge occupancy', () => {
  it('opens around the outside-left hinge, not the handle', () => {
    expect(occupiedDoorFacing('south', true, 'left')).toBe('west');
    expect(occupiedDoorFacing('south', true, 'right')).toBe('east');
    expect(doorHingeEdge('north', 'left')).toBe('east');
    expect(doorHingeEdge('north', 'right')).toBe('west');
    expect(doorHingeFromPlacement('south', { x: 5.2, z: 5.9 }, 5, 5)).toBe('left');
    expect(doorHingeFromPlacement('south', { x: 5.8, z: 5.9 }, 5, 5)).toBe('right');
  });
});

describe('sign selection boxes', () => {
  it('keeps standing and wall outlines inside a thin board, not a near-full cube', () => {
    const standing = signLocalBoxes({ attachment: 'floor' });
    expect(standing).toHaveLength(2);
    expect(Math.max(...standing.map((box) => box.maxX - box.minX))).toBeLessThanOrEqual(1);
    expect(Math.max(...standing.map((box) => box.maxZ - box.minZ))).toBeLessThan(0.2);
    const wall = signLocalBoxes({ attachment: 'wall', facing: 'south' });
    expect(wall).toHaveLength(1);
    expect(wall[0]!.maxZ - wall[0]!.minZ).toBeCloseTo(2 / 16);
    expect(wall[0]!.minZ).toBe(0);
  });
});
