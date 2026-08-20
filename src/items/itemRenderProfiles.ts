import { getItemDefinition } from './registry';
import { getBlockDefinition } from '../blocks';
import type { ItemDefinition } from './types';

export type ItemRenderCategory = 'block' | 'torch' | 'generated' | 'handheld' | 'bow' | 'shield';
export type ItemVisualFamily =
  | 'block-cube'
  | 'torch'
  | 'door'
  | 'lever'
  | 'button'
  | 'pressure-plate'
  | 'sword'
  | 'pickaxe'
  | 'axe'
  | 'shovel'
  | 'arrow'
  | 'bow'
  | 'shield'
  | 'stick'
  | 'ingot'
  | 'brick'
  | 'gem'
  | 'chunk'
  | 'flint'
  | 'clay-ball'
  | 'pile'
  | 'string'
  | 'feather'
  | 'leather'
  | 'book'
  | 'food-round'
  | 'food-loaf'
  | 'food-cut'
  | 'armor-helmet'
  | 'armor-chest'
  | 'armor-legs'
  | 'armor-boots'
  | 'generic-fallback';

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
  readonly family: ItemVisualFamily;
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
  family: ItemVisualFamily,
  firstPerson: ItemViewTransform,
  ground: ItemViewTransform,
  gui: ItemViewTransform,
): ItemRenderProfile => Object.freeze({
  category,
  family,
  transforms: Object.freeze({ firstPersonRightHand: firstPerson, ground, gui }),
});

const UNIFORM_GUI = transform([0, 0, 0], [0, 0, 0], [1, 1, 1]);
const GROUND_SPIN = transform([0, 0, 0], [0, 22, 0], [0.38, 0.38, 0.38]);

const RESOURCE_HAND = transform([0.50, -0.28, -0.70], [16, -38, 14], [0.42, 0.42, 0.42]);
const TOOL_HAND = transform([0.50, -0.30, -0.66], [18, -42, -58], [0.56, 0.56, 0.56]);
const ARMOR_HAND = transform([0.50, -0.30, -0.72], [18, -36, 12], [0.40, 0.40, 0.40]);

/**
 * Mesh construction family. Cube blocks stay atlas cubes; everything else is a
 * reusable low-poly family. `generic-fallback` is only for unknown future items.
 */
export function itemVisualFamily(itemOrId: string | ItemDefinition): ItemVisualFamily {
  const item = typeof itemOrId === 'string' ? getItemDefinition(itemOrId) : itemOrId;
  if (item.kind === 'block') {
    switch (getBlockDefinition(item.blockId).renderShape) {
      case 'torch': return 'torch';
      case 'door': return 'door';
      case 'lever': return 'lever';
      case 'button': return 'button';
      case 'pressure_plate': return 'pressure-plate';
      default: return 'block-cube';
    }
  }
  if (item.kind === 'tool') return item.tool;
  if (item.kind === 'weapon') return item.weapon === 'bow' ? 'bow' : 'sword';
  if (item.kind === 'shield') return 'shield';
  if (item.kind === 'armor') {
    if (item.slot === 'head') return 'armor-helmet';
    if (item.slot === 'chest') return 'armor-chest';
    if (item.slot === 'legs') return 'armor-legs';
    return 'armor-boots';
  }
  if (item.kind === 'food') {
    if (item.id === 'apple') return 'food-round';
    if (item.id === 'bread') return 'food-loaf';
    return 'food-cut';
  }
  switch (item.id) {
    case 'stick': return 'stick';
    case 'iron_ingot':
    case 'gold_ingot': return 'ingot';
    case 'brick': return 'brick';
    case 'diamond': return 'gem';
    case 'coal':
    case 'charcoal': return 'chunk';
    case 'flint': return 'flint';
    case 'clay_ball': return 'clay-ball';
    case 'gunpowder':
    case 'redstone_dust': return 'pile';
    case 'string': return 'string';
    case 'feather': return 'feather';
    case 'leather': return 'leather';
    case 'book': return 'book';
    case 'arrow': return 'arrow';
    default: return 'generic-fallback';
  }
}

export function classifyItemForRendering(itemOrId: string | ItemDefinition): ItemRenderCategory {
  const family = itemVisualFamily(itemOrId);
  if (family === 'torch') return 'torch';
  if (family === 'block-cube') return 'block';
  if (family === 'shield') return 'shield';
  if (family === 'bow') return 'bow';
  if (family === 'sword' || family === 'pickaxe' || family === 'axe' || family === 'shovel') {
    return 'handheld';
  }
  return 'generated';
}

