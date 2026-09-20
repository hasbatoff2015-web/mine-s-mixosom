import { BlockId, type RailShape } from '../blocks';
import { CHUNK_SIZE, floorDiv } from '../core/constants';
import { railEndDirections, resolveRailShape } from '../world/blockGeometry';
import type { VoxelWorld } from '../world/World';

export interface RailCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly shape: RailShape;
}

export interface RailSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly tangentZ: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly length: number;
}

const QUARTER = Math.PI / 2;
const CURVE_RADIUS = 0.5;
const CURVE_LENGTH = CURVE_RADIUS * QUARTER;

function isCurveShape(shape: RailShape): boolean {
  return shape === 'north_east' || shape === 'north_west'
    || shape === 'south_east' || shape === 'south_west';
}

export function railLength(shape: RailShape): number {
  if (shape.startsWith('ascending_')) return Math.SQRT2;
  if (isCurveShape(shape)) return CURVE_LENGTH;
  return 1;
}

export function railAt(world: VoxelWorld, x: number, y: number, z: number): RailShape | undefined {
  if (world.getBlock(x, y, z, false) !== BlockId.Rail) return undefined;
  return resolveRailShape(world, x, y, z);
}

export function findRailCell(world: VoxelWorld, x: number, y: number, z: number): RailCell | undefined {
  const bx = Math.floor(x);
  const by = Math.floor(y + 0.05);
  const bz = Math.floor(z);
  for (const sampleY of [by, by - 1, by + 1]) {
    const shape = railAt(world, bx, sampleY, bz);
    if (shape) return { x: bx, y: sampleY, z: bz, shape };
  }
  return undefined;
}

export function isRailChunkLoaded(world: VoxelWorld, x: number, z: number): boolean {
  return world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE), false) !== undefined;
}

export function sampleRail(cell: RailCell, t: number): RailSample {
  const clamped = Math.max(0, Math.min(1, t));
  const local = sampleLocal(cell.shape, clamped);
  const length = railLength(cell.shape);
  const tangentLength = Math.hypot(local.tx, local.ty, local.tz) || 1;
  const tangentX = local.tx / tangentLength;
  const tangentY = local.ty / tangentLength;
  const tangentZ = local.tz / tangentLength;
  return {
    x: cell.x + local.x,
    y: cell.y + local.y,
    z: cell.z + local.z,
    tangentX,
    tangentY,
    tangentZ,
    yaw: Math.atan2(tangentX, tangentZ),
    pitch: Math.atan2(-tangentY, Math.hypot(tangentX, tangentZ)),
    length,
  };
}

export function progressOnRail(shape: RailShape, localX: number, localZ: number): number {
  const x = Math.max(0, Math.min(1, localX));
  const z = Math.max(0, Math.min(1, localZ));
  switch (shape) {
    case 'east_west':
    case 'ascending_east':
      return x;
    case 'ascending_west':
      return 1 - x;
    case 'north_south':
    case 'ascending_south':
      return z;
    case 'ascending_north':
      return 1 - z;
    case 'north_east':
      return quarterProgress(1 - x, z);
    case 'north_west':
      return quarterProgress(x, z);
    case 'south_east':
      return quarterProgress(1 - x, 1 - z);
    case 'south_west':
      return quarterProgress(x, 1 - z);
    default:
      return z;
  }
}

/**
 * Neighbor cell this end of the rail connects to. `tEnd` is 0 or 1.
 * The neighbor must have a reciprocal endpoint facing this cell.
 */
export function nextRail(
  world: VoxelWorld,
  cell: RailCell,
  tEnd: 0 | 1,
): RailCell | undefined {
  const dir = railEndDirections(cell.shape)[tEnd]!;
  const candidates: Array<readonly [number, number, number]> = [
    [cell.x + dir.dx, cell.y + dir.dy, cell.z + dir.dz],
    [cell.x + dir.dx, cell.y, cell.z + dir.dz],
    [cell.x + dir.dx, cell.y + 1, cell.z + dir.dz],
    [cell.x + dir.dx, cell.y - 1, cell.z + dir.dz],
  ];
  const seen = new Set<string>();
  for (const [x, y, z] of candidates) {
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isRailChunkLoaded(world, x, z)) return undefined;
    const shape = railAt(world, x, y, z);
    if (!shape) continue;
    if (entryProgress(shape, cell.x - x, cell.y - y, cell.z - z) === undefined) continue;
    return { x, y, z, shape };
  }
  return undefined;
}

