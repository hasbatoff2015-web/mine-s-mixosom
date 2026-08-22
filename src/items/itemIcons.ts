import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
import type { ItemDefinition } from './types';
import { itemHeldMeshKind } from './itemRenderProfiles';

export type SpecialIconCategory = 'stairs' | 'slab' | 'button' | 'pressure_plate' | 'chest';

export interface SpecialIconPose {
  readonly rotationDeg: readonly [number, number, number];
}

/** Shared isometric preview angle. Size is auto-fit from bounds, not padding. */
export const SPECIAL_ICON_ROTATION_DEG = [30, 225, 0] as const;

/**
 * Dominant projected dimension occupies this fraction of the square target.
 * Leaves a small margin so the model does not touch the slot frame.
 */
export const SPECIAL_ICON_FILL = 0.86;

export const SPECIAL_ICON_POSES: Readonly<Record<SpecialIconCategory, SpecialIconPose>> = Object.freeze({
  stairs: Object.freeze({ rotationDeg: SPECIAL_ICON_ROTATION_DEG }),
  slab: Object.freeze({ rotationDeg: SPECIAL_ICON_ROTATION_DEG }),
  button: Object.freeze({ rotationDeg: SPECIAL_ICON_ROTATION_DEG }),
  pressure_plate: Object.freeze({ rotationDeg: SPECIAL_ICON_ROTATION_DEG }),
  chest: Object.freeze({ rotationDeg: SPECIAL_ICON_ROTATION_DEG }),
});

export type ItemIconKind = 'texture' | 'special_preview';

export interface ItemIconDescriptor {
  readonly kind: ItemIconKind;
  readonly texturePath?: string;
  readonly category?: SpecialIconCategory;
}

/**
 * Orthographic half-extent so the XY AABB fills `fill` of a square looking down -Z.
 * Smaller extent → larger on-screen model. No per-item scale.
 */
export function orthographicFitExtent(width: number, height: number, fill = SPECIAL_ICON_FILL): number {
  const half = Math.max(width, height, 1e-6) * 0.5;
  const safeFill = Math.min(0.94, Math.max(0.7, fill));
  return half / safeFill;
}

export function specialIconCategory(itemOrId: string | ItemDefinition): SpecialIconCategory | undefined {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind !== 'block') return undefined;
  switch (getBlockDefinition(item.blockId).renderShape) {
    case 'stairs': return 'stairs';
    case 'slab': return 'slab';
    case 'button': return 'button';
    case 'pressure_plate': return 'pressure_plate';
    case 'chest': return 'chest';
    default: return undefined;
  }
}

export function itemIconDescriptor(itemOrId: string | ItemDefinition): ItemIconDescriptor {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  const category = specialIconCategory(item);
  if (category && itemHeldMeshKind(item) === 'special_model') {
    return { kind: 'special_preview', category };
  }
  return { kind: 'texture', texturePath: item.texture };
}
