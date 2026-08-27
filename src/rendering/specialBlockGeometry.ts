import * as THREE from 'three';
import type {
  BlockAttachment, BlockDefinition, BlockRenderState, DoorHinge, HorizontalFacing, RailShape, SlabType, StairHalf, StairShape,
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

export type DoorFaceRole = 'outer' | 'inner' | 'edge';
export type TextureUvRect = readonly [u0: number, v0: number, u1: number, v1: number];

/**
 * Door face UVs in atlas-tile space (v=0 at image bottom, matching ChunkMesher).
 * Large faces use the full half-texture; hinge left/right mirrors U like vanilla
 * `door_*_left` / `door_*_right`. Edges use the 3-pixel thickness strip, not a
 * repeated full-cube UV.
 */
export function doorFaceTextureUv(role: DoorFaceRole, hinge: DoorHinge = 'left'): TextureUvRect {
  if (role === 'outer') return hinge === 'left' ? [0, 0, 1, 1] : [1, 0, 0, 1];
  if (role === 'inner') return hinge === 'left' ? [1, 0, 0, 1] : [0, 0, 1, 1];
  return [0, 0, 3 / 16, 1];
}

export function doorHalfTexture(
  half: BlockRenderState['half'],
  textures: Pick<BlockDefinition, 'textures'>['textures'],
): string {
  return half === 'upper'
    ? (textures.top ?? 'block/oak_door_upper')
    : (textures.bottom ?? textures.all ?? 'block/oak_door');
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

export function defaultSlabType(state: BlockRenderState | undefined): SlabType {
  return state?.slabType ?? 'bottom';
}

export function defaultStairHalf(state: BlockRenderState | undefined): StairHalf {
  return state?.stairHalf ?? 'bottom';
}

export function defaultStairFacing(state: BlockRenderState | undefined): HorizontalFacing {
  return state?.facing ?? 'north';
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
      return frontFacing === counterClockwiseFacing(facing) ? 'inner_left' : 'inner_right';
    }
  }
  const backOff = HORIZONTAL_OFFSET[oppositeFacing(facing)];
  const back = world.getBlock(x + backOff[0], y, z + backOff[2], false);
  if (isStairBlock(back) && defaultStairHalf(world.getBlockState?.(x + backOff[0], y, z + backOff[2])) === half) {
    const backFacing = defaultStairFacing(world.getBlockState?.(x + backOff[0], y, z + backOff[2]));
    if (facingAxis(backFacing) !== facingAxis(facing)
      && stairCanTakeShape(world, x, y, z, state, backFacing)) {
      return backFacing === counterClockwiseFacing(facing) ? 'outer_left' : 'outer_right';
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

export function leverHandleAngle(powered: boolean): number {
  return powered ? -Math.PI * 0.28 : Math.PI * 0.28;
}

export interface OrientedSelectionBox {
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly matrix: THREE.Matrix4;
}

const _wall = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _scale = new THREE.Matrix4();

/** Flame tilts away from the supporting wall. Positive used to pitch the flame into the wall. */
export const TORCH_WALL_TILT = -0.40;
/** World-space stick size; cropped to the opaque 4×20 px region of torch.png. */
export const TORCH_WIDTH = 0.22;
export const TORCH_HEIGHT = 0.88;
/** Keep the back face just off the supporting voxel to avoid z-fighting. */
export const TORCH_WALL_INSET = 0.02;
/** Tile UV of the opaque torch pixels in torch.png (32×32, v=0 at image bottom). */
export const TORCH_TEXTURE_UV = [14 / 32, 0, 18 / 32, 20 / 32] as const;

export function facingVector(facing: HorizontalFacing, target = new THREE.Vector3()): THREE.Vector3 {
  switch (facing) {
    case 'north': return target.set(0, 0, -1);
    case 'south': return target.set(0, 0, 1);
    case 'east': return target.set(1, 0, 0);
    case 'west': return target.set(-1, 0, 0);
  }
}

export function torchOrigin(
  x: number,
  y: number,
  z: number,
  attachment: BlockAttachment,
  facing: HorizontalFacing,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  target.set(x + 0.5, y + (attachment === 'wall' ? 0.2 : 0), z + 0.5);
  if (attachment === 'wall') {
    target.addScaledVector(facingVector(facing, _wall), -0.5 + TORCH_WALL_INSET);
  }
  return target;
}

export function torchTiltAxis(
  attachment: BlockAttachment,
  facing: HorizontalFacing,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  if (attachment !== 'wall') return target.set(1, 0, 0);
  return target.crossVectors(facingVector(facing, _wall), _up).normalize();
}

/**
 * Maps local torch space (base at y=0, flame at y=TORCH_HEIGHT, XZ centered)
 * into the voxel cell. Wall torches offset by half-width along facing so the
 * back face sits on the supporting wall instead of centering in the cell.
 */
export function torchLocalMatrix(
  x: number,
  y: number,
  z: number,
  attachment: BlockAttachment,
  facing: HorizontalFacing,
  extraYaw = 0,
): THREE.Matrix4 {
  torchOrigin(x, y, z, attachment, facing, _origin);
  const tilt = attachment === 'wall' ? TORCH_WALL_TILT : 0;
  torchTiltAxis(attachment, facing, _axis);
  const matrix = new THREE.Matrix4().makeTranslation(_origin.x, _origin.y, _origin.z);
  matrix.multiply(_rotation.makeRotationAxis(_axis, tilt));
  if (attachment === 'wall') {
    facingVector(facing, _wall);
    matrix.multiply(_offset.makeTranslation(
      _wall.x * TORCH_WIDTH * 0.5,
      0,
      _wall.z * TORCH_WIDTH * 0.5,
    ));
  }
  if (extraYaw !== 0) matrix.multiply(new THREE.Matrix4().makeRotationY(extraYaw));
  return matrix;
}

export function torchEndpoints(
  x: number,
  y: number,
  z: number,
  attachment: BlockAttachment,
  facing: HorizontalFacing,
): { base: THREE.Vector3; flame: THREE.Vector3 } {
  const matrix = torchLocalMatrix(x, y, z, attachment, facing);
  return {
    base: new THREE.Vector3(0, 0.02, 0).applyMatrix4(matrix),
    flame: new THREE.Vector3(0, TORCH_HEIGHT - 0.04, 0).applyMatrix4(matrix),
  };
}

export function attachmentNormal(
  attachment: BlockAttachment,
  facing: HorizontalFacing,
): THREE.Vector3 {
  if (attachment === 'floor') return new THREE.Vector3(0, 1, 0);
  if (attachment === 'ceiling') return new THREE.Vector3(0, -1, 0);
  return facingVector(facing);
}

function surfaceBasis(attachment: BlockAttachment, facing: HorizontalFacing): THREE.Matrix4 {
  const normal = attachmentNormal(attachment, facing);
  const localZ = attachment === 'wall' ? new THREE.Vector3(0, 1, 0) : facingVector(facing);
  const localX = new THREE.Vector3().crossVectors(normal, localZ);
  if (localX.lengthSq() < 1e-6) localX.set(1, 0, 0);
  localX.normalize();
  return new THREE.Matrix4().makeBasis(localX, normal, localZ);
}

function boxFromSize(
  center: THREE.Vector3,
  size: readonly [number, number, number],
  basis?: THREE.Matrix4,
): OrientedSelectionBox {
  const matrix = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
  if (basis) matrix.multiply(basis);
  matrix.multiply(_scale.makeScale(size[0], size[1], size[2]));
  return { center: [center.x, center.y, center.z], size, matrix };
}

function selectionBoxesFromLocal(x: number, y: number, z: number, boxes: readonly LocalBox[]): OrientedSelectionBox[] {
  return boxes.map((box) => boxFromSize(
    new THREE.Vector3(
      x + (box.minX + box.maxX) / 2,
      y + (box.minY + box.maxY) / 2,
      z + (box.minZ + box.maxZ) / 2,
    ),
    [
      Math.max(0.01, box.maxX - box.minX) + 0.008,
      Math.max(0.01, box.maxY - box.minY) + 0.008,
      Math.max(0.01, box.maxZ - box.minZ) + 0.008,
    ],
  ));
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

export function defaultRailShape(state: BlockRenderState | undefined): RailShape {
  return state?.railShape ?? 'north_south';
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

const FULL_BLOCK: LocalBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
const CROSS_BOX: LocalBox = { minX: 0.275, minY: 0, minZ: 0.275, maxX: 0.725, maxY: 0.9, maxZ: 0.725 };
const COBWEB_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 1, maxZ: 15 / 16 };
const FIRE_BOX: LocalBox = { minX: 0.2, minY: 0, minZ: 0.2, maxX: 0.8, maxY: 1, maxZ: 0.8 };
const WIRE_BOX: LocalBox = { minX: 0.05, minY: 0, minZ: 0.05, maxX: 0.95, maxY: 0.0625, maxZ: 0.95 };
const CACTUS_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 1, maxZ: 15 / 16 };
const CHEST_BOX: LocalBox = { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: 14 / 16, maxZ: 15 / 16 };

function plateLocalBox(powered: boolean): LocalBox {
  const height = powered ? 0.03125 : 0.0625;
  return { minX: 1 / 16, minY: 0, minZ: 1 / 16, maxX: 15 / 16, maxY: height, maxZ: 15 / 16 };
}

function ladderLocalBox(facing: HorizontalFacing): LocalBox {
  const plane = ladderPlaneLocal(facing);
  if (plane.axis === 'x') {
    return { minX: plane.min, minY: 0, minZ: 0, maxX: plane.max, maxY: 1, maxZ: 1 };
  }
  return { minX: 0, minY: 0, minZ: plane.min, maxX: 1, maxY: 1, maxZ: plane.max };
}

function doorLocalBox(state: BlockRenderState | undefined): LocalBox {
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

function torchLocalBoxes(state: BlockRenderState | undefined): LocalBox[] {
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

/** Cached local envelopes of the very same oriented cuboids used by mesh/outline.
 * A tilted lever handle has a small conservative AABB, never a full voxel.
 */
const controlBoxCache = new Map<string, LocalBox[]>();
function controlLocalBoxes(block: BlockId, state: BlockRenderState | undefined): LocalBox[] {
  const key = `${block}:${state?.attachment}:${state?.facing}:${state?.powered === true}`;
  let boxes = controlBoxCache.get(key);
  if (!boxes) {
    const parts = block === BlockId.StoneButton
      ? [buttonSelectionBox(0, 0, 0, state)] : leverSelectionBoxes(0, 0, 0, state);
    boxes = parts.map((part) => {
      const bounds = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
        .applyMatrix4(part.matrix);
      return { minX: bounds.min.x, minY: bounds.min.y, minZ: bounds.min.z,
        maxX: bounds.max.x, maxY: bounds.max.y, maxZ: bounds.max.z };
    });
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
    case 'cube':
    default:
      return [FULL_BLOCK];
  }
}

export function selectionBoxesForBlock(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state?: BlockRenderState,
  x = 0,
  y = 0,
  z = 0,
  world?: BlockNeighborView,
  stairShape: StairShape = 'straight',
): OrientedSelectionBox[] {
  switch (definition.renderShape) {
    case 'torch': return [torchSelectionBox(x, y, z, state)];
    case 'button': return [buttonSelectionBox(x, y, z, state)];
    case 'lever': return leverSelectionBoxes(x, y, z, state);
    case 'pressure_plate': return [pressurePlateSelectionBox(x, y, z, state)];
    case 'wire': return [wireSelectionBox(x, y, z)];
    case 'door': return [doorSelectionBox(x, y, z, state)];
    case 'ladder': return [ladderSelectionBox(x, y, z, state)];
    case 'cross': return [crossSelectionBox(x, y, z)];
    case 'fire': return [crossSelectionBox(x, y, z)];
    case 'stairs': {
      const shape = world ? resolveStairShape(world, x, y, z, state) : stairShape;
      return selectionBoxesFromLocal(
        x, y, z,
        stairLocalBoxes(defaultStairFacing(state), defaultStairHalf(state), shape),
      );
    }
    case 'slab':
      return selectionBoxesFromLocal(x, y, z, slabLocalBoxes(defaultSlabType(state)));
    case 'chest':
      return selectionBoxesFromLocal(x, y, z, [{
        minX: 1 / 16, minY: 0, minZ: 1 / 16,
        maxX: 15 / 16, maxY: 14 / 16, maxZ: 15 / 16,
      }]);
    case 'fence': {
      const connections = world
        ? fenceConnections(world, x, y, z)
        : { north: false, south: false, east: false, west: false };
      return selectionBoxesFromLocal(x, y, z, fenceLocalBoxes(connections, 1));
    }
    case 'rail':
      return selectionBoxesFromLocal(x, y, z, railLocalBoxes(defaultRailShape(state)));
    case 'cube': return [cubeSelectionBox(x, y, z)];
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

function cubeSelectionBox(x: number, y: number, z: number): OrientedSelectionBox {
  return boxFromSize(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), [1.008, 1.008, 1.008]);
}

function torchSelectionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox {
  const attachment = state?.attachment ?? 'floor';
  const facing = state?.facing ?? 'north';
  const local = torchLocalMatrix(x, y, z, attachment, facing);
  const center = new THREE.Vector3(0, TORCH_HEIGHT * 0.5, 0).applyMatrix4(local);
  const matrix = local
    .multiply(_offset.makeTranslation(0, TORCH_HEIGHT * 0.5, 0))
    .multiply(_scale.makeScale(TORCH_WIDTH, TORCH_HEIGHT, TORCH_WIDTH));
  return {
    center: [center.x, center.y, center.z],
    size: [TORCH_WIDTH, TORCH_HEIGHT, TORCH_WIDTH],
    matrix,
  };
}

export function buttonSelectionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox {
  const attachment = state?.attachment ?? 'wall';
  const facing = state?.facing ?? 'south';
  const depth = state?.powered ? 0.06 : 0.125;
  const normal = attachmentNormal(attachment, facing);
  const basis = surfaceBasis(attachment, facing);
  const surface = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5).addScaledVector(normal, -0.5);
  const center = surface.clone().addScaledVector(normal, depth / 2);
  return boxFromSize(center, [0.375, depth, 0.22], basis);
}

export function leverSelectionBoxes(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox[] {
  const attachment = state?.attachment ?? 'floor';
  const facing = state?.facing ?? 'north';
  const normal = attachmentNormal(attachment, facing);
  const basis = surfaceBasis(attachment, facing);
  const surface = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5).addScaledVector(normal, -0.5);
  const baseThickness = 0.125;
  const baseCenter = surface.clone().addScaledVector(normal, baseThickness / 2);
  const handleLength = 0.625;
  const pivot = surface.clone().addScaledVector(normal, baseThickness);
  const handleMatrix = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(basis)
    .multiply(new THREE.Matrix4().makeRotationX(leverHandleAngle(state?.powered === true)))
    .multiply(new THREE.Matrix4().makeTranslation(0, handleLength / 2, 0))
    .multiply(_scale.makeScale(0.125, handleLength, 0.125));
  return [
    boxFromSize(baseCenter, [0.5, baseThickness, 0.375], basis),
    { center: [pivot.x, pivot.y, pivot.z], size: [0.125, handleLength, 0.125], matrix: handleMatrix },
  ];
}

function pressurePlateSelectionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox {
  const height = state?.powered ? 0.03125 : 0.0625;
  return boxFromSize(new THREE.Vector3(x + 0.5, y + height / 2, z + 0.5), [0.875, height, 0.875]);
}

function wireSelectionBox(x: number, y: number, z: number): OrientedSelectionBox {
  return boxFromSize(new THREE.Vector3(x + 0.5, y + 0.02, z + 0.5), [0.9, 0.04, 0.9]);
}

function doorSelectionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox {
  const occupied = occupiedDoorFacing(
    state?.facing ?? 'north',
    state?.open === true,
    state?.hinge ?? 'left',
  );
  const thickness = DOOR_THICKNESS;
  switch (occupied) {
    case 'north':
      return boxFromSize(new THREE.Vector3(x + 0.5, y + 0.5, z + thickness / 2), [1, 1, thickness]);
    case 'south':
      return boxFromSize(new THREE.Vector3(x + 0.5, y + 0.5, z + 1 - thickness / 2), [1, 1, thickness]);
    case 'west':
      return boxFromSize(new THREE.Vector3(x + thickness / 2, y + 0.5, z + 0.5), [thickness, 1, 1]);
    case 'east':
      return boxFromSize(new THREE.Vector3(x + 1 - thickness / 2, y + 0.5, z + 0.5), [thickness, 1, 1]);
  }
}

function ladderSelectionBox(
  x: number,
  y: number,
  z: number,
  state: BlockRenderState | undefined,
): OrientedSelectionBox {
  const plane = ladderPlaneLocal(state?.facing ?? 'north');
  if (plane.axis === 'x') {
    return boxFromSize(
      new THREE.Vector3(x + (plane.min + plane.max) / 2, y + 0.5, z + 0.5),
      [LADDER_DEPTH, 1, 1],
    );
  }
  return boxFromSize(
    new THREE.Vector3(x + 0.5, y + 0.5, z + (plane.min + plane.max) / 2),
    [1, 1, LADDER_DEPTH],
  );
}

function crossSelectionBox(x: number, y: number, z: number): OrientedSelectionBox {
  return boxFromSize(new THREE.Vector3(x + 0.5, y + 0.45, z + 0.5), [0.45, 0.9, 0.45]);
}

export function createSelectionGeometry(boxes: readonly OrientedSelectionBox[]): THREE.BufferGeometry {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(unit);
  const source = edges.getAttribute('position');
  const positions = new Float32Array(source.count * 3 * boxes.length);
  const vertex = new THREE.Vector3();
  let offset = 0;
  for (const box of boxes) {
    for (let index = 0; index < source.count; index += 1) {
      vertex.fromBufferAttribute(source, index).applyMatrix4(box.matrix);
      positions[offset] = vertex.x;
      positions[offset + 1] = vertex.y;
      positions[offset + 2] = vertex.z;
      offset += 3;
    }
  }
  unit.dispose();
  edges.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
