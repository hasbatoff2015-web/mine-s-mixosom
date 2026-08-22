import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
import type { ItemDefinition } from './types';
import { itemHeldMeshKind } from './itemRenderProfiles';

export type SpecialIconCategory = 'stairs' | 'slab' | 'button' | 'pressure_plate';

export interface SpecialIconPose {
  readonly rotationDeg: readonly [number, number, number];
  readonly padding: number;
}

/**
 * Category preview transforms — not per-material magic numbers.
 * Shared isometric angle; padding zooms out so small models stay readable.
 */
export const SPECIAL_ICON_POSES: Readonly<Record<SpecialIconCategory, SpecialIconPose>> = Object.freeze({
  stairs: Object.freeze({ rotationDeg: [30, 225, 0] as const, padding: 1.18 }),
  slab: Object.freeze({ rotationDeg: [30, 225, 0] as const, padding: 1.22 }),
  button: Object.freeze({ rotationDeg: [30, 225, 0] as const, padding: 2.35 }),
  pressure_plate: Object.freeze({ rotationDeg: [30, 225, 0] as const, padding: 1.42 }),
});

export type ItemIconKind = 'texture' | 'special_preview';

export interface ItemIconDescriptor {
  readonly kind: ItemIconKind;
  readonly texturePath?: string;
  readonly category?: SpecialIconCategory;
}

export function specialIconCategory(itemOrId: string | ItemDefinition): SpecialIconCategory | undefined {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind !== 'block') return undefined;
  switch (getBlockDefinition(item.blockId).renderShape) {
    case 'stairs': return 'stairs';
    case 'slab': return 'slab';
    case 'button': return 'button';
    case 'pressure_plate': return 'pressure_plate';
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
