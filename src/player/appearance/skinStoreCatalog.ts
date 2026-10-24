import { skinDescriptor, type MinecraftSkinDescriptor } from './builtinSkins';

/**
 * Store metadata for player skins.
 *
 * The PNG generator answers "what does this skin look like?".
 * This module answers "how rare is it, and how would a player obtain it?".
 * Neither module decides whether a particular player may equip it.
 *
 * Rarity is not stored in the PNG and is not inferred from file order.
 * A new gameplay PNG with no entry here must fail the production build.
 */

export type SkinRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type SkinAcquisition = 'default' | 'rewarded_ad' | 'purchase' | 'admin_only';

export const SKIN_RARITY_ORDER: readonly SkinRarity[] = Object.freeze([
  'common',
  'rare',
  'epic',
  'legendary',
]);

export const SKIN_RARITY_LABELS: Readonly<Record<SkinRarity, string>> = Object.freeze({
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
});

export const SKIN_RARITY_HEADINGS: Readonly<Record<SkinRarity, string>> = Object.freeze({
  common: 'ОБЫЧНЫЕ',
  rare: 'РЕДКИЕ',
  epic: 'ЭПИЧЕСКИЕ',
  legendary: 'ЛЕГЕНДАРНЫЕ',
});

/** Free starter skin. It is the first common entry and never requires an ad or a purchase. */
export const DEFAULT_STORE_SKIN_ID = 'frontier_explorer';

/**
 * First legendary skin is reserved for one future administrator.
 * Second legendary skin is reserved for the other.
 * No account id is bound yet, so neither skin is equippable through the UI.
 */
export const LEGENDARY_ADMIN_SKIN_IDS = Object.freeze([
  'ae1fddb72664eaf2',
  'e126128225dccc51',
] as const);

/**
 * Owner-agreed target prices. After Yandex payments are connected, the live
 * catalog amount and currency replace these numbers. They are not a charge quote.
 */
export const SKIN_TARGET_PRICES = Object.freeze({
  rare: Object.freeze({ individualRub: 29, packRub: 99 }),
  epic: Object.freeze({ individualRub: 149, packRub: 299 }),
});

export const SKIN_PACK_ALL_RARE = 'skin_pack_all_rare';
export const SKIN_PACK_ALL_EPIC = 'skin_pack_all_epic';

/**
 * Common skins in menu order. `frontier_explorer` is pinned first.
 * The other ids keep the relative order approved for this catalog.
 */
export const COMMON_SKIN_IDS = [
  'frontier_explorer',
  '0edde60fa266fac7',
  '0f15ad5e5c148f40',
  '134f7844391b9382',
  '14fcedd090af47a4',
  '1ea0cee32dd870ba',
  '24f3321d8a6ec3cf',
  '2ad6187a00bc4712',
  '2e8c98dab33b766f',
  '333971ad9949346f',
  '37e10d3fc9798c98',
  '4c7afbcaeb250f76',
  '554ec16161f085c0',
  '6119ea42953f535e',
  '65462827594073e4',
  '7c6103b44dc95a65',
  '7d729ce6664b4fdc',
  '7e91017ffce8dc04',
  '803d711fa90035a7',
  '8735c781375740c0',
  '8bb9550c824ce10e',
  '8bc8f731d8e5ca7c',
  '8cd9d4ce5d4d8abf',
  '960e4805666e1591',
  '96680c9dd86bcabc',
  '985483b761dcaceb',
  '9f612d6b63970655',
  'b1ebc7b52d0c7f61',
  'b5db0069a126bbf3',
  'bc3e8672b6d7c821',
  'bc7db647674d1f01',
  'c026b7f8552098de',
  'd5f7c69c89edd405',
  'dce095dc5bddc925',
  'dcf537aec75f761d',
  'dee6149d4583a54b',
  'e203f6b2fd4c30dc',
  'e3eb6f99ea1c3fe1',
  'e936712cae837a84',
  'f47ebc2553e02251',
] as const;

