import { getItemDefinition } from './registry';
import type { ItemDefinition } from './types';

export type ItemRenderCategory = 'block' | 'generated' | 'handheld' | 'bow' | 'shield';
export type ItemRenderContext = 'firstPersonRightHand' | 'ground' | 'gui';
export type RenderVector = readonly [x: number, y: number, z: number];

export interface ItemViewTransform {
  readonly position: RenderVector;
  /** Euler XYZ angles in radians. */
  readonly rotation: RenderVector;
  readonly scale: RenderVector;
}

export interface ItemRenderProfile {
  readonly category: ItemRenderCategory;
  readonly transforms: Readonly<Record<ItemRenderContext, ItemViewTransform>>;
}

const radians = (degrees: number): number => degrees * Math.PI / 180;
const transform = (
  position: RenderVector,
  rotationDegrees: RenderVector,
  scale: RenderVector,
): ItemViewTransform => Object.freeze({
  position: Object.freeze([...position]) as RenderVector,
  rotation: Object.freeze(rotationDegrees.map(radians)) as RenderVector,
  scale: Object.freeze([...scale]) as RenderVector,
});

const profile = (
  category: ItemRenderCategory,
  firstPerson: ItemViewTransform,
  ground: ItemViewTransform,
  gui: ItemViewTransform,
): ItemRenderProfile => Object.freeze({
  category,
  transforms: Object.freeze({ firstPersonRightHand: firstPerson, ground, gui }),
});

const UNIFORM_GUI = transform([0, 0, 0], [0, 0, 0], [1, 1, 1]);

/** Alpha equivalents of vanilla display contexts; values are intentionally project-tuned. */
export const ITEM_RENDER_PROFILES: Readonly<Record<ItemRenderCategory, ItemRenderProfile>> = Object.freeze({
  block: profile(
    'block',
    transform([0.46, -0.31, -0.80], [24, -42, 16], [0.28, 0.28, 0.28]),
    transform([0, 0, 0], [0, 18, 0], [0.30, 0.30, 0.30]),
    UNIFORM_GUI,
  ),
  generated: profile(
    'generated',
    transform([0.48, -0.24, -0.76], [3, -18, -12], [0.31, 0.31, 0.31]),
    transform([0, 0, 0], [0, 0, 0], [0.38, 0.38, 0.38]),
    UNIFORM_GUI,
  ),
  handheld: profile(
    'handheld',
    transform([0.49, -0.30, -0.76], [2, -18, -10], [0.39, 0.39, 0.39]),
    transform([0, 0, 0], [0, 0, 25], [0.38, 0.38, 0.38]),
    UNIFORM_GUI,
  ),
  bow: profile(
    'bow',
    transform([0.48, -0.28, -0.79], [0, -16, -5], [0.36, 0.36, 0.36]),
    transform([0, 0, 0], [0, 0, -12], [0.40, 0.40, 0.40]),
    UNIFORM_GUI,
  ),
  shield: profile(
    'shield',
    transform([0.47, -0.31, -0.82], [5, -18, -8], [0.42, 0.42, 0.42]),
    transform([0, 0, 0], [0, 0, 0], [0.40, 0.40, 0.40]),
    UNIFORM_GUI,
  ),
});

export function classifyItemForRendering(itemOrId: string | ItemDefinition): ItemRenderCategory {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind === 'block') return 'block';
  if (item.kind === 'shield') return 'shield';
  if (item.kind === 'tool' || (item.kind === 'weapon' && item.weapon === 'sword')) return 'handheld';
  if (item.kind === 'weapon' && item.weapon === 'bow') return 'bow';
  return 'generated';
}

export function itemRenderProfile(itemOrId: string | ItemDefinition): ItemRenderProfile {
  return ITEM_RENDER_PROFILES[classifyItemForRendering(itemOrId)];
}
