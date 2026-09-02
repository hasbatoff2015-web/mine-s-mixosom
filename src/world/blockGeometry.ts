/**
 * Simulation-level block geometry: local AABBs, neighbor shapes, attachment
 * normals. No Three.js, meshes, materials, or textures.
 *
 * Rendering (`specialBlockGeometry`) imports these definitions for mesh/outline.
 * Collision, selection, placement, rails, and the Anarchy server import here.
 */

import type {
  BlockAttachment,
  BlockDefinition,
  BlockRenderState,
  HorizontalFacing,
  RailShape,
  SlabType,
  StairHalf,
  StairShape,
} from '../blocks';
import {
  BlockId,
  counterClockwiseFacing,
  facingAxis,
  getBlockDefinition,
  HORIZONTAL_OFFSET,
  isFenceBlock,
  isStairBlock,
  occupiedDoorFacing,
  oppositeFacing,
} from '../blocks';

/** Vanilla ladder.json plane at 15.2/16 from the opposite face = 0.8/16 from support. */
export const LADDER_PLANE = 0.8 / 16;
/** Vanilla ladder collision depth 1.6/16. */
export const LADDER_DEPTH = 1.6 / 16;
export const DOOR_THICKNESS = 3 / 16;

/** World-space stick size; cropped to the opaque 4×20 px region of torch.png. */
export const TORCH_WIDTH = 0.22;
export const TORCH_HEIGHT = 0.88;
/** Keep the back face just off the supporting voxel to avoid z-fighting. */
export const TORCH_WALL_INSET = 0.02;

export interface LocalBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface BlockNeighborView {
  getBlock(x: number, y: number, z: number, generate?: boolean): BlockId;
  getBlockState?(x: number, y: number, z: number): BlockRenderState | undefined;
}

export interface GeometryVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function defaultSlabType(state: BlockRenderState | undefined): SlabType {
  return state?.slabType ?? 'bottom';
}

export function defaultStairHalf(state: BlockRenderState | undefined): StairHalf {
  return state?.stairHalf ?? 'bottom';
}

export function defaultStairFacing(state: BlockRenderState | undefined): HorizontalFacing {
  return state?.facing ?? 'north';
}

export function defaultRailShape(state: BlockRenderState | undefined): RailShape {
  return state?.railShape ?? 'north_south';
}

export function facingVector(facing: HorizontalFacing): GeometryVec3 {
  switch (facing) {
    case 'north': return { x: 0, y: 0, z: -1 };
    case 'south': return { x: 0, y: 0, z: 1 };
    case 'east': return { x: 1, y: 0, z: 0 };
    case 'west': return { x: -1, y: 0, z: 0 };
  }
}

export function attachmentNormal(
  attachment: BlockAttachment,
  facing: HorizontalFacing,
): GeometryVec3 {
  if (attachment === 'floor') return { x: 0, y: 1, z: 0 };
  if (attachment === 'ceiling') return { x: 0, y: -1, z: 0 };
  return facingVector(facing);
}

export function leverHandleAngle(powered: boolean): number {
  return powered ? -Math.PI * 0.28 : Math.PI * 0.28;
}

function rotateLocalBox(box: LocalBox, facing: HorizontalFacing): LocalBox {
  const corners: Array<readonly [number, number]> = [
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.minX, box.maxZ],
    [box.maxX, box.maxZ],
  ];
  const rotated = corners.map(([x, z]) => rotateYFromEast(x, z, facing));
  const xs = rotated.map((point) => point[0]);
  const zs = rotated.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: box.minY,
    maxY: box.maxY,
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Local boxes are authored for east-facing stairs (upper step on +X). */
function rotateYFromEast(x: number, z: number, facing: HorizontalFacing): readonly [number, number] {
  const cx = x - 0.5;
  const cz = z - 0.5;
  switch (facing) {
    case 'east': return [x, z];
    case 'north': return [0.5 + cz, 0.5 - cx];
    case 'west': return [0.5 - cx, 0.5 - cz];
    case 'south': return [0.5 - cz, 0.5 + cx];
  }
}

