import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
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

/**
 * Shared first-person pose for `item/generated`, `item/handheld` and bow.
 *
 * These numbers are a temporary face-on calibration, not the vanilla 1.9
 * pipeline. Vanilla `firstperson_righthand` is `rotation [0, -90, 25]`,
 * `translation [1.13, 3.2, 1.13]`, `scale [0.68, 0.68, 0.68]`. Ry(−90°) is a
 * real display rotation (sprite front +Z → camera −X), not a Three.js basis
 * conversion. Do not copy those Eulers into `rotation.set`.
 *
 * The mathematical adapter lives in `heldItemVanillaTransform.ts` and is not
 * wired here. `heldScale/heldX/heldY/heldZ/heldRoll/heldPitch/heldYaw` remain
 * QA-only overrides of this temporary pose.
 *
 * `scale` is the FINAL uniform Three.js scale written to the item root, not a
 * multiplier on vanilla 0.68.
 */
export const FIRST_PERSON_SPRITE_POSE = Object.freeze({
  position: [0.50, -0.56, -0.82] as RenderVector,
  rotationDeg: [0, 0, 14] as RenderVector,
  scale: 0.85,
});

const FIRST_PERSON_GENERATED = transform(
  FIRST_PERSON_SPRITE_POSE.position,
  FIRST_PERSON_SPRITE_POSE.rotationDeg,
  [
    FIRST_PERSON_SPRITE_POSE.scale,
    FIRST_PERSON_SPRITE_POSE.scale,
    FIRST_PERSON_SPRITE_POSE.scale,
  ],
);

export const BOW_PULL_STAGE_1 = 0.65;
export const BOW_PULL_STAGE_2 = 0.9;

/** Vanilla bow.json overrides: pulling, then pull >= 0.65 / 0.9. */
export function bowPullingTexturePath(pull: number): string {
  if (pull <= 0) return 'item/bow';
  if (pull >= BOW_PULL_STAGE_2) return 'item/bow_pulling_2';
  if (pull >= BOW_PULL_STAGE_1) return 'item/bow_pulling_1';
  return 'item/bow_pulling_0';
}

export const ITEM_RENDER_PROFILES: Readonly<Record<ItemRenderCategory, ItemRenderProfile>> = Object.freeze({
  block: profile(
    'block',
    transform([0.46, -0.31, -0.80], [24, -42, 16], [0.28, 0.28, 0.28]),
    transform([0, 0, 0], [0, 18, 0], [0.30, 0.30, 0.30]),
    UNIFORM_GUI,
  ),
  generated: profile(
    'generated',
    FIRST_PERSON_GENERATED,
    transform([0, 0, 0], [0, 0, 0], [0.38, 0.38, 0.38]),
    UNIFORM_GUI,
  ),
  handheld: profile(
    'handheld',
    FIRST_PERSON_GENERATED,
    transform([0, 0, 0], [0, 0, 25], [0.38, 0.38, 0.38]),
    UNIFORM_GUI,
  ),
  bow: profile(
    'bow',
    FIRST_PERSON_GENERATED,
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
  if (item.kind === 'block') {
    const shape = getBlockDefinition(item.blockId).renderShape;
    if (shape === 'torch' || shape === 'button' || shape === 'lever' || shape === 'door' || shape === 'cross') {
      return 'generated';
    }
    return 'block';
  }
  if (item.kind === 'shield') return 'shield';
  if (item.id === 'stick' || item.tags?.includes('stick')) return 'handheld';
  if (item.kind === 'tool' || (item.kind === 'weapon' && item.weapon === 'sword')) return 'handheld';
  if (item.kind === 'weapon' && item.weapon === 'bow') return 'bow';
  return 'generated';
}

/**
 * Held/inventory mesh path. Torch uses item/generated sprite geometry even
 * though the placed block is a world cuboid. Other special block items stay
 * on the cube path in this phase.
 */
export function itemUsesGeneratedHeldGeometry(itemOrId: string | ItemDefinition): boolean {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind !== 'block') return true;
  return getBlockDefinition(item.blockId).renderShape === 'torch';
}

export function itemRenderProfile(itemOrId: string | ItemDefinition): ItemRenderProfile {
  return ITEM_RENDER_PROFILES[classifyItemForRendering(itemOrId)];
}
