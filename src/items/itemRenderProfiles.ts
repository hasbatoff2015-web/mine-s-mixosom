import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
import { ItemId, type ItemDefinition } from './types';

export type ItemRenderCategory = 'block' | 'generated' | 'handheld' | 'bow';
export type ItemRenderContext = 'firstPersonRightHand' | 'ground' | 'gui';
export type RenderVector = readonly [x: number, y: number, z: number];
/**
 * Held/inventory mesh path. Pose category (`ItemRenderCategory`) stays independent:
 * a generated sprite can share the sprite pose, a special cuboid can use the block pose.
 */
export type ItemHeldMeshKind = 'block_cube' | 'generated' | 'special_model';

/** Runtime-composited full-door sprite; Faithful pack has no `item/oak_door.png`. */
export const OAK_DOOR_HELD_TEXTURE = 'generated/oak_door_item';

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
 * Manually selected through the live QA calibrator on representative
 * generated/handheld items. Yaw −90° is the chosen visual result: do not
 * replace it with the vanilla matrix, candidate 8/18/32° angles, or a
 * “more correct” mathematical substitute.
 *
 * `scale` is the FINAL uniform Three.js scale written to the item root, not a
 * multiplier on vanilla 0.68. QA `held*` / `qaPose=subtle|balanced|stronger`
 * remain overrides only and do not write these defaults.
 */
export const FIRST_PERSON_SPRITE_POSE = Object.freeze({
  position: [0.67, -0.29, -0.70] as RenderVector,
  rotationDeg: [1, -90, 34] as RenderVector,
  scale: 0.60,
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
});

export function classifyItemForRendering(itemOrId: string | ItemDefinition): ItemRenderCategory {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind === 'block') {
    const shape = getBlockDefinition(item.blockId).renderShape;
    if (
      shape === 'torch'
      || shape === 'lever'
      || shape === 'door'
      || shape === 'ladder'
      || shape === 'cross'
      || shape === 'fire'
      || shape === 'wire'
      || shape === 'farmland'
    ) {
      return 'generated';
    }
    return 'block';
  }
  if (item.id === 'stick' || item.tags?.includes('stick')) return 'handheld';
  if (item.id === ItemId.FlintAndSteel) return 'handheld';
  if (item.id === ItemId.FireArrow) return 'handheld';
  if (item.kind === 'tool' || (item.kind === 'weapon' && item.weapon === 'sword')) return 'handheld';
  if (item.kind === 'weapon' && item.weapon === 'bow') return 'bow';
  return 'generated';
}

/**
 * Vanilla 1.21.8 Faithful is textures-only. Item JSON parents:
 * lever/ladder/door → `item/generated`; button/plate → block inventory cuboid;
 * ordinary blocks → cube. Torch remains generated even though the placed
 * block is a world cuboid.
 */
export function itemHeldMeshKind(itemOrId: string | ItemDefinition): ItemHeldMeshKind {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind !== 'block') return 'generated';
  switch (getBlockDefinition(item.blockId).renderShape) {
    case 'torch':
    case 'lever':
    case 'ladder':
    case 'door':
    case 'cross':
    case 'fire':
    case 'wire':
    case 'farmland':
      return 'generated';
    case 'button':
    case 'pressure_plate':
    case 'stairs':
    case 'slab':
    case 'chest':
    case 'fence':
    case 'rail':
    case 'lantern':
    case 'chain':
      return 'special_model';
    case 'cube':
      return 'block_cube';
  }
}

export function itemUsesGeneratedHeldGeometry(itemOrId: string | ItemDefinition): boolean {
  return itemHeldMeshKind(itemOrId) === 'generated';
}

export function itemUsesSpecialHeldModel(itemOrId: string | ItemDefinition): boolean {
  return itemHeldMeshKind(itemOrId) === 'special_model';
}

/** Texture path fed to `GeneratedItemGeometry` (may be a runtime composite key). */
export function generatedHeldTexturePath(itemOrId: string | ItemDefinition): string {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.id === 'oak_door') return OAK_DOOR_HELD_TEXTURE;
  return item.texture;
}

export function itemRenderProfile(itemOrId: string | ItemDefinition): ItemRenderProfile {
  return ITEM_RENDER_PROFILES[classifyItemForRendering(itemOrId)];
}