function flipY(box: LocalBox): LocalBox {
  return {
    minX: box.minX,
    maxX: box.maxX,
    minZ: box.minZ,
    maxZ: box.maxZ,
    minY: 1 - box.maxY,
    maxY: 1 - box.minY,
  };
}

const EAST_STRAIGHT: readonly LocalBox[] = [
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
  { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
];
const EAST_INNER_LEFT: readonly LocalBox[] = [
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
  { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
  { minX: 0, minY: 0.5, minZ: 0, maxX: 0.5, maxY: 1, maxZ: 0.5 },
];
const EAST_INNER_RIGHT: readonly LocalBox[] = [
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
  { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
  { minX: 0, minY: 0.5, minZ: 0.5, maxX: 0.5, maxY: 1, maxZ: 1 },
];
const EAST_OUTER_LEFT: readonly LocalBox[] = [
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
  { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 0.5 },
];
const EAST_OUTER_RIGHT: readonly LocalBox[] = [
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
  { minX: 0.5, minY: 0.5, minZ: 0.5, maxX: 1, maxY: 1, maxZ: 1 },
];

function eastStairBoxes(shape: StairShape): readonly LocalBox[] {
  switch (shape) {
    case 'straight': return EAST_STRAIGHT;
    case 'inner_left': return EAST_INNER_LEFT;
    case 'inner_right': return EAST_INNER_RIGHT;
    case 'outer_left': return EAST_OUTER_LEFT;
    case 'outer_right': return EAST_OUTER_RIGHT;
  }
}

export function slabLocalBoxes(slabType: SlabType = 'bottom'): readonly LocalBox[] {
  if (slabType === 'top') return [{ minX: 0, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }];
  if (slabType === 'double') return [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }];
  return [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 }];
}

export function stairLocalBoxes(
  facing: HorizontalFacing = 'north',
  half: StairHalf = 'bottom',
  shape: StairShape = 'straight',
): LocalBox[] {
  const east = eastStairBoxes(shape);
  const oriented = east.map((box) => rotateLocalBox(box, facing));
  return half === 'top' ? oriented.map(flipY) : oriented;
}

export function resolveStairShape(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
  state?: BlockRenderState,
): StairShape {
  const facing = defaultStairFacing(state);
  const half = defaultStairHalf(state);
  const frontOff = HORIZONTAL_OFFSET[facing];
  const front = world.getBlock(x + frontOff[0], y + frontOff[1], z + frontOff[2], false);
  if (isStairBlock(front) && defaultStairHalf(world.getBlockState?.(x + frontOff[0], y, z + frontOff[2])) === half) {
    const frontFacing = defaultStairFacing(world.getBlockState?.(x + frontOff[0], y, z + frontOff[2]));
    if (facingAxis(frontFacing) !== facingAxis(facing)
      && stairCanTakeShape(world, x, y, z, state, oppositeFacing(frontFacing))) {
      // Geometry authors the high step on `facing`. A perpendicular neighbor
      // on that high side is the convex outside, so this is OUTER — the
      // previous front→inner mapping filled the outer corner.
      return frontFacing === counterClockwiseFacing(facing) ? 'outer_left' : 'outer_right';
    }
  }
  const backOff = HORIZONTAL_OFFSET[oppositeFacing(facing)];
  const back = world.getBlock(x + backOff[0], y, z + backOff[2], false);
  if (isStairBlock(back) && defaultStairHalf(world.getBlockState?.(x + backOff[0], y, z + backOff[2])) === half) {
    const backFacing = defaultStairFacing(world.getBlockState?.(x + backOff[0], y, z + backOff[2]));
    if (facingAxis(backFacing) !== facingAxis(facing)
      && stairCanTakeShape(world, x, y, z, state, backFacing)) {
      return backFacing === counterClockwiseFacing(facing) ? 'inner_left' : 'inner_right';
    }
  }
  return 'straight';
}

function stairCanTakeShape(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
  face: HorizontalFacing,
): boolean {
  const offset = HORIZONTAL_OFFSET[face];
  const other = world.getBlock(x + offset[0], y, z + offset[2], false);
  if (!isStairBlock(other)) return true;
  const otherState = world.getBlockState?.(x + offset[0], y, z + offset[2]);
  return defaultStairFacing(otherState) !== defaultStairFacing(state)
    || defaultStairHalf(otherState) !== defaultStairHalf(state);
}

export function blockOccludesFaces(world: BlockNeighborView, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z, false);
  if (id === BlockId.Air) return false;
  const definition = getBlockDefinition(id);
  if (definition.renderShape === 'slab') return defaultSlabType(world.getBlockState?.(x, y, z)) === 'double';
  return definition.occludesFaces;
}

