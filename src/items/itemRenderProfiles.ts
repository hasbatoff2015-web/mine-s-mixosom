import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
import type { ItemDefinition } from './types';

export type ItemRenderCategory = 'block' | 'torch' | 'generated' | 'handheld' | 'bow' | 'shield';
export type ItemVisualKind = 'block-cube' | 'special-torch' | 'generated';
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
  torch: profile(
    'torch',
    transform([0.52, -0.36, -0.70], [18, -28, 10], [0.50, 0.50, 0.50]),
    transform([0, 0, 0], [0, 32, 0], [0.42, 0.42, 0.42]),
    UNIFORM_GUI,
  ),
  generated: profile(
    'generated',
    transform([0.52, -0.30, -0.72], [12, -48, 18], [0.48, 0.48, 0.48]),
    transform([0, 0, 0], [0, 18, 0], [0.38, 0.38, 0.38]),
    UNIFORM_GUI,
  ),
  handheld: profile(
    'handheld',
    transform([0.54, -0.32, -0.74], [14, -55, 22], [0.52, 0.52, 0.52]),
    transform([0, 0, 0], [0, 0, 25], [0.40, 0.40, 0.40]),
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
    transform([0.48, -0.30, -0.80], [8, -42, 10], [0.44, 0.44, 0.44]),
    transform([0, 0, 0], [0, 18, 0], [0.40, 0.40, 0.40]),
    UNIFORM_GUI,
  ),
});

/**
 * Mesh construction kind, independent of first-person pose category.
 * Cube blocks stay atlas cubes; torches reuse world cuboid stick; everything else is extruded.
 */
export function itemVisualKind(itemOrId: string | ItemDefinition): ItemVisualKind {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind !== 'block') return 'generated';
  return getBlockDefinition(item.blockId).renderShape === 'torch' ? 'special-torch' : 'block-cube';
}

export function classifyItemForRendering(itemOrId: string | ItemDefinition): ItemRenderCategory {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (itemVisualKind(item) === 'special-torch') return 'torch';
  if (item.kind === 'block') return 'block';
  if (item.kind === 'shield') return 'shield';
  if (item.kind === 'tool' || (item.kind === 'weapon' && item.weapon === 'sword')) return 'handheld';
  if (item.kind === 'weapon' && item.weapon === 'bow') return 'bow';
  return 'generated';
}

export function itemRenderProfile(itemOrId: string | ItemDefinition): ItemRenderProfile {
  return ITEM_RENDER_PROFILES[classifyItemForRendering(itemOrId)];
}