export const RARE_SKIN_IDS = [
  '00f6338deb336a6e',
  '1e8fa3ce56f39d6c',
  '2b72a352b69d2d22',
  '2cd5c775d21141bd',
  '3095ca131afb5705',
  '48458b73d1075c60',
  '5620ef1df645276e',
  '5a90d9efb3029994',
  '5bc8ad7edfb7ee86',
  '6fdcd3bc5850aeed',
  'c6ffa466e0aa2e48',
  'dcbbff5cb0c44e79',
  'de887af6e5cd16c4',
  'ef110ed6514bcf80',
] as const;

export const EPIC_SKIN_IDS = [
  '211085684a03470a',
  '3171abd1dedfa703',
  '55264c2ebdb9ed9d',
  'b834368ba96d6574',
  'c7e629b4f28c56a5',
  'd3f7b2f0b6d834b9',
  'ded78bc20ae6f892',
  'f7b4ab3f68df5fca',
] as const;

export const LEGENDARY_SKIN_IDS = [
  'ae1fddb72664eaf2',
  'e126128225dccc51',
] as const;

export interface SkinStoreEntry {
  readonly skinId: string;
  readonly rarity: SkinRarity;
  readonly acquisition: SkinAcquisition;
  /** Stable position inside the rarity group. Independent of the PNG file name. */
  readonly order: number;
  /** Internal project SKU. Not a registered Yandex product. Absent when the skin is not sold. */
  readonly sku?: string;
  /** Target amount for display only. Absent when the skin is not sold. */
  readonly targetPriceRub?: number;
  readonly targetPriceLabel?: string;
}

export interface SkinPackOffer {
  readonly sku: typeof SKIN_PACK_ALL_RARE | typeof SKIN_PACK_ALL_EPIC;
  readonly rarity: 'rare' | 'epic';
  readonly title: string;
  readonly skinIds: readonly string[];
  readonly targetPriceRub: number;
  readonly targetPriceLabel: string;
  /** Display source. Live checkout must read the platform catalog instead. */
  readonly priceSource: 'target';
}

export interface SkinProductOffer {
  readonly sku: string;
  readonly skinId: string;
  readonly rarity: 'rare' | 'epic';
  readonly targetPriceRub: number;
  readonly targetPriceLabel: string;
  readonly priceSource: 'target';
}

const RARITY_GROUPS: readonly { rarity: SkinRarity; ids: readonly string[] }[] = Object.freeze([
  { rarity: 'common', ids: COMMON_SKIN_IDS },
  { rarity: 'rare', ids: RARE_SKIN_IDS },
  { rarity: 'epic', ids: EPIC_SKIN_IDS },
  { rarity: 'legendary', ids: LEGENDARY_SKIN_IDS },
]);

function acquisitionFor(rarity: SkinRarity, skinId: string): SkinAcquisition {
  if (skinId === DEFAULT_STORE_SKIN_ID) return 'default';
  if (rarity === 'common') return 'rewarded_ad';
  if (rarity === 'legendary') return 'admin_only';
  return 'purchase';
}

function formatRub(amount: number): string {
  return `${amount} ₽`;
}

function skuFor(rarity: SkinRarity, skinId: string): string | undefined {
  if (rarity === 'rare') return `skin_rare_${skinId}`;
  if (rarity === 'epic') return `skin_epic_${skinId}`;
  return undefined;
}

function priceFor(rarity: SkinRarity): { rub: number; label: string } | undefined {
  if (rarity === 'rare') {
    return { rub: SKIN_TARGET_PRICES.rare.individualRub, label: formatRub(SKIN_TARGET_PRICES.rare.individualRub) };
  }
  if (rarity === 'epic') {
    return { rub: SKIN_TARGET_PRICES.epic.individualRub, label: formatRub(SKIN_TARGET_PRICES.epic.individualRub) };
  }
  return undefined;
}

const ENTRIES = new Map<string, SkinStoreEntry>();
const ORDERED_IDS: string[] = [];

for (const group of RARITY_GROUPS) {
  group.ids.forEach((skinId, index) => {
    const price = priceFor(group.rarity);
    const entry: SkinStoreEntry = {
      skinId,
      rarity: group.rarity,
      acquisition: acquisitionFor(group.rarity, skinId),
      order: index,
      ...(skuFor(group.rarity, skinId) ? { sku: skuFor(group.rarity, skinId) } : {}),
      ...(price ? { targetPriceRub: price.rub, targetPriceLabel: price.label } : {}),
    };
    ENTRIES.set(skinId, entry);
    ORDERED_IDS.push(skinId);
  });
}