/**
 * Ladder plane against the support. `facing` is the clicked-face normal
 * (support is opposite), matching wall torch.
 */
export function ladderPlaneLocal(facing: HorizontalFacing): {
  readonly axis: 'x' | 'z';
  readonly plane: number;
  readonly min: number;
  readonly max: number;
  readonly outward: readonly [number, number, number];
} {
  switch (facing) {
    case 'east':
      return { axis: 'x', plane: LADDER_PLANE, min: 0, max: LADDER_DEPTH, outward: [1, 0, 0] };
    case 'west':
      return { axis: 'x', plane: 1 - LADDER_PLANE, min: 1 - LADDER_DEPTH, max: 1, outward: [-1, 0, 0] };
    case 'south':
      return { axis: 'z', plane: LADDER_PLANE, min: 0, max: LADDER_DEPTH, outward: [0, 0, 1] };
    case 'north':
      return { axis: 'z', plane: 1 - LADDER_PLANE, min: 1 - LADDER_DEPTH, max: 1, outward: [0, 0, -1] };
  }
}

export function fenceConnects(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
  facing: HorizontalFacing,
): boolean {
  const offset = HORIZONTAL_OFFSET[facing];
  const neighbor = world.getBlock(x + offset[0], y, z + offset[2], false);
  if (isFenceBlock(neighbor)) return true;
  const definition = getBlockDefinition(neighbor);
  return definition.solid && definition.occludesFaces && definition.renderShape === 'cube';
}

export function fenceConnections(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
): Readonly<Record<HorizontalFacing, boolean>> {
  return {
    north: fenceConnects(world, x, y, z, 'north'),
    south: fenceConnects(world, x, y, z, 'south'),
    east: fenceConnects(world, x, y, z, 'east'),
    west: fenceConnects(world, x, y, z, 'west'),
  };
}

/** Visual posts are 1 high; collision uses 1.5 so a normal jump cannot clear them. */
export function fenceLocalBoxes(
  connections: Readonly<Record<HorizontalFacing, boolean>>,
  collisionHeight = 1,
): LocalBox[] {
  const post: LocalBox = {
    minX: 6 / 16, minY: 0, minZ: 6 / 16,
    maxX: 10 / 16, maxY: collisionHeight, maxZ: 10 / 16,
  };
  const boxes: LocalBox[] = [post];
  const arm = (minX: number, minZ: number, maxX: number, maxZ: number): LocalBox => ({
    minX, minY: collisionHeight > 1 ? 0 : 6 / 16, minZ, maxX, maxY: collisionHeight, maxZ,
  });
  if (connections.north) boxes.push(arm(7 / 16, 0, 9 / 16, 6 / 16));
  if (connections.south) boxes.push(arm(7 / 16, 10 / 16, 9 / 16, 1));
  if (connections.west) boxes.push(arm(0, 7 / 16, 6 / 16, 9 / 16));
  if (connections.east) boxes.push(arm(10 / 16, 7 / 16, 1, 9 / 16));
  return boxes;
}

