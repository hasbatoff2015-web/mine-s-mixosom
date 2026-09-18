import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import {
  classifyItemForRendering,
  getItemDefinition,
  type ItemDefinition,
  type ItemRenderCategory,
} from '../../items';

/** Live/production third-person held-item pose used by `PlayerVisual` / remote players. */
export interface ThirdPersonHeldItemTransform {
  readonly position: { x: number; y: number; z: number };
  /** Euler XYZ radians, matching `Object3D.rotation.set`. */
  readonly rotation: { x: number; y: number; z: number };
  readonly scale: { x: number; y: number; z: number };
}

function vec(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z };
}

function pose(
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
  scale: number,
): ThirdPersonHeldItemTransform {
  return Object.freeze({
    position: Object.freeze(position),
    rotation: Object.freeze(rotation),
    scale: Object.freeze(vec(scale, scale, scale)),
  });
}

/**
 * Third-person pose kind. `ItemRenderCategory` still owns first-person/mesh routing.
 * Swords, axes and other `kind: 'tool'` items share `handheld` there, but use
 * distinct third-person poses.
 */
export type ThirdPersonHeldItemPoseKind = ItemRenderCategory | 'sword' | 'tool' | 'axe';

const SWORD_ROTATION = vec(-0.1232, 1.4668, -0.1232);
const TOOL_POSE = pose(vec(0, 0.215, -0.155), SWORD_ROTATION, 0.55);

/**
 * Generated-item handle runs along the sprite diagonal (texture bottom-left →
 * top-right = local +X+Y). A 180° roll around that axis keeps the tool tilt
 * and flips the head to the other side of the handle.
 */
export const AXE_HANDLE_LOCAL_AXIS = Object.freeze({ x: 1, y: 1, z: 0 });
export const AXE_HANDLE_FLIP_RADIANS = Math.PI;

export function flipAroundLocalAxis(
  transform: ThirdPersonHeldItemTransform,
  axis: { readonly x: number; readonly y: number; readonly z: number },
  radians = Math.PI,
): ThirdPersonHeldItemTransform {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ'),
  );
  quaternion.multiply(new Quaternion().setFromAxisAngle(
    new Vector3(axis.x, axis.y, axis.z).normalize(),
    radians,
  ));
  const next = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: { ...transform.position },
    rotation: { x: next.x, y: next.y, z: next.z },
    scale: { ...transform.scale },
  };
}

/**
 * Production third-person held transforms for `PlayerVisual` / remote players.
 * `block` / `generated` / `handheld` / `bow` keep the historical numbers.
 * `sword` / `tool` / `axe` are group poses, not per-item overrides.
 */
export const THIRD_PERSON_HELD_ITEM_DEFAULTS: Readonly<Record<ThirdPersonHeldItemPoseKind, ThirdPersonHeldItemTransform>> = Object.freeze({
  block: pose(vec(0, -0.02, -0.02), vec(-0.55, 0.45, -0.28), 0.24),
  generated: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, -0.72), 0.40),
  handheld: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, -0.72), 0.55),
  bow: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, 0.85), 0.46),
  sword: pose(vec(0, 0.225, -0.245), SWORD_ROTATION, 0.55),
  tool: TOOL_POSE,
  axe: pose(
    vec(TOOL_POSE.position.x, TOOL_POSE.position.y, TOOL_POSE.position.z),
    flipAroundLocalAxis(TOOL_POSE, AXE_HANDLE_LOCAL_AXIS, AXE_HANDLE_FLIP_RADIANS).rotation,
    TOOL_POSE.scale.x,
  ),
});

export function isThirdPersonSwordItem(itemOrId: string | ItemDefinition): boolean {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  return item.kind === 'weapon' && item.weapon === 'sword';
}

export function isThirdPersonAxeItem(itemOrId: string | ItemDefinition): boolean {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  return item.kind === 'tool' && item.tool === 'axe';
}

export function isThirdPersonToolItem(itemOrId: string | ItemDefinition): boolean {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  return item.kind === 'tool';
}

export function classifyThirdPersonHeldItem(itemOrId: string | ItemDefinition): ThirdPersonHeldItemPoseKind {
  if (isThirdPersonSwordItem(itemOrId)) return 'sword';
  if (isThirdPersonAxeItem(itemOrId)) return 'axe';
  if (isThirdPersonToolItem(itemOrId)) return 'tool';
  return classifyItemForRendering(itemOrId);
}

