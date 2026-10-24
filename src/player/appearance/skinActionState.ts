import type { PlayerAppearance } from './PlayerAppearance';
import { REWARDED_SKIN_COPY } from './rewardedSkinFlow';
import {
  SKIN_PACK_ALL_EPIC,
  SKIN_PACK_ALL_RARE,
  skinPackForRarity,
  skinStoreEntry,
  type SkinAcquisition,
  type SkinRarity,
  type SkinStoreEntry,
} from './skinStoreCatalog';

/**
 * UI-only reflection of a future server decision.
 *
 * This object is not a receipt and is not accepted by the server entitlement
 * check. The live selector does not invent one from saved appearance, a nickname,
 * or an admin flag. A malformed snapshot grants nothing.
 */
export interface SkinAccessSnapshot {
  readonly ownedSkinIds?: readonly string[];
  readonly ownedPackIds?: readonly string[];
  readonly adminLegendarySkinIds?: readonly string[];
}

/**
 * Platform readiness.
 * `rewardedAds` allows the client to request a video. It does not equip a skin.
 * `purchases` does not unlock rare or epic skins.
 */
export interface MonetizationAvailability {
  readonly rewardedAds: boolean;
  readonly purchases: boolean;
}

export const STAGE1_MONETIZATION: MonetizationAvailability = Object.freeze({
  rewardedAds: false,
  purchases: false,
});

/** The live client may ask for a rewarded video. Purchases stay off. */
export const REWARDED_SKIN_AVAILABILITY: MonetizationAvailability = Object.freeze({
  rewardedAds: true,
  purchases: false,
});

export type SkinActionKind =
  | 'confirm_default'
  | 'already_equipped'
  | 'request_rewarded_ad'
  | 'rewarded_unavailable'
  | 'purchase_unavailable'
  | 'legendary_locked'
  | 'confirm_owned'
  | 'confirm_admin'
  | 'unavailable';

export interface SkinActionState {
  readonly kind: SkinActionKind;
  readonly label: string;
  /** Same as `buttonEnabled`. Kept for the existing button binding. */
  readonly enabled: boolean;
  readonly buttonEnabled: boolean;
  /** The SDK can open a rewarded video. This is not permission to equip. */
  readonly advertisementReady: boolean;
  /** True only while a one-switch grant is in hand. The resolver never sets this. */
  readonly rewardEarned: boolean;
  /** Same as `appearanceCommitAllowed`. */
  readonly commitsAppearance: boolean;
  readonly appearanceCommitAllowed: boolean;
  readonly emphasis: 'primary' | 'neutral';
  readonly detail: string;
  readonly rarity?: SkinRarity;
  readonly acquisition?: SkinAcquisition;
  readonly targetPriceLabel?: string;
}

export interface ResolveSkinActionInput {
  readonly selectedSkinId: string;
  readonly equippedSkinId: string;
  readonly accessSnapshot?: SkinAccessSnapshot | null;
  readonly monetizationAvailability?: MonetizationAvailability;
  /** Separate from `rewardedAds`. False keeps the request button disabled. */
  readonly advertisementReady?: boolean;
}

interface SkinGrants {
  readonly ownedSkinIds: readonly string[];
  readonly ownedPackIds: readonly string[];
  readonly adminLegendarySkinIds: readonly string[];
}

const EMPTY_GRANTS: SkinGrants = Object.freeze({
  ownedSkinIds: [],
  ownedPackIds: [],
  adminLegendarySkinIds: [],
});

const ALLOWED_SNAPSHOT_KEYS = new Set([
  'ownedSkinIds',
  'ownedPackIds',
  'adminLegendarySkinIds',
]);

function stringList(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return value;
}

/** Fail closed. Extra keys, wrong types, and non-objects grant nothing. */
export function readSkinAccessSnapshot(snapshot: unknown): SkinGrants {
  if (snapshot === undefined || snapshot === null) return EMPTY_GRANTS;
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) return EMPTY_GRANTS;
  const raw = snapshot as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_SNAPSHOT_KEYS.has(key)) return EMPTY_GRANTS;
  }
  const ownedSkinIds = stringList(raw.ownedSkinIds);
  const ownedPackIds = stringList(raw.ownedPackIds);
  const adminLegendarySkinIds = stringList(raw.adminLegendarySkinIds);
  if (!ownedSkinIds || !ownedPackIds || !adminLegendarySkinIds) return EMPTY_GRANTS;
  return { ownedSkinIds, ownedPackIds, adminLegendarySkinIds };
}

function stateFor(
  entry: SkinStoreEntry | undefined,
  kind: SkinActionKind,
  label: string,
  enabled: boolean,
  commitsAppearance: boolean,
  detail = '',
  advertisementReady = false,
): SkinActionState {
  return {
    kind,
    label,
    enabled,
    buttonEnabled: enabled,
    advertisementReady,
    rewardEarned: false,
    commitsAppearance,
    appearanceCommitAllowed: commitsAppearance,
    emphasis: commitsAppearance || (kind === 'request_rewarded_ad' && enabled) ? 'primary' : 'neutral',
    detail,
    ...(entry ? { rarity: entry.rarity, acquisition: entry.acquisition } : {}),
    ...(entry?.targetPriceLabel ? { targetPriceLabel: entry.targetPriceLabel } : {}),
  };
}