/** Isolated rail follows the player's look axis (north = −Z). */
export function isolatedRailShapeFromYaw(yaw: number): 'north_south' | 'east_west' {
  const x = -Math.sin(yaw);
  const z = -Math.cos(yaw);
  return Math.abs(x) > Math.abs(z) ? 'east_west' : 'north_south';
}

/** East-west family is the same strip rotated 90° so logical EW matches visual rails. */
export function railTextureYaw(shape: RailShape): number {
  return shape === 'east_west' || shape === 'ascending_east' || shape === 'ascending_west'
    ? Math.PI / 2
    : 0;
}

export function railRunsEastWest(shape: RailShape): boolean {
  return railTextureYaw(shape) !== 0;
}

export function resolveRailShape(
  world: BlockNeighborView,
  x: number,
  y: number,
  z: number,
): RailShape {
  const existing = world.getBlockState?.(x, y, z)?.railShape;
  const north = isRailAt(world, x, y, z - 1) || isRailAt(world, x, y + 1, z - 1);
  const south = isRailAt(world, x, y, z + 1) || isRailAt(world, x, y + 1, z + 1);
  const east = isRailAt(world, x + 1, y, z) || isRailAt(world, x + 1, y + 1, z);
  const west = isRailAt(world, x - 1, y, z) || isRailAt(world, x - 1, y + 1, z);
  const upNorth = isRailAt(world, x, y + 1, z - 1);
  const upSouth = isRailAt(world, x, y + 1, z + 1);
  const upEast = isRailAt(world, x + 1, y + 1, z);
  const upWest = isRailAt(world, x - 1, y + 1, z);
  if (upNorth) return 'ascending_north';
  if (upSouth) return 'ascending_south';
  if (upEast) return 'ascending_east';
  if (upWest) return 'ascending_west';
  if (north && east && !south && !west) return 'north_east';
  if (north && west && !south && !east) return 'north_west';
  if (south && east && !north && !west) return 'south_east';
  if (south && west && !north && !east) return 'south_west';
  if (east || west) return 'east_west';
  if (north || south) return 'north_south';
  return existing ?? 'north_south';
}

export function isRailAt(world: BlockNeighborView, x: number, y: number, z: number): boolean {
  return world.getBlock(x, y, z, false) === BlockId.Rail;
}

export function railLocalBoxes(shape: RailShape): LocalBox[] {
  const h = 2 / 16;
  const flat: LocalBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: h, maxZ: 1 };
  switch (shape) {
    case 'ascending_south':
      return [
        { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5 + h, maxZ: 0.5 },
        { minX: 0, minY: 0.5, minZ: 0.5, maxX: 1, maxY: 1, maxZ: 1 },
      ];
    case 'ascending_north':
      return [
        { minX: 0, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 0.5 },
        { minX: 0, minY: 0, minZ: 0.5, maxX: 1, maxY: 0.5 + h, maxZ: 1 },
      ];
    case 'ascending_east':
      return [
        { minX: 0, minY: 0, minZ: 0, maxX: 0.5, maxY: 0.5 + h, maxZ: 1 },
        { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      ];
    case 'ascending_west':
      return [
        { minX: 0, minY: 0.5, minZ: 0, maxX: 0.5, maxY: 1, maxZ: 1 },
        { minX: 0.5, minY: 0, minZ: 0, maxX: 1, maxY: 0.5 + h, maxZ: 1 },
      ];
    default:
      return [flat];
  }
}

