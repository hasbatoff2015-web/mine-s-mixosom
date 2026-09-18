import type { Object3D } from 'three';
import { itemRenderProfile, type ItemRenderCategory } from '../../items';

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
 * Production third-person held transforms, keyed by render category.
 * Numbers match the historical `PlayerVisual.applyHeldItemTransform` defaults.
 * The `/moveitems` calibrator reads these as RESET; it does not write them back.
 */
export const THIRD_PERSON_HELD_ITEM_DEFAULTS: Readonly<Record<ItemRenderCategory, ThirdPersonHeldItemTransform>> = Object.freeze({
  block: pose(vec(0, -0.02, -0.02), vec(-0.55, 0.45, -0.28), 0.24),
  generated: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, -0.72), 0.40),
  handheld: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, -0.72), 0.55),
  bow: pose(vec(0, -0.04, -0.06), vec(-0.16, 0, 0.85), 0.46),
});

export function defaultThirdPersonHeldItemTransform(
  category: ItemRenderCategory,
): ThirdPersonHeldItemTransform {
  return cloneThirdPersonHeldItemTransform(THIRD_PERSON_HELD_ITEM_DEFAULTS[category]);
}

export function defaultThirdPersonHeldItemTransformForItem(itemId: string): ThirdPersonHeldItemTransform {
  return defaultThirdPersonHeldItemTransform(itemRenderProfile(itemId).category);
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
