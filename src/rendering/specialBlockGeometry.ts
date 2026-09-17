/**
 * Rendering wrappers over simulation block geometry: Three.js matrices,
 * selection outlines, torch tilt, and lantern/chain mesh UVs.
 *
 * Collision, selection AABBs, placement normals, and neighbor shapes live in
 * `src/world/blockGeometry.ts`. Re-exports keep meshers on one definition set.
 */

import * as THREE from 'three';
import { BED_SHEET_KEY, SIGN_SHEET_KEY } from './TextureAtlas';

export type BedFaceDirection = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';
export interface BedFaceTexture {
  readonly uv: readonly [number, number, number, number];
  readonly rotation: 0 | 90 | 180 | 270;
}
export interface BedVisualPart {
  readonly texture: typeof BED_SHEET_KEY;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly faces: Partial<Record<BedFaceDirection, BedFaceTexture>>;
}

// Original entity sheet is 64x64 logical texels (128x128 in this pack).
// These rectangles are the bed head/foot and leg nets, in 0..16 sheet units.
function bedFace(u0: number, v0: number, u1: number, v1: number, rotation: BedFaceTexture['rotation'] = 0): BedFaceTexture {
  return { uv: [u0 / 16, 1 - v1 / 16, u1 / 16, 1 - v0 / 16], rotation };
}

const FOOT_BODY: BedVisualPart['faces'] = {
  east: bedFace(5.5, 7, 7, 11, 90),
  west: bedFace(0, 7, 1.5, 11, 270),
  up: bedFace(1.5, 7, 5.5, 11, 180),
  down: bedFace(7, 7, 11, 11),
  south: bedFace(5.5, 5.5, 9.5, 7, 180),
};
const HEAD_BODY: BedVisualPart['faces'] = {
  east: bedFace(5.5, 1.5, 7, 5.5, 90),
  west: bedFace(0, 1.5, 1.5, 5.5, 270),
  // The source's pillow occupies the low-V half. Our north-facing top quad
  // already maps low V to the north (head) edge; 180° put it by the seam.
  up: bedFace(1.5, 1.5, 5.5, 5.5),
  down: bedFace(7, 1.5, 11, 5.5),
  north: bedFace(1.5, 0, 5.5, 1.5, 180),
};
const FOOT_LEGS: readonly BedVisualPart['faces'][] = [
  { north: bedFace(14, 5.25, 14.75, 6), east: bedFace(13.25, 5.25, 14, 6),
    south: bedFace(12.5, 5.25, 13.25, 6), west: bedFace(14.75, 5.25, 15.5, 6),
    down: bedFace(14, 4.5, 14.75, 5.25) },
  { north: bedFace(14.75, 3.75, 15.5, 4.5), east: bedFace(14, 3.75, 14.75, 4.5),
    south: bedFace(14, 3.75, 13.25, 4.5), west: bedFace(12.5, 3.75, 13.25, 4.5),
    down: bedFace(14, 3, 14.75, 3.75) },
];
const HEAD_LEGS: readonly BedVisualPart['faces'][] = [
  { north: bedFace(13.25, 0.75, 14, 1.5), east: bedFace(12.5, 0.75, 13.25, 1.5),
    south: bedFace(14.75, 0.75, 15.5, 1.5), west: bedFace(14, 0.75, 14.75, 1.5),
    down: bedFace(14, 0, 14.75, 0.75) },
  { north: bedFace(12.5, 2.25, 13.25, 3), east: bedFace(14.75, 2.25, 15.5, 3),
    south: bedFace(14, 2.25, 14.75, 3), west: bedFace(13.25, 2.25, 14, 3),
    down: bedFace(14, 1.5, 14.75, 2.25) },
];