export const FULL_BLOCK: LocalBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
export const CROSS_BOX: LocalBox = { minX: 0.275, minY: 0, minZ: 0.275, maxX: 0.725, maxY: 0.9, maxZ: 0.725 };
export const COBWEB_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 1, maxZ: 15 / 16 };
export const FIRE_BOX: LocalBox = { minX: 0.2, minY: 0, minZ: 0.2, maxX: 0.8, maxY: 1, maxZ: 0.8 };
export const WIRE_BOX: LocalBox = { minX: 0.05, minY: 0, minZ: 0.05, maxX: 0.95, maxY: 0.0625, maxZ: 0.95 };
export const CACTUS_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 1, maxZ: 15 / 16 };
export const CHEST_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 14 / 16, maxZ: 15 / 16 };

export function isHangingLantern(state: BlockRenderState | undefined): boolean {
  return state?.attachment === 'ceiling';
}

/** Vanilla standing (5,0,5)–(11,9,11) / hanging (5,1,5)–(11,10,11). */
export function lanternSelectionLocalBox(state: BlockRenderState | undefined): LocalBox {
  if (isHangingLantern(state)) {
    return { minX: 5 / 16, minY: 1 / 16, minZ: 5 / 16, maxX: 11 / 16, maxY: 10 / 16, maxZ: 11 / 16 };
  }
  return { minX: 5 / 16, minY: 0, minZ: 5 / 16, maxX: 11 / 16, maxY: 9 / 16, maxZ: 11 / 16 };
}

/** Vanilla chain collision column 6.5–9.5 on XZ, full height. */
export function chainSelectionLocalBox(): LocalBox {
  return { minX: 6.5 / 16, minY: 0, minZ: 6.5 / 16, maxX: 9.5 / 16, maxY: 1, maxZ: 9.5 / 16 };
}

export function plateLocalBox(powered: boolean): LocalBox {
  const height = powered ? 0.03125 : 0.0625;
  return { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: height, maxZ: 15 / 16 };
}

export function ladderLocalBox(facing: HorizontalFacing): LocalBox {
  const plane = ladderPlaneLocal(facing);
  if (plane.axis === 'x') {
    return { minX: plane.min, minY: 0, minZ: 0, maxX: plane.max, maxY: 1, maxZ: 1 };
  }
  return { minX: 0, minY: 0, minZ: plane.min, maxX: 1, maxY: 1, maxZ: plane.max };
}