const CATEGORY_FALLBACK: Readonly<Record<ItemRenderCategory, Omit<ItemRenderProfile, 'family'>>> = {
  block: {
    category: 'block',
    transforms: Object.freeze({
      firstPersonRightHand: transform([0.46, -0.31, -0.80], [24, -42, 16], [0.28, 0.28, 0.28]),
      ground: transform([0, 0, 0], [0, 18, 0], [0.30, 0.30, 0.30]),
      gui: UNIFORM_GUI,
    }),
  },
  torch: {
    category: 'torch',
    transforms: Object.freeze({
      firstPersonRightHand: transform([0.52, -0.36, -0.70], [18, -28, 10], [0.50, 0.50, 0.50]),
      ground: transform([0, 0, 0], [0, 32, 0], [0.42, 0.42, 0.42]),
      gui: UNIFORM_GUI,
    }),
  },
  generated: {
    category: 'generated',
    transforms: Object.freeze({
      firstPersonRightHand: RESOURCE_HAND,
      ground: GROUND_SPIN,
      gui: UNIFORM_GUI,
    }),
  },
  handheld: {
    category: 'handheld',
    transforms: Object.freeze({
      firstPersonRightHand: TOOL_HAND,
      ground: transform([0, 0, 0], [0, 0, 25], [0.40, 0.40, 0.40]),
      gui: UNIFORM_GUI,
    }),
  },
  bow: {
    category: 'bow',
    transforms: Object.freeze({
      firstPersonRightHand: transform([0.46, -0.26, -0.74], [6, -18, -12], [0.40, 0.40, 0.40]),
      ground: transform([0, 0, 0], [0, 0, -12], [0.40, 0.40, 0.40]),
      gui: UNIFORM_GUI,
    }),
  },
  shield: {
    category: 'shield',
    transforms: Object.freeze({
      firstPersonRightHand: transform([0.48, -0.28, -0.78], [8, -22, 8], [0.36, 0.36, 0.36]),
      ground: transform([0, 0, 0], [0, 18, 0], [0.40, 0.40, 0.40]),
      gui: UNIFORM_GUI,
    }),
  },
};

const FAMILY_PROFILES: Partial<Record<ItemVisualFamily, ItemRenderProfile>> = {
  door: profile('generated', 'door', transform([0.50, -0.32, -0.72], [16, -40, 10], [0.46, 0.46, 0.46]), GROUND_SPIN, UNIFORM_GUI),
  lever: profile('generated', 'lever', transform([0.50, -0.30, -0.70], [14, -32, 12], [0.52, 0.52, 0.52]), GROUND_SPIN, UNIFORM_GUI),
  button: profile('generated', 'button', transform([0.50, -0.28, -0.72], [20, -36, 10], [0.55, 0.55, 0.55]), GROUND_SPIN, UNIFORM_GUI),
  'pressure-plate': profile('generated', 'pressure-plate', transform([0.50, -0.26, -0.72], [28, -40, 8], [0.48, 0.48, 0.48]), GROUND_SPIN, UNIFORM_GUI),
  arrow: profile('generated', 'arrow', transform([0.52, -0.28, -0.68], [10, -48, 28], [0.50, 0.50, 0.50]), GROUND_SPIN, UNIFORM_GUI),
  stick: profile('handheld', 'stick', transform([0.50, -0.30, -0.68], [16, -38, -50], [0.50, 0.50, 0.50]), GROUND_SPIN, UNIFORM_GUI),
  'food-round': profile('generated', 'food-round', transform([0.50, -0.26, -0.70], [14, -32, 16], [0.44, 0.44, 0.44]), GROUND_SPIN, UNIFORM_GUI),
  'armor-helmet': profile('generated', 'armor-helmet', ARMOR_HAND, GROUND_SPIN, UNIFORM_GUI),
  'armor-chest': profile('generated', 'armor-chest', ARMOR_HAND, GROUND_SPIN, UNIFORM_GUI),
  'armor-legs': profile('generated', 'armor-legs', ARMOR_HAND, GROUND_SPIN, UNIFORM_GUI),
  'armor-boots': profile('generated', 'armor-boots', ARMOR_HAND, GROUND_SPIN, UNIFORM_GUI),
};

export const ITEM_RENDER_PROFILES: Readonly<Record<ItemRenderCategory, ItemRenderProfile>> = Object.freeze({
  block: { ...CATEGORY_FALLBACK.block, family: 'block-cube' as const },
  torch: { ...CATEGORY_FALLBACK.torch, family: 'torch' as const },
  generated: { ...CATEGORY_FALLBACK.generated, family: 'generic-fallback' as const },
  handheld: { ...CATEGORY_FALLBACK.handheld, family: 'sword' as const },
  bow: { ...CATEGORY_FALLBACK.bow, family: 'bow' as const },
  shield: { ...CATEGORY_FALLBACK.shield, family: 'shield' as const },
});

export function itemRenderProfile(itemOrId: string | ItemDefinition): ItemRenderProfile {
  const family = itemVisualFamily(itemOrId);
  const specialized = FAMILY_PROFILES[family];
  if (specialized) return specialized;
  const category = classifyItemForRendering(itemOrId);
  const base = CATEGORY_FALLBACK[category];
  return { ...base, family };
}