export function defaultThirdPersonHeldItemTransform(
  kind: ThirdPersonHeldItemPoseKind,
): ThirdPersonHeldItemTransform {
  return cloneThirdPersonHeldItemTransform(THIRD_PERSON_HELD_ITEM_DEFAULTS[kind]);
}

export function defaultThirdPersonHeldItemTransformForItem(itemId: string): ThirdPersonHeldItemTransform {
  return defaultThirdPersonHeldItemTransform(classifyThirdPersonHeldItem(itemId));
}

export function cloneThirdPersonHeldItemTransform(
  transform: ThirdPersonHeldItemTransform,
): ThirdPersonHeldItemTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

export function applyThirdPersonHeldItemTransform(
  model: Object3D,
  transform: ThirdPersonHeldItemTransform,
): void {
  model.position.set(transform.position.x, transform.position.y, transform.position.z);
  model.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  model.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

export function readThirdPersonHeldItemTransform(model: Object3D): ThirdPersonHeldItemTransform {
  return {
    position: { x: model.position.x, y: model.position.y, z: model.position.z },
    rotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z },
    scale: { x: model.scale.x, y: model.scale.y, z: model.scale.z },
  };
}

export function formatThirdPersonHeldScalar(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function formatVec(label: string, vec: { x: number; y: number; z: number }): string {
  return [
    `${label}:`,
    `  x: ${formatThirdPersonHeldScalar(vec.x)}`,
    `  y: ${formatThirdPersonHeldScalar(vec.y)}`,
    `  z: ${formatThirdPersonHeldScalar(vec.z)}`,
  ].join('\n');
}

export function formatThirdPersonHeldItemCopy(
  itemId: string,
  transform: ThirdPersonHeldItemTransform,
): string {
  return [
    `Item: ${itemId}`,
    '',
    formatVec('position', transform.position),
    '',
    formatVec('rotation', transform.rotation),
    '',
    formatVec('scale', transform.scale),
  ].join('\n');
}

export function formatThirdPersonHeldItemCopyAll(
  entries: ReadonlyArray<{ readonly itemId: string; readonly transform: ThirdPersonHeldItemTransform }>,
): string {
  return entries
    .map(({ itemId, transform }) => formatThirdPersonHeldItemCopy(itemId, transform))
    .join('\n\n');
}

export function thirdPersonHeldTransformsClose(
  a: ThirdPersonHeldItemTransform,
  b: ThirdPersonHeldItemTransform,
  epsilon = 1e-6,
): boolean {
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    if (Math.abs(a.position[axis] - b.position[axis]) > epsilon) return false;
    if (Math.abs(a.rotation[axis] - b.rotation[axis]) > epsilon) return false;
    if (Math.abs(a.scale[axis] - b.scale[axis]) > epsilon) return false;
  }
  return true;
}

/** Per-item live poses for the `/moveitems` calibrator. Does not write production defaults. */
export class ThirdPersonHeldItemCalibratorState {
  private readonly poses = new Map<string, ThirdPersonHeldItemTransform>();

  get(itemId: string): ThirdPersonHeldItemTransform {
    const stored = this.poses.get(itemId);
    return stored
      ? cloneThirdPersonHeldItemTransform(stored)
      : defaultThirdPersonHeldItemTransformForItem(itemId);
  }

  set(itemId: string, transform: ThirdPersonHeldItemTransform): ThirdPersonHeldItemTransform {
    const next = cloneThirdPersonHeldItemTransform(transform);
    this.poses.set(itemId, next);
    return cloneThirdPersonHeldItemTransform(next);
  }

  reset(itemId: string): ThirdPersonHeldItemTransform {
    this.poses.delete(itemId);
    return this.get(itemId);
  }

  remember(itemId: string): ThirdPersonHeldItemTransform {
    if (!this.poses.has(itemId)) this.poses.set(itemId, this.get(itemId));
    return this.get(itemId);
  }

  entries(): Array<{ itemId: string; transform: ThirdPersonHeldItemTransform }> {
    return [...this.poses.entries()].map(([itemId, transform]) => ({
      itemId,
      transform: cloneThirdPersonHeldItemTransform(transform),
    }));
  }
}
