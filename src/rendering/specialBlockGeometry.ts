import * as THREE from 'three';
import type { BlockAttachment, BlockDefinition, BlockRenderState, HorizontalFacing } from '../blocks';

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
export const TORCH_WALL_TILT = -0.38;

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
  target.set(x + 0.5, y + (attachment === 'wall' ? 0.22 : 0), z + 0.5);
  if (attachment === 'wall') target.addScaledVector(facingVector(facing, _wall), -0.28);
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

/** Maps local torch space (base at y≈0, flame at y≈0.8) into the voxel cell. */
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
    flame: new THREE.Vector3(0, 0.8, 0).applyMatrix4(matrix),
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

export function selectionBoxesForBlock(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state?: BlockRenderState,
  x = 0,
  y = 0,
  z = 0,
): OrientedSelectionBox[] {
  switch (definition.renderShape) {
    case 'torch': return [torchSelectionBox(x, y, z, state)];
    case 'button': return [buttonSelectionBox(x, y, z, state)];
    case 'lever': return leverSelectionBoxes(x, y, z, state);
    case 'pressure_plate': return [pressurePlateSelectionBox(x, y, z, state)];
    case 'wire': return [wireSelectionBox(x, y, z)];
    case 'door': return [doorSelectionBox(x, y, z, state)];
    case 'cross': return [crossSelectionBox(x, y, z)];
    case 'cube': return [cubeSelectionBox(x, y, z)];
  }
}

export function selectionShapeKey(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state?: BlockRenderState,
): string {
  return [
    definition.renderShape,
    state?.attachment ?? '',
    state?.facing ?? '',
    state?.powered === true ? '1' : '0',
    state?.open === true ? '1' : '0',
    state?.half ?? '',
    state?.hinge ?? '',
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
  torchOrigin(x, y, z, attachment, facing, _origin);
  const tilt = attachment === 'wall' ? TORCH_WALL_TILT : 0;
  torchTiltAxis(attachment, facing, _axis);
  const matrix = new THREE.Matrix4()
    .makeTranslation(_origin.x, _origin.y, _origin.z)
    .multiply(_rotation.makeRotationAxis(_axis, tilt))
    .multiply(_offset.makeTranslation(0, 0.41, 0))
    .multiply(_scale.makeScale(0.14, 0.8, 0.14));
  return { center: [_origin.x, _origin.y + 0.41, _origin.z], size: [0.14, 0.8, 0.14], matrix };
}

function buttonSelectionBox(
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

function leverSelectionBoxes(
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
  const facing = state?.facing ?? 'north';
  const open = state?.open === true;
  const hinge = state?.hinge ?? 'left';
  const occupied = open
    ? (hinge === 'left'
      ? ({ north: 'west', west: 'south', south: 'east', east: 'north' } as const)[facing]
      : ({ north: 'east', east: 'south', south: 'west', west: 'north' } as const)[facing])
    : facing;
  const thickness = 3 / 16;
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
