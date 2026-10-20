import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  sanitizeRegisteredAppearance,
} from '../src/player/appearance/PlayerAppearance';
import { PlayerSkinSelectorSession } from '../src/player/appearance/PlayerSkinSelector';
import { PRODUCTION_PLAYER_SKINS } from '../src/player/appearance/builtinSkins';
import {
  STAGE1_MONETIZATION,
  commitSelectedSkinAppearance,
  resolveSkinActionState,
} from '../src/player/appearance/skinActionState';
import { evaluateServerSkinEquip, type ServerSkinEntitlement } from '../src/player/appearance/skinEntitlementPolicy';
import {
  COMMON_SKIN_IDS,
  EPIC_SKIN_IDS,
  LEGENDARY_SKIN_IDS,
  RARE_SKIN_IDS,
  SKIN_PACK_ALL_EPIC,
  SKIN_PACK_ALL_RARE,
  SKIN_TARGET_PRICES,
  assertProductionSkinsHaveRarity,
  orderedPlayerSkins,
  orderedSkinIds,
  skinAcquisition,
  skinPackOffer,
  skinProductOffer,
  skinRarity,
  skinStoreCounts,
  skinStoreEntry,
} from '../src/player/appearance/skinStoreCatalog';
import {
  assertPlayerSkinsHaveRarity,
  readSkinRarityAssignments,
} from '../scripts/generate-player-skins.mjs';
import gameSource from '../src/core/Game.ts?raw';
import worldSource from '../server/WorldInstance.ts?raw';