export const SKIN_PACK_OFFERS: readonly SkinPackOffer[] = Object.freeze([
  Object.freeze({
    sku: SKIN_PACK_ALL_RARE,
    rarity: 'rare' as const,
    title: 'Все редкие скины',
    skinIds: RARE_SKIN_IDS,
    targetPriceRub: SKIN_TARGET_PRICES.rare.packRub,
    targetPriceLabel: formatRub(SKIN_TARGET_PRICES.rare.packRub),
    priceSource: 'target' as const,
  }),
  Object.freeze({
    sku: SKIN_PACK_ALL_EPIC,
    rarity: 'epic' as const,
    title: 'Все эпические скины',
    skinIds: EPIC_SKIN_IDS,
    targetPriceRub: SKIN_TARGET_PRICES.epic.packRub,
    targetPriceLabel: formatRub(SKIN_TARGET_PRICES.epic.packRub),
    priceSource: 'target' as const,
  }),
]);

const PACKS_BY_SKU = new Map(SKIN_PACK_OFFERS.map((pack) => [pack.sku, pack]));

export function skinStoreEntry(skinId: string): SkinStoreEntry | undefined {
  return ENTRIES.get(skinId);
}

export function skinRarity(skinId: string): SkinRarity | undefined {
  return ENTRIES.get(skinId)?.rarity;
}

export function skinAcquisition(skinId: string): SkinAcquisition | undefined {
  return ENTRIES.get(skinId)?.acquisition;
}

export function orderedSkinIds(): readonly string[] {
  return ORDERED_IDS;
}

/** Texture descriptors in store order. Throws if a classified id has no PNG descriptor. */
export function orderedPlayerSkins(): readonly MinecraftSkinDescriptor[] {
  return ORDERED_IDS.map((skinId) => {
    const descriptor = skinDescriptor(skinId);
    if (!descriptor) throw new Error(`Skin ${skinId} is missing from the texture catalog.`);
    return descriptor;
  });
}

export function skinStoreCounts(): {
  readonly common: number;
  readonly rare: number;
  readonly epic: number;
  readonly legendary: number;
  readonly total: number;
} {
  return Object.freeze({
    common: COMMON_SKIN_IDS.length,
    rare: RARE_SKIN_IDS.length,
    epic: EPIC_SKIN_IDS.length,
    legendary: LEGENDARY_SKIN_IDS.length,
    total: ORDERED_IDS.length,
  });
}

export function skinProductOffer(skinId: string): SkinProductOffer | undefined {
  const entry = ENTRIES.get(skinId);
  if (!entry?.sku || entry.targetPriceRub === undefined || entry.targetPriceLabel === undefined) return undefined;
  if (entry.rarity !== 'rare' && entry.rarity !== 'epic') return undefined;
  return {
    sku: entry.sku,
    skinId,
    rarity: entry.rarity,
    targetPriceRub: entry.targetPriceRub,
    targetPriceLabel: entry.targetPriceLabel,
    priceSource: 'target',
  };
}

export function skinPackOffer(sku: string): SkinPackOffer | undefined {
  return PACKS_BY_SKU.get(sku as SkinPackOffer['sku']);
}

export function skinPackForRarity(rarity: SkinRarity): SkinPackOffer | undefined {
  return SKIN_PACK_OFFERS.find((pack) => pack.rarity === rarity);
}

/**
 * Production ids must match the rarity assignment exactly.
 * A new gameplay PNG is not silently treated as a free common skin.
 * NPC and DEV ids are not part of this set and are not required here.
 */
export function assertProductionSkinsHaveRarity(productionIds: readonly string[]): void {
  const assigned = new Set(ORDERED_IDS);
  const seen = new Set<string>();
  for (const skinId of productionIds) {
    if (seen.has(skinId)) throw new Error(`Skin ${skinId} is listed more than once.`);
    seen.add(skinId);
    if (!assigned.has(skinId)) throw new Error(`Skin ${skinId} has no rarity metadata.`);
  }
  for (const skinId of assigned) {
    if (!seen.has(skinId)) {
      throw new Error(`Skin ${skinId} has rarity metadata but is not a production player skin.`);
    }
  }
}