/** North-facing connected halves. The colored top, wooden frame/end caps, and legs all come from the sheet. */
export function bedVisualParts(part: 'head' | 'foot'): readonly BedVisualPart[] {
  const legs = part === 'head' ? HEAD_LEGS : FOOT_LEGS;
  const legZ = part === 'head' ? -13 / 32 : 13 / 32;
  return [
    { texture: BED_SHEET_KEY, center: [0, 6 / 16, 0], size: [1, 6 / 16, 1],
      faces: part === 'head' ? HEAD_BODY : FOOT_BODY },
    { texture: BED_SHEET_KEY, center: [-13 / 32, 3 / 32, legZ], size: [3 / 16, 3 / 16, 3 / 16], faces: legs[0]! },
    { texture: BED_SHEET_KEY, center: [13 / 32, 3 / 32, legZ], size: [3 / 16, 3 / 16, 3 / 16], faces: legs[1]! },
  ];
}

/** Full two-cell bed for inventory/held preview, centered on the origin. */
export function bedItemVisualParts(): readonly BedVisualPart[] {
  return [
    ...bedVisualParts('head').map((part) => ({
      ...part,
      center: [part.center[0], part.center[1], part.center[2] - 0.5] as const,
    })),
    ...bedVisualParts('foot').map((part) => ({
      ...part,
      center: [part.center[0], part.center[1], part.center[2] + 0.5] as const,
    })),
  ];
}

export interface SignVisualPart {
  readonly texture: typeof SIGN_SHEET_KEY;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly faces: Partial<Record<BedFaceDirection, BedFaceTexture>>;
}

// sign.png is 128x64, a 2x pack of the 64x32 ModelSign texture. Vanilla's
// board is a 24x12x2 box at (0,0); the 2x14x2 post starts at (0,14).
function signFace(u0: number, v0: number, u1: number, v1: number): BedFaceTexture {
  return { uv: [u0 / 64, 1 - v1 / 32, u1 / 64, 1 - v0 / 32], rotation: 0 };
}

const SIGN_BOARD: SignVisualPart['faces'] = {
  south: signFace(2, 2, 26, 14), // front, same +Z face as SignRenderer text
  north: signFace(28, 2, 52, 14),
  west: signFace(0, 2, 2, 14),
  east: signFace(26, 2, 28, 14),
  up: signFace(2, 0, 26, 2),
  down: signFace(26, 0, 50, 2),
};
const SIGN_POST: SignVisualPart['faces'] = {
  south: signFace(2, 22.4, 4, 30),
  north: signFace(6, 22.4, 8, 30),
  west: signFace(0, 22.4, 2, 30),
  east: signFace(4, 22.4, 6, 30),
};

/** ModelSign proportions scaled to fit the current cell-height sign placement. */
export function signVisualParts(attachment: 'floor' | 'wall'): readonly SignVisualPart[] {
  const board: SignVisualPart = {
    texture: SIGN_SHEET_KEY,
    center: [0, attachment === 'wall' ? 0.5 : 0.68, attachment === 'wall' ? 0.24 : 0],
    size: [1.2, 0.6, 0.1],
    faces: SIGN_BOARD,
  };
  return attachment === 'wall' ? [board] : [board, {
    texture: SIGN_SHEET_KEY,
    center: [0, 0.19, 0],
    size: [0.08, 0.38, 0.08],
    faces: SIGN_POST,
  }];
}
import type {
  BlockAttachment,
  BlockDefinition,
  BlockRenderState,
  DoorHinge,
  HorizontalFacing,
  StairShape,
} from '../blocks';
import { occupiedDoorFacing } from '../blocks';
import {
  DOOR_THICKNESS,
  LADDER_DEPTH,
  TORCH_HEIGHT,
  TORCH_WALL_INSET,
  TORCH_WIDTH,
  attachmentNormal as simAttachmentNormal,
  defaultRailShape,
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  facingVector as simFacingVector,
  fenceConnections,
  fenceLocalBoxes,
  ladderPlaneLocal,
  lanternSelectionLocalBox,
  chainSelectionLocalBox,
  leverHandleAngle,
  railLocalBoxes,
  resolveStairShape,
  slabLocalBoxes,
  stairLocalBoxes,
  type BlockNeighborView,
  type LocalBox,
} from '../world/blockGeometry';

