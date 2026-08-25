import { describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';
import {
  MAX_ARMOR_POINTS,
  SurvivalSystem,
  getArmorPoints,
  getArmorStats,
  reduceDamageByArmor,
} from '../src/survival';
import { ARMOR_HUD_ICON_COUNT, armorHudIcons } from '../src/ui/armorHud';

const SLOT_NAMES = {
  head: 'helmet',
  chest: 'chestplate',
  legs: 'leggings',
  feet: 'boots',
} as const;

const VANILLA_DEFENSE = {
  leather: { head: 1, chest: 3, legs: 2, feet: 1, total: 7 },
  gold: { head: 2, chest: 5, legs: 3, feet: 1, total: 11 },
  iron: { head: 2, chest: 6, legs: 5, feet: 2, total: 15 },
  diamond: { head: 3, chest: 8, legs: 6, feet: 3, total: 20 },
} as const;

function armorId(material: keyof typeof VANILLA_DEFENSE, slot: keyof typeof SLOT_NAMES): string {
  return `${material}_${SLOT_NAMES[slot]}`;
}

function equip(inventory: Inventory, pieces: ReadonlyArray<readonly [keyof typeof SLOT_NAMES, string]>): void {
  for (const [slot, itemId] of pieces) {
    inventory.setSlot({ section: 'armor', slot }, createItemStack(itemId));
  }
}

function equipSet(inventory: Inventory, material: keyof typeof VANILLA_DEFENSE): void {
  equip(inventory, (Object.keys(SLOT_NAMES) as Array<keyof typeof SLOT_NAMES>).map((slot) => [slot, armorId(material, slot)]));
}

function iconCounts(points: number): { full: number; half: number; empty: number; visible: boolean } {
  const hud = armorHudIcons(points);
  return {
    visible: hud.visible,
    full: hud.icons.filter((icon) => icon === 'full').length,
    half: hud.icons.filter((icon) => icon === 'half').length,
    empty: hud.icons.filter((icon) => icon === 'empty').length,
  };
}

describe('existing armor piece values', () => {
  it('keeps leather, gold, iron and diamond defense on the vanilla 1.9 table', () => {
    expect(ItemId.GoldHelmet).toBe('gold_helmet');
    expect(ItemId.LeatherHelmet).toBe('leather_helmet');
    for (const [material, expected] of Object.entries(VANILLA_DEFENSE)) {
      for (const slot of Object.keys(SLOT_NAMES) as Array<keyof typeof SLOT_NAMES>) {
        const definition = getItemDefinition(armorId(material as keyof typeof VANILLA_DEFENSE, slot));
        expect(definition.kind).toBe('armor');
        if (definition.kind !== 'armor') continue;
        expect(definition.defense, `${material} ${slot}`).toBe(expected[slot]);
      }
    }
  });

  it('does not register chainmail or netherite sets', () => {
    expect(() => getItemDefinition('chainmail_chestplate')).toThrow();
    expect(() => getItemDefinition('netherite_chestplate')).toThrow();
  });
});

describe('canonical armor totals', () => {
  it('sums equipped pieces to vanilla full-set totals', () => {
    const inventory = new Inventory();
    expect(getArmorPoints(inventory)).toBe(0);
    for (const [material, expected] of Object.entries(VANILLA_DEFENSE)) {
      inventory.clear();
      equipSet(inventory, material as keyof typeof VANILLA_DEFENSE);
      expect(getArmorPoints(inventory), material).toBe(expected.total);
      expect(getArmorStats(inventory).points).toBe(getArmorPoints(inventory));
    }
  });

  it('reads mixed sets from equipment, not from a set name', () => {
    const inventory = new Inventory();
    equip(inventory, [
      ['head', ItemId.IronHelmet],
      ['chest', ItemId.IronChestplate],
      ['legs', ItemId.DiamondLeggings],
      ['feet', ItemId.LeatherBoots],
    ]);
    expect(getArmorPoints(inventory)).toBe(15);
    expect(armorHudIcons(getArmorPoints(inventory))).toMatchObject({
      visible: true,
      points: 15,
    });
    expect(iconCounts(getArmorPoints(inventory))).toEqual({ visible: true, full: 7, half: 1, empty: 2 });

    inventory.setSlot({ section: 'armor', slot: 'feet' }, null);
    expect(getArmorPoints(inventory)).toBe(14);
    expect(iconCounts(getArmorPoints(inventory))).toEqual({ visible: true, full: 7, half: 0, empty: 3 });
  });

  it('clamps the canonical total used by both HUD and damage', () => {
    expect(getArmorPoints({ points: 21, toughness: 0 })).toBe(MAX_ARMOR_POINTS);
    expect(getArmorPoints({ points: -4, toughness: 0 })).toBe(0);
    expect(getArmorStats({ points: 21, toughness: 0 }).points).toBe(getArmorPoints({ points: 21, toughness: 0 }));
  });
});

describe('armor HUD icons', () => {
  it('hides the bar at 0 and maps points to 10 full/half/empty icons', () => {
    expect(ARMOR_HUD_ICON_COUNT).toBe(10);
    expect(iconCounts(0)).toEqual({ visible: false, full: 0, half: 0, empty: 10 });
    expect(iconCounts(1)).toEqual({ visible: true, full: 0, half: 1, empty: 9 });
    expect(iconCounts(2)).toEqual({ visible: true, full: 1, half: 0, empty: 9 });
    expect(iconCounts(7)).toEqual({ visible: true, full: 3, half: 1, empty: 6 });
    expect(iconCounts(11)).toEqual({ visible: true, full: 5, half: 1, empty: 4 });
    expect(iconCounts(15)).toEqual({ visible: true, full: 7, half: 1, empty: 2 });
    expect(iconCounts(20)).toEqual({ visible: true, full: 10, half: 0, empty: 0 });
    expect(iconCounts(21)).toEqual({ visible: true, full: 10, half: 0, empty: 0 });
    expect(armorHudIcons(20).icons).toHaveLength(10);
  });
});

describe('armor still mitigates Fire and Lava', () => {
  it('reduces Fire and Lava through the same armor total the HUD reads', () => {
    const inventory = new Inventory();
    equipSet(inventory, 'iron');
    const points = getArmorPoints(inventory);
    expect(points).toBe(15);
    expect(iconCounts(points)).toEqual({ visible: true, full: 7, half: 1, empty: 2 });
    expect(reduceDamageByArmor(10, inventory)).toBe(reduceDamageByArmor(10, { points, toughness: 0 }));
    expect(reduceDamageByArmor(10, inventory)).toBeLessThan(10);

    const bare = new SurvivalSystem({ health: 20 });
    const armored = new SurvivalSystem({ health: 20 });
    expect(bare.damage(8, 'fire', { ignoreInvulnerability: true }).dealt).toBeGreaterThan(
      armored.damage(8, 'fire', { ignoreInvulnerability: true, armor: inventory }).dealt,
    );
    const lavaBare = new SurvivalSystem({ health: 20 });
    const lavaArmored = new SurvivalSystem({ health: 20 });
    expect(lavaBare.damage(8, 'lava', { ignoreInvulnerability: true }).dealt).toBeGreaterThan(
      lavaArmored.damage(8, 'lava', { ignoreInvulnerability: true, armor: inventory }).dealt,
    );
  });
});