/** Progress (0 or 1) at which `shape` is entered from the previous cell's offset. */
export function entryProgress(
  shape: RailShape,
  fromDx: number,
  _fromDy: number,
  fromDz: number,
): 0 | 1 | undefined {
  const [end0, end1] = railEndDirections(shape);
  const match0 = end0.dx === fromDx && end0.dz === fromDz;
  const match1 = end1.dx === fromDx && end1.dz === fromDz;
  if (match0 === match1) return undefined;
  return match0 ? 0 : 1;
}

function quarterProgress(alongA: number, alongB: number): number {
  const angle = Math.atan2(Math.max(0, alongB), Math.max(0, alongA));
  return Math.max(0, Math.min(1, angle / QUARTER));
}

function sampleLocal(shape: RailShape, t: number): { x: number; y: number; z: number; tx: number; ty: number; tz: number } {
  switch (shape) {
    case 'east_west':
      return { x: t, y: 0, z: 0.5, tx: 1, ty: 0, tz: 0 };
    case 'north_south':
      return { x: 0.5, y: 0, z: t, tx: 0, ty: 0, tz: 1 };
    case 'ascending_east':
      return { x: t, y: t, z: 0.5, tx: 1, ty: 1, tz: 0 };
    case 'ascending_west':
      return { x: 1 - t, y: t, z: 0.5, tx: -1, ty: 1, tz: 0 };
    case 'ascending_south':
      return { x: 0.5, y: t, z: t, tx: 0, ty: 1, tz: 1 };
    case 'ascending_north':
      return { x: 0.5, y: t, z: 1 - t, tx: 0, ty: 1, tz: -1 };
    case 'north_east': {
      // Center (1, 0): north (0.5, 0) → east (1, 0.5).
      const angle = Math.PI - t * QUARTER;
      return {
        x: 1 + 0.5 * Math.cos(angle),
        y: 0,
        z: 0.5 * Math.sin(angle),
        tx: 0.5 * QUARTER * Math.sin(angle),
        ty: 0,
        tz: -0.5 * QUARTER * Math.cos(angle),
      };
    }
    case 'north_west': {
      // Center (0, 0): north (0.5, 0) → west (0, 0.5).
      const angle = t * QUARTER;
      return {
        x: 0.5 * Math.cos(angle),
        y: 0,
        z: 0.5 * Math.sin(angle),
        tx: -0.5 * QUARTER * Math.sin(angle),
        ty: 0,
        tz: 0.5 * QUARTER * Math.cos(angle),
      };
    }
    case 'south_east': {
      // Center (1, 1): south (0.5, 1) → east (1, 0.5).
      const angle = Math.PI + t * QUARTER;
      return {
        x: 1 + 0.5 * Math.cos(angle),
        y: 0,
        z: 1 + 0.5 * Math.sin(angle),
        tx: -0.5 * QUARTER * Math.sin(angle),
        ty: 0,
        tz: 0.5 * QUARTER * Math.cos(angle),
      };
    }
    case 'south_west': {
      // Center (0, 1): south (0.5, 1) → west (0, 0.5).
      const angle = -t * QUARTER;
      return {
        x: 0.5 * Math.cos(angle),
        y: 0,
        z: 1 + 0.5 * Math.sin(angle),
        tx: 0.5 * QUARTER * Math.sin(angle),
        ty: 0,
        tz: -0.5 * QUARTER * Math.cos(angle),
      };
    }
    default:
      return { x: 0.5, y: 0, z: t, tx: 0, ty: 0, tz: 1 };
  }
}