export type { BlockNeighborView, GeometryVec3, LocalBox } from '../world/blockGeometry';

export {
  CACTUS_BOX,
  CHEST_BOX,
  CROSS_BOX,
  COBWEB_BOX,
  DOOR_THICKNESS,
  FARMLAND_BOX,
  FIRE_BOX,
  FULL_BLOCK,
  LADDER_DEPTH,
  LADDER_PLANE,
  TORCH_HEIGHT,
  TORCH_WALL_INSET,
  TORCH_WIDTH,
  WIRE_BOX,
  blockOccludesFaces,
  buttonLocalBoxes,
  chainSelectionLocalBox,
  controlLocalBoxes,
  defaultRailShape,
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  doorLocalBox,
  fenceConnects,
  fenceConnections,
  fenceLocalBoxes,
  isolatedRailShapeFromYaw,
  isHangingLantern,
  isRailAt,
  ladderPlaneLocal,
  lanternSelectionLocalBox,
  leverHandleAngle,
  leverLocalBoxes,
  railLocalBoxes,
  railRunsEastWest,
  railTextureYaw,
  resolveRailShape,
  resolveStairShape,
  selectionLocalBoxes,
  selectionShapeKey,
  slabLocalBoxes,
  stairLocalBoxes,
} from '../world/blockGeometry';

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
/** Tile UV of the opaque torch pixels in torch.png (32×32, v=0 at image bottom). */
export const TORCH_TEXTURE_UV = [14 / 32, 0, 18 / 32, 20 / 32] as const;

