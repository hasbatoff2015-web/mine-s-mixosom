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
 * Vanilla `item/generated` and `item/handheld` firstperson_righthand JSON:
 *   rotation [0, -90, 25]
 *   translation [1.13, 3.2, 1.13]
 *   scale [0.68, 0.68, 0.68]
 *
 * Those Eulers are for Minecraft item space (south-facing sprite, camera
 * looking south after the yaw). They must not be copied into Three.js.
 *
 * GeneratedItemGeometry already puts the front on +Z. The first-person
 * camera looks down -Z, so an item at negative Z already shows the sprite.
 * Vanilla Y=-90 is only the Minecraft camera-basis conversion; applying it
 * here would present the side spans instead of the front texture.
 *
 * Adapter: drop that -90° yaw, keep the 25° held roll, convert translation
 * from vanilla pixels to blocks, then apply one project-level hand/camera
 * offset. Generated, handheld and bow share this first-person pose.
 */
const VANILLA_FP_ROTATION_DEG: RenderVector = [0, -90, 25];
const VANILLA_FP_TRANSLATION_PX: RenderVector = [1.13, 3.2, 1.13];
const VANILLA_FP_SCALE = 0.68;
const MC_PIXEL = 1 / 16;
/** Cancels vanilla Y=-90 so the sprite stays camera-facing in Three.js. */
const THREE_JS_BASIS_YAW_DEG = 90;
/**
 * Places the item in the lower-right of our 70° viewmodel camera. This is a
 * single global rig offset, not a per-tool pose.
 */
const VIEWMODEL_HAND_OFFSET: RenderVector = [0.36, -0.42, -0.70];
/**
 * Vanilla 0.68 of a 1-block item is oversized at our camera distance.
 * Keep uniform scale; shrink globally so the front sprite stays readable.
 */
const VIEWMODEL_SCALE = VANILLA_FP_SCALE * 0.52;

function vanillaLikeFirstPersonRightHand(): ItemViewTransform {
  return transform(
    [
      VIEWMODEL_HAND_OFFSET[0] + VANILLA_FP_TRANSLATION_PX[0] * MC_PIXEL,
      VIEWMODEL_HAND_OFFSET[1] + VANILLA_FP_TRANSLATION_PX[1] * MC_PIXEL,
      VIEWMODEL_HAND_OFFSET[2] - VANILLA_FP_TRANSLATION_PX[2] * MC_PIXEL,
    ],
    [
      VANILLA_FP_ROTATION_DEG[0],
      VANILLA_FP_ROTATION_DEG[1] + THREE_JS_BASIS_YAW_DEG,
      VANILLA_FP_ROTATION_DEG[2],
    ],
    [VIEWMODEL_SCALE, VIEWMODEL_SCALE, VIEWMODEL_SCALE],
  );
}

const FIRST_PERSON_GENERATED = vanillaLikeFirstPersonRightHand();

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
