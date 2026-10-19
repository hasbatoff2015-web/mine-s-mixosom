import { BlockId, type BlockRenderState } from '../blocks/types';

/**
 * Twenty design IDs. Creative and `/give` may mint as many copies as an
 * admin needs. Nothing in this module places, respawns, or counts world copies.
 */
export const COLLECTIBLE_PAINTING_IDS = [
  'painting_01_villager_hmm',
  'painting_02_night_guardian',
  'painting_03_sunset_cat',
  'painting_04_grass_cat',
  'painting_05_dark_steve',
  'painting_06_golden_cat',
  'painting_07_sunny_bee',
  'painting_08_smirk',
  'painting_09_rainbow_ghast',
  'painting_10_giant_zombie',
  'painting_11_crowd_scream',
  'painting_12_underwater_patrick',
  'painting_13_gucci_character',
  'painting_14_minecraft_portrait',
  'painting_15_confident_beard',
  'painting_16_grass_steve',
  'painting_17_troll_smile',
  'painting_18_lynx_rabbit',
  'painting_19_burning_mask',
  'painting_20_tiger_musya',
] as const;

export type CollectiblePaintingItemId = (typeof COLLECTIBLE_PAINTING_IDS)[number];

const ID_SET: ReadonlySet<string> = new Set(COLLECTIBLE_PAINTING_IDS);

export function isCollectiblePaintingItemId(id: string | undefined | null): id is CollectiblePaintingItemId {
  return typeof id === 'string' && ID_SET.has(id);
}

/** Atlas/registry key. Unknown ids return undefined and must never become a URL. */
export function collectiblePaintingTexture(id: string | undefined | null): string | undefined {
  return isCollectiblePaintingItemId(id) ? `painting/collectibles/${id}` : undefined;
}

export function collectiblePaintingTag(id: CollectiblePaintingItemId): string {
  const index = COLLECTIBLE_PAINTING_IDS.indexOf(id) + 1;
  return `painting:${String(index).padStart(2, '0')}`;
}

export function collectiblePaintingDropItemId(
  block: number,
  state: Pick<BlockRenderState, 'paintingItemId'> | undefined,
): CollectiblePaintingItemId | undefined {
  if (block !== BlockId.CollectiblePainting) return undefined;
  return isCollectiblePaintingItemId(state?.paintingItemId) ? state.paintingItemId : undefined;
}
