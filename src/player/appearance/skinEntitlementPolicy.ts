import { isProductionSkinId } from './builtinSkins';
import {
  SKIN_PACK_ALL_EPIC,
  SKIN_PACK_ALL_RARE,
  skinStoreEntry,
  type SkinStoreEntry,
} from './skinStoreCatalog';

/**
 * Future server-owned equip check.
 *
 * Not called from WorldInstance in this stage. The live server still accepts
 * any registered production skinId. Enabling this check is a separate rollout:
 * existing saves may already wear a rare, epic, or legendary skin, and that
 * fact is not a purchase.
 *
 * The context is filled only by server state. There is no nickname, client
 * receipt, or isAdmin flag. A browser access snapshot is not an input.
 */

export type SkinEquipReason =
  | 'default'
  | 'rewarded_switch'
  | 'owned_skin'
  | 'owned_pack'
  | 'admin'
  | 'legacy_equipped'
  | 'enforcement_disabled'
  | 'unknown_skin'
  | 'reward_required'
  | 'purchase_required'
  | 'admin_required';

export interface ServerSkinEntitlement {
  /** `off` matches today's whitelist-only server. `on` is fail-closed. */
  readonly enforcement: 'off' | 'on';
  readonly equippedSkinId: string;
  readonly ownedSkinIds: readonly string[];
  readonly ownedPackIds: readonly string[];
  /** Explicit legendary skin ids bound to this server identity. Not a nickname list. */
  readonly adminLegendarySkinIds: readonly string[];
  /**
   * One server-issued reward for a single common-skin switch.
   * The caller must clear it after a successful apply. This function does not
   * store a permanent common-skin entitlement.
   */
  readonly rewardedSkinId?: string;
  /**
   * Migration switch. When enforcement turns on, stage 2 must choose this
   * explicitly. It keeps a previously worn skin for that check only and does
   * not record a purchase.
   */
  readonly allowLegacyEquipped?: boolean;
}

export interface ServerSkinEquipDecision {
  readonly allowed: boolean;
  readonly reason: SkinEquipReason;
  /** The server must drop `rewardedSkinId` before applying, so one reward cannot equip two skins. */
  readonly consumeReward: boolean;
}

function denied(reason: SkinEquipReason): ServerSkinEquipDecision {
  return { allowed: false, reason, consumeReward: false };
}

function allowed(reason: SkinEquipReason, consumeReward = false): ServerSkinEquipDecision {
  return { allowed: true, reason, consumeReward };
}

function purchaseDecision(entry: SkinStoreEntry, entitlement: ServerSkinEntitlement): ServerSkinEquipDecision {
  if (entitlement.ownedSkinIds.includes(entry.skinId)) return allowed('owned_skin');
  if (entry.rarity === 'rare' && entitlement.ownedPackIds.includes(SKIN_PACK_ALL_RARE)) return allowed('owned_pack');
  if (entry.rarity === 'epic' && entitlement.ownedPackIds.includes(SKIN_PACK_ALL_EPIC)) return allowed('owned_pack');
  return denied('purchase_required');
}

export function evaluateServerSkinEquip(
  skinId: string,
  entitlement: ServerSkinEntitlement,
): ServerSkinEquipDecision {
  if (!isProductionSkinId(skinId)) return denied('unknown_skin');
  const entry = skinStoreEntry(skinId);
  if (!entry) return denied('unknown_skin');
  if (entitlement.enforcement === 'off') return allowed('enforcement_disabled');

  if (entry.acquisition === 'default') return allowed('default');
  if (entitlement.allowLegacyEquipped === true && entitlement.equippedSkinId === skinId) {
    return allowed('legacy_equipped');
  }
  if (entry.acquisition === 'rewarded_ad') {
    if (entitlement.rewardedSkinId === skinId) return allowed('rewarded_switch', true);
    return denied('reward_required');
  }
  if (entry.acquisition === 'purchase') return purchaseDecision(entry, entitlement);
  if (entitlement.adminLegendarySkinIds.includes(skinId)) return allowed('admin');
  return denied('admin_required');
}