export function facingVector(facing: HorizontalFacing, target = new THREE.Vector3()): THREE.Vector3 {
  const v = simFacingVector(facing);
  return target.set(v.x, v.y, v.z);
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
  const v = simAttachmentNormal(attachment, facing);
  return new THREE.Vector3(v.x, v.y, v.z);
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

/** Vanilla lantern.png UV in tile space (v=0 at image bottom). Minecraft v is from the top. */
function lanternMcUv(u0: number, vTop: number, u1: number, vBottom: number): TextureUvRect {
  return [u0 / 16, 1 - vBottom / 16, u1 / 16, 1 - vTop / 16];
}

export const LANTERN_BODY_UV = lanternMcUv(0, 9, 6, 15);
export const LANTERN_BODY_TOP_UV = lanternMcUv(0, 3, 6, 9);
export const LANTERN_CAP_SIDE_UV = lanternMcUv(1, 1, 5, 3);
export const LANTERN_CAP_END_UV = lanternMcUv(1, 10, 5, 14);
export const LANTERN_HANGER_UV = lanternMcUv(11, 1, 14, 3);
export const CHAIN_PLANE_A_UV: TextureUvRect = [0, 0, 3 / 16, 1];
export const CHAIN_PLANE_B_UV: TextureUvRect = [3 / 16, 0, 6 / 16, 1];

export interface LanternMeshCuboid {
  readonly box: LocalBox;
  readonly uvDown: TextureUvRect;
  readonly uvUp: TextureUvRect;
  readonly uvSide: TextureUvRect;
}

export interface LanternMeshPlane {
  readonly corners: readonly (readonly [number, number, number])[];
  readonly uv: TextureUvRect;
}

/**
 * Minecraft-style lantern: metal cage, inner glow, cap, and a short hanger
 * (standing) or a chain that continues to the ceiling (hanging).
 */
export function lanternMeshCuboids(state: BlockRenderState | undefined): readonly LanternMeshCuboid[] {
  const hang = state?.attachment === 'ceiling';
  const bodyY = hang ? 2 / 16 : 1 / 16;
  const bodyTop = bodyY + 6 / 16;
  const capTop = bodyTop + 2 / 16;
  return [
    {
      box: { minX: 5 / 16, minY: bodyY, minZ: 5 / 16, maxX: 11 / 16, maxY: bodyTop, maxZ: 11 / 16 },
      uvDown: LANTERN_BODY_UV,
      uvUp: LANTERN_BODY_TOP_UV,
      uvSide: LANTERN_BODY_UV,
    },
    {
      box: { minX: 6.5 / 16, minY: bodyY + 0.5 / 16, minZ: 6.5 / 16, maxX: 9.5 / 16, maxY: bodyTop - 0.5 / 16, maxZ: 9.5 / 16 },
      uvDown: LANTERN_BODY_TOP_UV,
      uvUp: LANTERN_BODY_TOP_UV,
      uvSide: LANTERN_BODY_TOP_UV,
    },
    {
      box: { minX: 6 / 16, minY: bodyTop, minZ: 6 / 16, maxX: 10 / 16, maxY: capTop, maxZ: 10 / 16 },
      uvDown: LANTERN_CAP_END_UV,
      uvUp: LANTERN_CAP_END_UV,
      uvSide: LANTERN_CAP_SIDE_UV,
    },
  ];
}

/** Crossed hanger / hanging-chain quads in cell-local space. */
export function lanternHangerPlanes(state: BlockRenderState | undefined): readonly LanternMeshPlane[] {
  const hang = state?.attachment === 'ceiling';
  const y0 = hang ? 10 / 16 : 9 / 16;
  const y1 = hang ? 1 : 12 / 16;
  const mid = 8 / 16;
  const half = 1.5 / 16;
  return [
    {
      corners: [
        [mid - half, y0, mid],
        [mid + half, y0, mid],
        [mid + half, y1, mid],
        [mid - half, y1, mid],
      ],
      uv: LANTERN_HANGER_UV,
    },
    {
      corners: [
        [mid, y0, mid - half],
        [mid, y0, mid + half],
        [mid, y1, mid + half],
        [mid, y1, mid - half],
      ],
      uv: LANTERN_HANGER_UV,
    },
  ];
}

export interface ChainMeshPlane {
  readonly corners: readonly (readonly [number, number, number])[];
  readonly uv: TextureUvRect;
}

/** Two vertical 3/16 planes, matching vanilla chain.json. */
export function chainMeshPlanes(): readonly ChainMeshPlane[] {
  const lo = 6.5 / 16;
  const hi = 9.5 / 16;
  const mid = 8 / 16;
  return [
    {
      corners: [
        [lo, 0, mid],
        [hi, 0, mid],
        [hi, 1, mid],
        [lo, 1, mid],
      ],
      uv: CHAIN_PLANE_A_UV,
    },
    {
      corners: [
        [mid, 0, lo],
        [mid, 0, hi],
        [mid, 1, hi],
        [mid, 1, lo],
      ],
      uv: CHAIN_PLANE_B_UV,
    },
  ];
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
    case 'lantern':
      return selectionBoxesFromLocal(x, y, z, [lanternSelectionLocalBox(state)]);
    case 'chain':
      return selectionBoxesFromLocal(x, y, z, [chainSelectionLocalBox()]);
    case 'farmland':
      return selectionBoxesFromLocal(x, y, z, [{
        minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 15 / 16, maxZ: 1,
      }]);
    case 'bed':
      return selectionBoxesFromLocal(x, y, z, [{
        minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 9 / 16, maxZ: 1,
      }]);
    case 'sign':
      return selectionBoxesFromLocal(x, y, z, [{
        minX: 0.05, minY: state?.attachment === 'wall' ? 0.28 : 0,
        minZ: 0.05, maxX: 0.95, maxY: 0.92, maxZ: 0.95,
      }]);
    case 'cube': return [cubeSelectionBox(x, y, z)];
  }
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