export function doorLocalBox(state: BlockRenderState | undefined): LocalBox {
  const occupied = occupiedDoorFacing(
    state?.facing ?? 'north',
    state?.open === true,
    state?.hinge ?? 'left',
  );
  const t = DOOR_THICKNESS;
  switch (occupied) {
    case 'north': return { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: t };
    case 'south': return { minX: 0, minY: 0, minZ: 1 - t, maxX: 1, maxY: 1, maxZ: 1 };
    case 'west': return { minX: 0, minY: 0, minZ: 0, maxX: t, maxY: 1, maxZ: 1 };
    case 'east': return { minX: 1 - t, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
  }
}

export function torchLocalBoxes(state: BlockRenderState | undefined): LocalBox[] {
  const attachment = state?.attachment ?? 'floor';
  const facing = state?.facing ?? 'north';
  const w = TORCH_WIDTH;
  const h = TORCH_HEIGHT;
  if (attachment === 'floor') {
    return [{ minX: 0.5 - w / 2, minY: 0, minZ: 0.5 - w / 2, maxX: 0.5 + w / 2, maxY: h, maxZ: 0.5 + w / 2 }];
  }
  if (attachment === 'ceiling') {
    return [{ minX: 0.5 - w / 2, minY: 1 - h, minZ: 0.5 - w / 2, maxX: 0.5 + w / 2, maxY: 1, maxZ: 0.5 + w / 2 }];
  }
  const depth = w + TORCH_WALL_INSET + 0.04;
  switch (facing) {
    case 'east':
      return [{ minX: 0, minY: 0.12, minZ: 0.5 - w / 2, maxX: depth, maxY: 0.12 + h, maxZ: 0.5 + w / 2 }];
    case 'west':
      return [{ minX: 1 - depth, minY: 0.12, minZ: 0.5 - w / 2, maxX: 1, maxY: 0.12 + h, maxZ: 0.5 + w / 2 }];
    case 'south':
      return [{ minX: 0.5 - w / 2, minY: 0.12, minZ: 0, maxX: 0.5 + w / 2, maxY: 0.12 + h, maxZ: depth }];
    case 'north':
      return [{ minX: 0.5 - w / 2, minY: 0.12, minZ: 1 - depth, maxX: 0.5 + w / 2, maxY: 0.12 + h, maxZ: 1 }];
  }
}

function add(a: GeometryVec3, b: GeometryVec3): GeometryVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: GeometryVec3, s: number): GeometryVec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function cross(a: GeometryVec3, b: GeometryVec3): GeometryVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function lengthSq(v: GeometryVec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

function normalize(v: GeometryVec3): GeometryVec3 {
  const length = Math.sqrt(lengthSq(v));
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function surfaceBasis(
  attachment: BlockAttachment,
  facing: HorizontalFacing,
): { x: GeometryVec3; y: GeometryVec3; z: GeometryVec3 } {
  const normal = attachmentNormal(attachment, facing);
  const localZ = attachment === 'wall' ? { x: 0, y: 1, z: 0 } : facingVector(facing);
  let localX = cross(normal, localZ);
  if (lengthSq(localX) < 1e-6) localX = { x: 1, y: 0, z: 0 };
  else localX = normalize(localX);
  return { x: localX, y: normal, z: localZ };
}

function applyBasis(
  basis: { x: GeometryVec3; y: GeometryVec3; z: GeometryVec3 },
  local: GeometryVec3,
): GeometryVec3 {
  return add(add(scale(basis.x, local.x), scale(basis.y, local.y)), scale(basis.z, local.z));
}

function rotateX(v: GeometryVec3, angle: number): GeometryVec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x, y: v.y * cos - v.z * sin, z: v.y * sin + v.z * cos };
}

function unitCubeCorners(): GeometryVec3[] {
  const signs = [-0.5, 0.5];
  const corners: GeometryVec3[] = [];
  for (const x of signs) for (const y of signs) for (const z of signs) {
    corners.push({ x, y, z });
  }
  return corners;
}

function aabbFromCorners(corners: readonly GeometryVec3[]): LocalBox {
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    minZ: Math.min(...corners.map((c) => c.z)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
    maxZ: Math.max(...corners.map((c) => c.z)),
  };
}

function orientedLocalBox(
  center: GeometryVec3,
  size: GeometryVec3,
  basis: { x: GeometryVec3; y: GeometryVec3; z: GeometryVec3 },
): LocalBox {
  const corners = unitCubeCorners().map((p) => add(center, applyBasis(basis, {
    x: p.x * size.x,
    y: p.y * size.y,
    z: p.z * size.z,
  })));
  return aabbFromCorners(corners);
}

export function buttonLocalBoxes(state: BlockRenderState | undefined): LocalBox[] {
  const attachment = state?.attachment ?? 'wall';
  const facing = state?.facing ?? 'south';
  const depth = state?.powered ? 0.06 : 0.125;
  const basis = surfaceBasis(attachment, facing);
  const normal = attachmentNormal(attachment, facing);
  const surface = add({ x: 0.5, y: 0.5, z: 0.5 }, scale(normal, -0.5));
  const center = add(surface, scale(normal, depth / 2));
  return [orientedLocalBox(center, { x: 0.375, y: depth, z: 0.22 }, basis)];
}