const APPROVED_COMMON = [
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

const APPROVED_RARE = [
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

const APPROVED_EPIC = [
  '211085684a03470a',
  '3171abd1dedfa703',
  '55264c2ebdb9ed9d',
  'b834368ba96d6574',
  'c7e629b4f28c56a5',
  'd3f7b2f0b6d834b9',
  'ded78bc20ae6f892',
  'f7b4ab3f68df5fca',
] as const;

const APPROVED_LEGENDARY = ['ae1fddb72664eaf2', 'e126128225dccc51'] as const;

const RARE_ID = APPROVED_RARE[0];
const EPIC_ID = APPROVED_EPIC[0];
const LEGENDARY_ID = APPROVED_LEGENDARY[0];
const OTHER_LEGENDARY_ID = APPROVED_LEGENDARY[1];
const COMMON_ID = APPROVED_COMMON[1];

function strictEntitlement(patch: Partial<ServerSkinEntitlement> = {}): ServerSkinEntitlement {
  return {
    enforcement: 'on',
    equippedSkinId: DEFAULT_PLAYER_APPEARANCE.skinId,
    ownedSkinIds: [],
    ownedPackIds: [],
    adminLegendarySkinIds: [],
    ...patch,
  };
}

describe('skin store classification', () => {
  it('matches the approved 40/14/8/2 ids', () => {
    expect([...COMMON_SKIN_IDS]).toEqual([...APPROVED_COMMON]);
    expect([...RARE_SKIN_IDS]).toEqual([...APPROVED_RARE]);
    expect([...EPIC_SKIN_IDS]).toEqual([...APPROVED_EPIC]);
    expect([...LEGENDARY_SKIN_IDS]).toEqual([...APPROVED_LEGENDARY]);
    expect(skinStoreCounts()).toEqual({ common: 40, rare: 14, epic: 8, legendary: 2, total: 64 });
    expect(new Set([...COMMON_SKIN_IDS, ...RARE_SKIN_IDS, ...EPIC_SKIN_IDS, ...LEGENDARY_SKIN_IDS]).size).toBe(64);
  });

  it('covers production skins once and leaves NPC and DEV sheets out', () => {
    const productionIds = PRODUCTION_PLAYER_SKINS.map((skin) => skin.id);
    expect(new Set(orderedSkinIds())).toEqual(new Set(productionIds));
    expect(() => assertProductionSkinsHaveRarity(productionIds)).not.toThrow();
    expect(skinStoreEntry('buyer_merchant')).toBeUndefined();
    expect(skinStoreEntry('player_uv_test')).toBeUndefined();
    expect(skinStoreEntry('10126ef69e2cdfdf')).toBeUndefined();
    expect(orderedSkinIds()).not.toContain('buyer_merchant');
    expect(orderedSkinIds()).not.toContain('player_uv_test');
    expect(orderedSkinIds()).not.toContain('10126ef69e2cdfdf');
  });

  it('pins the free starter first and keeps category boundaries', () => {
    const ordered = orderedSkinIds();
    expect(ordered[0]).toBe('frontier_explorer');
    expect(skinRarity('frontier_explorer')).toBe('common');
    expect(skinAcquisition('frontier_explorer')).toBe('default');
    expect(skinProductOffer('frontier_explorer')).toBeUndefined();
    expect(ordered.slice(0, 40)).toEqual([...APPROVED_COMMON]);
    expect(ordered.slice(40, 54)).toEqual([...APPROVED_RARE]);
    expect(ordered.slice(54, 62)).toEqual([...APPROVED_EPIC]);
    expect(ordered.slice(62)).toEqual([...APPROVED_LEGENDARY]);
    expect(orderedPlayerSkins().map((skin) => skin.id)).toEqual([...ordered]);
    expect(new PlayerSkinSelectorSession(DEFAULT_PLAYER_APPEARANCE).skins.map((skin) => skin.id)).toEqual([...ordered]);
  });

  it('sells rare and epic skins with stable SKUs and keeps legendary admin-only', () => {
    const skus = new Set<string>();
    for (const skinId of RARE_SKIN_IDS) {
      expect(skinRarity(skinId)).toBe('rare');
      expect(skinAcquisition(skinId)).toBe('purchase');
      const offer = skinProductOffer(skinId);
      expect(offer).toMatchObject({
        sku: `skin_rare_${skinId}`,
        targetPriceRub: 29,
        targetPriceLabel: '29 ₽',
        priceSource: 'target',
      });
      skus.add(offer!.sku);
    }
    for (const skinId of EPIC_SKIN_IDS) {
      const offer = skinProductOffer(skinId);
      expect(offer).toMatchObject({
        sku: `skin_epic_${skinId}`,
        targetPriceRub: 149,
        targetPriceLabel: '149 ₽',
        priceSource: 'target',
      });
      skus.add(offer!.sku);
    }
    for (const skinId of LEGENDARY_SKIN_IDS) {
      expect(skinRarity(skinId)).toBe('legendary');
      expect(skinAcquisition(skinId)).toBe('admin_only');
      expect(skinStoreEntry(skinId)?.sku).toBeUndefined();
      expect(skinProductOffer(skinId)).toBeUndefined();
    }
    for (const skinId of COMMON_SKIN_IDS) {
      if (skinId === 'frontier_explorer') continue;
      expect(skinAcquisition(skinId)).toBe('rewarded_ad');
      expect(skinProductOffer(skinId)).toBeUndefined();
    }
    expect(skus.size).toBe(RARE_SKIN_IDS.length + EPIC_SKIN_IDS.length);
    expect(skinPackOffer(SKIN_PACK_ALL_RARE)).toMatchObject({
      targetPriceRub: SKIN_TARGET_PRICES.rare.packRub,
      targetPriceLabel: '99 ₽',
      skinIds: RARE_SKIN_IDS,
    });
    expect(skinPackOffer(SKIN_PACK_ALL_EPIC)).toMatchObject({
      targetPriceRub: 299,
      targetPriceLabel: '299 ₽',
      skinIds: EPIC_SKIN_IDS,
    });
  });

  it('fails closed when a new gameplay skin has no rarity', () => {
    const productionIds = PRODUCTION_PLAYER_SKINS.map((skin) => skin.id);
    expect(() => assertProductionSkinsHaveRarity([...productionIds, 'abc123'])).toThrow('Skin abc123 has no rarity metadata.');
    expect(skinRarity('abc123')).toBeUndefined();
    expect(skinAcquisition('abc123')).toBeUndefined();
    expect(resolveSkinActionState({
      selectedSkinId: 'abc123',
      equippedSkinId: 'frontier_explorer',
    }).kind).toBe('unavailable');
    const groups = readSkinRarityAssignments(readFileSync('src/player/appearance/skinStoreCatalog.ts', 'utf8'));
    expect(groups.common).toEqual([...COMMON_SKIN_IDS]);
    expect(groups.rare).toEqual([...RARE_SKIN_IDS]);
    expect(groups.epic).toEqual([...EPIC_SKIN_IDS]);
    expect(groups.legendary).toEqual([...LEGENDARY_SKIN_IDS]);
    expect(() => assertPlayerSkinsHaveRarity([...productionIds, 'abc123'], groups)).toThrow('Skin abc123 has no rarity metadata.');
    expect(() => assertPlayerSkinsHaveRarity(productionIds.filter((id) => id !== 'buyer_merchant'), groups)).not.toThrow();
  });
});

describe('skin action and server entitlement', () => {
  it('commits only the free starter from the stage 1 snapshot', () => {
    const starter = createPlayerAppearance({ skinId: 'frontier_explorer' });
    expect(commitSelectedSkinAppearance(starter, RARE_ID, undefined, STAGE1_MONETIZATION)?.skinId).toBe('frontier_explorer');
    expect(commitSelectedSkinAppearance(starter, 'frontier_explorer')).toBeUndefined();
    for (const skinId of [COMMON_ID, RARE_ID, EPIC_ID, LEGENDARY_ID]) {
      const selected = createPlayerAppearance({ skinId });
      expect(commitSelectedSkinAppearance(selected, 'frontier_explorer', undefined, {
        rewardedAds: true,
        purchases: true,
      })).toBeUndefined();
      expect(resolveSkinActionState({
        selectedSkinId: skinId,
        equippedSkinId: 'frontier_explorer',
        monetizationAvailability: { rewardedAds: true, purchases: true },
      }).commitsAppearance).toBe(false);
    }
  });

  it('keeps an already equipped skin from asking for another reward', () => {
    const selected = createPlayerAppearance({ skinId: COMMON_ID, model: 'slim' });
    const state = resolveSkinActionState({ selectedSkinId: COMMON_ID, equippedSkinId: COMMON_ID });
    expect(state.kind).toBe('already_equipped');
    expect(state.label).toBe('Уже выбран');
    expect(commitSelectedSkinAppearance(selected, COMMON_ID)).toBeUndefined();
  });

  it('ignores a broken client snapshot and does not treat it as server ownership', () => {
    const broken = { ownedSkinIds: [RARE_ID], isAdmin: true, nickname: 'Admin' };
    expect(resolveSkinActionState({
      selectedSkinId: RARE_ID,
      equippedSkinId: 'frontier_explorer',
      accessSnapshot: broken as never,
    }).commitsAppearance).toBe(false);
    expect(resolveSkinActionState({
      selectedSkinId: LEGENDARY_ID,
      equippedSkinId: 'frontier_explorer',
      accessSnapshot: { ownedSkinIds: 'all' } as never,
    }).kind).toBe('legendary_locked');
    expect(resolveSkinActionState({
      selectedSkinId: COMMON_ID,
      equippedSkinId: 'frontier_explorer',
      accessSnapshot: { ownedSkinIds: [COMMON_ID] },
    }).kind).toBe('rewarded_unavailable');

    const uiGrant = { ownedSkinIds: [RARE_ID], ownedPackIds: [], adminLegendarySkinIds: [] };
    expect(commitSelectedSkinAppearance(
      createPlayerAppearance({ skinId: RARE_ID }),
      'frontier_explorer',
      uiGrant,
    )?.skinId).toBe(RARE_ID);
    expect(evaluateServerSkinEquip(RARE_ID, strictEntitlement()).allowed).toBe(false);
    expect(evaluateServerSkinEquip(RARE_ID, strictEntitlement()).reason).toBe('purchase_required');
  });

  it('denies paid and legendary skins when enforcement is on', () => {
    expect(sanitizeRegisteredAppearance({ skinId: RARE_ID, model: 'slim' })?.skinId).toBe(RARE_ID);
    expect(evaluateServerSkinEquip(RARE_ID, { ...strictEntitlement(), enforcement: 'off' })).toMatchObject({
      allowed: true,
      reason: 'enforcement_disabled',
    });
    expect(evaluateServerSkinEquip(LEGENDARY_ID, { ...strictEntitlement(), enforcement: 'off' }).allowed).toBe(true);
    expect(evaluateServerSkinEquip('buyer_merchant', strictEntitlement({ enforcement: 'off' })).allowed).toBe(false);
    expect(evaluateServerSkinEquip('not_a_skin', strictEntitlement()).reason).toBe('unknown_skin');

    expect(evaluateServerSkinEquip('frontier_explorer', strictEntitlement()).reason).toBe('default');
    expect(evaluateServerSkinEquip(COMMON_ID, strictEntitlement()).reason).toBe('reward_required');
    expect(evaluateServerSkinEquip(RARE_ID, strictEntitlement()).reason).toBe('purchase_required');
    expect(evaluateServerSkinEquip(EPIC_ID, strictEntitlement()).reason).toBe('purchase_required');
    expect(evaluateServerSkinEquip(LEGENDARY_ID, strictEntitlement()).reason).toBe('admin_required');
    expect(evaluateServerSkinEquip(LEGENDARY_ID, strictEntitlement({
      equippedSkinId: LEGENDARY_ID,
    })).reason).toBe('admin_required');
  });

  it('accepts server-owned purchases, one reward token, and one admin skin', () => {
    const owned = strictEntitlement({ ownedSkinIds: [RARE_ID] });
    expect(evaluateServerSkinEquip(RARE_ID, owned).reason).toBe('owned_skin');
    expect(evaluateServerSkinEquip(APPROVED_RARE[1], owned).reason).toBe('purchase_required');
    expect(evaluateServerSkinEquip(RARE_ID, strictEntitlement({ ownedPackIds: [SKIN_PACK_ALL_RARE] })).reason).toBe('owned_pack');
    expect(evaluateServerSkinEquip(EPIC_ID, strictEntitlement({ ownedPackIds: [SKIN_PACK_ALL_RARE] })).reason).toBe('purchase_required');
    expect(evaluateServerSkinEquip(EPIC_ID, strictEntitlement({ ownedPackIds: [SKIN_PACK_ALL_EPIC] })).reason).toBe('owned_pack');
    expect(evaluateServerSkinEquip(COMMON_ID, strictEntitlement({ ownedSkinIds: [COMMON_ID] })).reason).toBe('reward_required');

    const reward = strictEntitlement({ rewardedSkinId: COMMON_ID });
    const first = evaluateServerSkinEquip(COMMON_ID, reward);
    expect(first).toEqual({ allowed: true, reason: 'rewarded_switch', consumeReward: true });
    expect(reward.rewardedSkinId).toBe(COMMON_ID);
    expect(evaluateServerSkinEquip(APPROVED_COMMON[2], reward).reason).toBe('reward_required');
    expect(evaluateServerSkinEquip(COMMON_ID, strictEntitlement()).reason).toBe('reward_required');

    expect(evaluateServerSkinEquip(LEGENDARY_ID, strictEntitlement({
      adminLegendarySkinIds: [LEGENDARY_ID],
    })).reason).toBe('admin');
    expect(evaluateServerSkinEquip(OTHER_LEGENDARY_ID, strictEntitlement({
      adminLegendarySkinIds: [LEGENDARY_ID],
    })).reason).toBe('admin_required');
    const disguised = {
      ...strictEntitlement(),
      nickname: 'Admin',
      isAdmin: true,
    };
    expect(evaluateServerSkinEquip(LEGENDARY_ID, disguised).reason).toBe('admin_required');
  });

  it('keeps a previously worn skin only when the migration flag is set', () => {
    const worn = strictEntitlement({ equippedSkinId: LEGENDARY_ID });
    expect(evaluateServerSkinEquip(LEGENDARY_ID, worn).reason).toBe('admin_required');
    expect(evaluateServerSkinEquip(LEGENDARY_ID, { ...worn, allowLegacyEquipped: true }).reason).toBe('legacy_equipped');
    expect(evaluateServerSkinEquip(RARE_ID, { ...worn, allowLegacyEquipped: true }).reason).toBe('purchase_required');
  });

  it('leaves the live server whitelist in place', () => {
    const body = worldSource.slice(worldSource.indexOf('setAppearance('), worldSource.indexOf('private broadcastChat'));
    expect(body).toContain('sanitizeRegisteredAppearance');
    expect(body).not.toContain('evaluateServerSkinEquip');
    const confirm = gameSource.slice(gameSource.indexOf('confirm: () =>'), gameSource.indexOf('cancel: () =>'));
    expect(confirm).toContain('undefined');
    expect(confirm).toContain('STAGE1_MONETIZATION');
    expect(confirm).not.toContain('localStorage');
    expect(confirm).not.toContain('isAdmin');
  });
});