function packGrants(entry: SkinStoreEntry, grants: SkinGrants): boolean {
  if (entry.rarity === 'rare') return grants.ownedPackIds.includes(SKIN_PACK_ALL_RARE);
  if (entry.rarity === 'epic') return grants.ownedPackIds.includes(SKIN_PACK_ALL_EPIC);
  return false;
}

/**
 * Button state for the skin that is currently previewed.
 * Preview itself is always allowed. Only `appearanceCommitAllowed` may reach
 * `Game.setPlayerAppearance` through the ordinary confirm path.
 * `request_rewarded_ad` asks for a video. It does not equip the skin.
 */
export function resolveSkinActionState(input: ResolveSkinActionInput): SkinActionState {
  const entry = skinStoreEntry(input.selectedSkinId);
  if (!entry) return stateFor(undefined, 'unavailable', 'Недоступно', false, false);
  if (input.selectedSkinId === input.equippedSkinId) {
    return stateFor(entry, 'already_equipped', 'Уже выбран', true, false);
  }
  if (entry.acquisition === 'default') {
    return stateFor(entry, 'confirm_default', 'Подтвердить', true, true);
  }

  const grants = readSkinAccessSnapshot(input.accessSnapshot);
  const availability = input.monetizationAvailability ?? STAGE1_MONETIZATION;
  if (entry.acquisition === 'rewarded_ad') {
    if (!availability.rewardedAds) {
      return stateFor(
        entry,
        'rewarded_unavailable',
        REWARDED_SKIN_COPY.soon,
        false,
        false,
        REWARDED_SKIN_COPY.soonDetail,
      );
    }
    const ready = input.advertisementReady === true;
    return stateFor(
      entry,
      'request_rewarded_ad',
      REWARDED_SKIN_COPY.watch,
      ready,
      false,
      ready ? REWARDED_SKIN_COPY.offer : REWARDED_SKIN_COPY.unavailable,
      ready,
    );
  }
  if (entry.acquisition === 'purchase') {
    const ownsSkin = entry.rarity === 'rare' || entry.rarity === 'epic'
      ? grants.ownedSkinIds.includes(entry.skinId) || packGrants(entry, grants)
      : false;
    if (ownsSkin) return stateFor(entry, 'confirm_owned', 'Подтвердить', true, true);
    const price = entry.targetPriceLabel ?? '';
    return stateFor(
      entry,
      'purchase_unavailable',
      'Покупки скоро',
      false,
      false,
      price ? `Целевая цена: ${price}` : '',
    );
  }
  if (grants.adminLegendarySkinIds.includes(entry.skinId)) {
    return stateFor(entry, 'confirm_admin', 'Подтвердить', true, true);
  }
  return stateFor(
    entry,
    'legendary_locked',
    'Недоступно',
    false,
    false,
    'Легендарный скин закреплён за администратором.',
  );
}

/**
 * Appearance to pass into `setPlayerAppearance`, or nothing when the click
 * must not equip. An empty access snapshot is the stage 1 default.
 */
export function commitSelectedSkinAppearance(
  selected: PlayerAppearance,
  equippedSkinId: string,
  accessSnapshot?: SkinAccessSnapshot | null,
  monetizationAvailability: MonetizationAvailability = STAGE1_MONETIZATION,
): PlayerAppearance | undefined {
  const availability = monetizationAvailability ?? STAGE1_MONETIZATION;
  const state = resolveSkinActionState({
    selectedSkinId: selected.skinId,
    equippedSkinId,
    accessSnapshot,
    monetizationAvailability: availability,
  });
  if (
    state.kind === 'request_rewarded_ad'
    || state.kind === 'rewarded_unavailable'
    || state.kind === 'purchase_unavailable'
  ) return undefined;
  if ((availability.rewardedAds || availability.purchases) && !state.appearanceCommitAllowed) return undefined;
  return state.appearanceCommitAllowed ? selected : undefined;
}

/** Corner mark for paid and admin skins that this snapshot does not unlock. */
export function skinCardLocked(skinId: string, accessSnapshot?: SkinAccessSnapshot | null): boolean {
  const entry = skinStoreEntry(skinId);
  if (!entry || entry.acquisition === 'default' || entry.acquisition === 'rewarded_ad') return false;
  const state = resolveSkinActionState({
    selectedSkinId: skinId,
    equippedSkinId: '',
    accessSnapshot,
  });
  return !state.commitsAppearance;
}

export function skinPackPriceLabel(rarity: SkinRarity): string | undefined {
  return skinPackForRarity(rarity)?.targetPriceLabel;
}