export function leverLocalBoxes(state: BlockRenderState | undefined): LocalBox[] {
  const attachment = state?.attachment ?? 'floor';
  const facing = state?.facing ?? 'north';
  const basis = surfaceBasis(attachment, facing);
  const normal = attachmentNormal(attachment, facing);
  const surface = add({ x: 0.5, y: 0.5, z: 0.5 }, scale(normal, -0.5));
  const baseThickness = 0.125;
  const handleLength = 0.625;
  const baseCenter = add(surface, scale(normal, baseThickness / 2));
  const pivot = add(surface, scale(normal, baseThickness));
  const angle = leverHandleAngle(state?.powered === true);
  const handleCorners = unitCubeCorners().map((p) => {
    let local = { x: p.x * 0.125, y: p.y * handleLength, z: p.z * 0.125 };
    local = { x: local.x, y: local.y + handleLength / 2, z: local.z };
    local = rotateX(local, angle);
    return add(pivot, applyBasis(basis, local));
  });
  return [
    orientedLocalBox(baseCenter, { x: 0.5, y: baseThickness, z: 0.375 }, basis),
    aabbFromCorners(handleCorners),
  ];
}

const controlBoxCache = new Map<string, LocalBox[]>();

export function controlLocalBoxes(block: BlockId, state: BlockRenderState | undefined): LocalBox[] {
  const key = `${block}:${state?.attachment}:${state?.facing}:${state?.powered === true}`;
  let boxes = controlBoxCache.get(key);
  if (!boxes) {
    boxes = block === BlockId.StoneButton ? buttonLocalBoxes(state) : leverLocalBoxes(state);
    controlBoxCache.set(key, boxes);
  }
  return boxes;
}

/**
 * Canonical interaction AABBs in cell-local space. Empty means the cell is not
 * selectable (air / liquid). Full cube is the default for ordinary blocks.
 */
export function selectionLocalBoxes(
  block: BlockId,
  state: BlockRenderState | undefined,
  world?: BlockNeighborView,
  x = 0,
  y = 0,
  z = 0,
): LocalBox[] {
  if (block === BlockId.Air) return [];
  const definition = getBlockDefinition(block);
  if (definition.liquid) return [];
  if (block === BlockId.Cobweb) return [COBWEB_BOX];
  if (block === BlockId.Cactus) return [CACTUS_BOX];
  switch (definition.renderShape) {
    case 'torch': return torchLocalBoxes(state);
    case 'button':
    case 'lever': return controlLocalBoxes(block, state);
    case 'pressure_plate': return [plateLocalBox(state?.powered === true)];
    case 'wire': return [WIRE_BOX];
    case 'door': return [doorLocalBox(state)];
    case 'ladder': return [ladderLocalBox(state?.facing ?? 'north')];
    case 'cross': return [CROSS_BOX];
    case 'fire': return [FIRE_BOX];
    case 'stairs':
      return stairLocalBoxes(
        defaultStairFacing(state),
        defaultStairHalf(state),
        world ? resolveStairShape(world, x, y, z, state) : 'straight',
      );
    case 'slab':
      return [...slabLocalBoxes(defaultSlabType(state))];
    case 'chest':
      return [CHEST_BOX];
    case 'fence': {
      const connections = world
        ? fenceConnections(world, x, y, z)
        : { north: false, south: false, east: false, west: false };
      return fenceLocalBoxes(connections, 1);
    }
    case 'rail':
      return railLocalBoxes(defaultRailShape(state));
    case 'lantern':
      return [lanternSelectionLocalBox(state)];
    case 'chain':
      return [chainSelectionLocalBox()];
    case 'cube':
    default:
      return [FULL_BLOCK];
  }
}

export function selectionShapeKey(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state?: BlockRenderState,
  stairShape: StairShape | '' = '',
): string {
  return [
    definition.renderShape,
    state?.attachment ?? '',
    state?.facing ?? '',
    state?.powered === true ? '1' : '0',
    state?.open === true ? '1' : '0',
    state?.half ?? '',
    state?.hinge ?? '',
    state?.slabType ?? '',
    state?.stairHalf ?? '',
    state?.railShape ?? '',
    stairShape,
    String(state?.power ?? ''),
  ].join('|');
}
