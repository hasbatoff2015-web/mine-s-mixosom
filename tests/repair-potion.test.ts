import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRAFTING_RECIPES } from '../src/crafting';
import { Inventory, createItemStack, restoredRemainingDurability } from '../src/inventory';
import {
  ItemId,
  REPAIR_POTION_RESTORE_FRACTION,
  getItemDefinition,
  obtainableItems,
} from '../src/items';
import { itemDescriptionFor } from '../src/i18n';
import { SurvivalSystem, armorDurabilityLoss } from '../src/survival';
import {
  BUYER_EXAMPLE_REPAIR_POTION_ITEM,
  BUYER_EXAMPLE_REPAIR_POTION_PRICE,
} from '../shared/buyers';
import { itemHoverAttributeString } from '../src/ui/itemTooltip';
import {
  applySlotSnapshots,
  slotDurabilityBarHtml,
  slotStateSignature,
} from '../src/ui/inventoryLayout';

function durabilityOf(itemId: string): number {
  const item = getItemDefinition(itemId);
  if (!('durability' in item) || item.durability === undefined) {
    throw new Error(`${itemId} has no durability`);
  }
  return item.durability;
}

function drinkRepairPotion(inventory: Inventory, slot = 0): boolean {
  const survival = new SurvivalSystem({ health: 20, hunger: 20 });
  inventory.setSlot(slot, createItemStack(ItemId.PotionRepair, inventory.getSlot(slot)?.count ?? 1));
  return survival.consumeFood(ItemId.PotionRepair, inventory);
}

describe('repair potion', () => {
  it('registers a drinkable potion with the existing bottle return and no lasting effect', () => {
    const item = getItemDefinition(ItemId.PotionRepair);
    expect(item.name).toBe('Зелье починки');
    expect(item.description).toBe('Восстанавливает 50% максимальной прочности всех повреждённых предметов');
    expect(itemDescriptionFor(ItemId.PotionRepair)).toBe(item.description);
    expect(item.kind).toBe('food');
    if (item.kind !== 'food') throw new Error('expected food item');
    expect(item.maxStack).toBe(64);
    expect(item.food).toMatchObject({
      alwaysEdible: true,
      returnsItem: ItemId.GlassBottle,
      repairLostDurabilityFraction: REPAIR_POTION_RESTORE_FRACTION,
    });
    expect(item.food.effects).toBeUndefined();
    expect(obtainableItems().some((entry) => entry.id === ItemId.PotionRepair)).toBe(true);
  });

  it('restores 50% of maximum durability and never exceeds max', () => {
    expect(restoredRemainingDurability(100, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(90, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(70, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(60, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(50, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(40, 100, 0.5)).toBe(90);
    expect(restoredRemainingDurability(20, 100, 0.5)).toBe(70);
    expect(restoredRemainingDurability(10, 100, 0.5)).toBe(60);
    expect(restoredRemainingDurability(1, 100, 0.5)).toBe(51);
    expect(restoredRemainingDurability(0, 100, 0.5)).toBe(50);

    const oddMax = 59;
    expect(restoredRemainingDurability(1, oddMax, 0.5)).toBe(1 + Math.round(oddMax * 0.5));
    expect(restoredRemainingDurability(oddMax, oddMax, 0.5)).toBe(oddMax);

    const pickMax = durabilityOf(ItemId.IronPickaxe);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.IronPickaxe, 1, { durability: 20 }));
    inventory.setSlot(1, createItemStack(ItemId.PotionRepair));
    expect(new SurvivalSystem({ health: 20, hunger: 20 }).consumeFood(ItemId.PotionRepair, inventory)).toBe(true);
    const restored = inventory.getSlot(0);
    expect(restored?.durability).toBe(restoredRemainingDurability(20, pickMax, 0.5));
    expect(restored!.durability!).toBeLessThanOrEqual(pickMax);
  });

  it('fully restores a 20/100 item after two drinks', () => {
    expect(restoredRemainingDurability(20, 100, 0.5)).toBe(70);
    expect(restoredRemainingDurability(70, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(10, 100, 0.5)).toBe(60);
    expect(restoredRemainingDurability(60, 100, 0.5)).toBe(100);

    const swordMax = durabilityOf(ItemId.IronSword);
    const start = Math.min(20, swordMax - 1);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.IronSword, 1, { durability: start }));
    inventory.setSlot(1, createItemStack(ItemId.PotionRepair, 2));
    expect(drinkRepairPotion(inventory, 1)).toBe(true);
    const afterFirst = inventory.getSlot(0)?.durability ?? swordMax;
    expect(afterFirst).toBe(restoredRemainingDurability(start, swordMax, 0.5));
    expect(drinkRepairPotion(inventory, 1)).toBe(true);
    expect(inventory.getSlot(0)?.durability).toBeUndefined();
    expect(inventory.getSlot(0)).toEqual({ itemId: ItemId.IronSword, count: 1 });
  });

  it('repairs every durability item in hotbar, inventory, armor and offhand, and ignores the rest', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.IronSword, 1, { durability: 20 }));
    inventory.setSlot(12, createItemStack(ItemId.IronPickaxe, 1, { durability: 40 }));
    inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack(ItemId.IronHelmet, 1, { durability: 30 }));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.IronChestplate, 1, { durability: 50 }));
    inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack(ItemId.IronLeggings, 1, { durability: 40 }));
    inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack(ItemId.IronBoots, 1, { durability: 20 }));
    inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.FlintAndSteel, 1, { durability: 10 }));
    inventory.setSlot(3, createItemStack(ItemId.Apple, 8));
    inventory.setSlot(4, createItemStack(ItemId.IronIngot, 16));
    inventory.setSlot(5, createItemStack(ItemId.PotionRepair, 2));

    expect(drinkRepairPotion(inventory, 5)).toBe(true);

    const swordMax = durabilityOf(ItemId.IronSword);
    const pickMax = durabilityOf(ItemId.IronPickaxe);
    const helmMax = durabilityOf(ItemId.IronHelmet);
    const chestMax = durabilityOf(ItemId.IronChestplate);
    const legsMax = durabilityOf(ItemId.IronLeggings);
    const bootsMax = durabilityOf(ItemId.IronBoots);
    const flintMax = durabilityOf(ItemId.FlintAndSteel);
    expect(inventory.getSlot(0)?.durability).toBe(restoredRemainingDurability(20, swordMax, 0.5));
    expect(inventory.getSlot(12)?.durability).toBe(restoredRemainingDurability(40, pickMax, 0.5));
    expect(inventory.armor.head?.durability).toBe(restoredRemainingDurability(30, helmMax, 0.5));
    expect(inventory.armor.chest?.durability).toBe(restoredRemainingDurability(50, chestMax, 0.5));
    expect(inventory.armor.legs?.durability).toBe(restoredRemainingDurability(40, legsMax, 0.5));
    expect(inventory.armor.feet?.durability).toBe(restoredRemainingDurability(20, bootsMax, 0.5));
    expect(inventory.offhand?.durability).toBe(restoredRemainingDurability(10, flintMax, 0.5));
    expect(inventory.getSlot(3)).toEqual({ itemId: ItemId.Apple, count: 8 });
    expect(inventory.getSlot(4)).toEqual({ itemId: ItemId.IronIngot, count: 16 });
    expect(inventory.count(ItemId.PotionRepair)).toBe(1);
    expect(inventory.count(ItemId.GlassBottle)).toBe(1);
  });

  it('does not change pristine items and still consumes the last potion', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    inventory.setSlot(1, createItemStack(ItemId.PotionRepair));
    expect(new SurvivalSystem({ health: 20, hunger: 20 }).consumeFood(ItemId.PotionRepair, inventory)).toBe(true);
    expect(inventory.getSlot(0)).toEqual({ itemId: ItemId.DiamondSword, count: 1 });
    expect(inventory.count(ItemId.PotionRepair)).toBe(0);
    expect(inventory.count(ItemId.GlassBottle)).toBe(1);
  });

  it('has no crafting recipe and uses the existing buyer example assortment', () => {
    expect(CRAFTING_RECIPES.some((recipe) => recipe.output.item === ItemId.PotionRepair)).toBe(false);
    expect(CRAFTING_RECIPES.some((recipe) => recipe.id.includes('potion_repair'))).toBe(false);
    expect(BUYER_EXAMPLE_REPAIR_POTION_ITEM).toBe(ItemId.PotionRepair);
    expect(BUYER_EXAMPLE_REPAIR_POTION_PRICE).toBe(500);
    expect(BUYER_EXAMPLE_REPAIR_POTION_PRICE).toBeGreaterThanOrEqual(1);
    expect(BUYER_EXAMPLE_REPAIR_POTION_PRICE).toBeLessThanOrEqual(999_999_999);
  });

  it('emits the effect text through the existing tooltip hint attribute', () => {
    const item = getItemDefinition(ItemId.PotionRepair);
    if (item.kind !== 'food') throw new Error('expected food item');
    const markup = itemHoverAttributeString(item.name, item.id, (value) => value, item.description);
    expect(markup).toContain('data-item-tooltip="Зелье починки"');
    expect(markup).toContain('data-item-tooltip-hint="Восстанавливает 50% максимальной прочности всех повреждённых предметов"');
  });
});

describe('armor durability display path', () => {
  it('uses the same durability bar renderer for armor as for tools', () => {
    const tool = createItemStack(ItemId.IronPickaxe, 1, { durability: 20 });
    const sword = createItemStack(ItemId.IronSword, 1, { durability: 20 });
    const helm = createItemStack(ItemId.IronHelmet, 1, { durability: 30 });
    const chest = createItemStack(ItemId.IronChestplate, 1, { durability: 50 });
    const legs = createItemStack(ItemId.IronLeggings, 1, { durability: 40 });
    const boots = createItemStack(ItemId.IronBoots, 1, { durability: 20 });
    const apple = createItemStack(ItemId.Apple, 8);
    const pristineArmor = createItemStack(ItemId.IronHelmet);

    for (const stack of [tool, sword, helm, chest, legs, boots]) {
      const bar = slotDurabilityBarHtml(stack);
      expect(bar.startsWith('<div class="durability">')).toBe(true);
      expect(bar).toContain('<span style="width:');
    }
    expect(slotDurabilityBarHtml(apple)).toBe('');
    expect(slotDurabilityBarHtml(pristineArmor)).toBe('');
    expect(slotDurabilityBarHtml(null)).toBe('');
  });

  it('keeps armor slots on the shared slotHtml / durability-bar path', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const gameUi = readFileSync(join(root, '../src/ui/GameUI.ts'), 'utf8');
    expect(gameUi).toContain('slotDurabilityBarHtml(stack)');
    expect(gameUi).toContain("this.slotHtml(context.inventory.armor.head, 'armor-head')");
    expect(gameUi).toContain("this.slotHtml(context.inventory.armor.chest, 'armor-chest')");
    expect(gameUi).toContain("this.slotHtml(context.inventory.armor.legs, 'armor-legs')");
    expect(gameUi).toContain("this.slotHtml(context.inventory.armor.feet, 'armor-feet')");
    const style = readFileSync(join(root, '../src/style.css'), 'utf8');
    expect(style).toContain('.slot .durability');
    expect(style).toContain('.mc-slot[data-armor]');
    expect(style).toContain('.mc-panel .mc-slot .durability');
  });

  it('patches armor slot innerHTML when remaining durability changes', () => {
    const before = slotStateSignature({ itemId: ItemId.IronHelmet, count: 1, durability: 30 });
    const after = slotStateSignature({ itemId: ItemId.IronHelmet, count: 1, durability: 90 });
    expect(before).not.toBe(after);
    const slot = {
      key: 'armor-head',
      signature: before,
      className: 'slot mc-slot',
      title: '',
      innerHTML: slotDurabilityBarHtml(createItemStack(ItemId.IronHelmet, 1, { durability: 30 })),
    };
    const result = applySlotSnapshots([slot], [{
      key: 'armor-head',
      signature: after,
      className: 'slot mc-slot',
      title: '',
      innerHTML: slotDurabilityBarHtml(createItemStack(ItemId.IronHelmet, 1, { durability: 90 })),
    }]);
    expect(result.updated).toBe(1);
    expect(slot.innerHTML).toBe(slotDurabilityBarHtml(createItemStack(ItemId.IronHelmet, 1, { durability: 90 })));
  });
});

describe('armor remaining durability on hit', () => {
  it('wears every equipped armor piece through SurvivalSystem.damage', () => {
    const inventory = new Inventory();
    inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack(ItemId.IronHelmet));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.IronChestplate));
    inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack(ItemId.IronLeggings));
    inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack(ItemId.IronBoots));
    const survival = new SurvivalSystem({ health: 20 });
    const result = survival.damage(8, 'melee', { armor: inventory, ignoreInvulnerability: true });
    expect(result.accepted).toBe(true);
    expect(result.armorWorn).toBe(true);
    const wear = armorDurabilityLoss(8);
    expect(wear).toBe(2);
    expect(inventory.armor.head?.durability).toBe(durabilityOf(ItemId.IronHelmet) - wear);
    expect(inventory.armor.chest?.durability).toBe(durabilityOf(ItemId.IronChestplate) - wear);
    expect(inventory.armor.legs?.durability).toBe(durabilityOf(ItemId.IronLeggings) - wear);
    expect(inventory.armor.feet?.durability).toBe(durabilityOf(ItemId.IronBoots) - wear);
    expect(slotDurabilityBarHtml(inventory.armor.head)).toContain('class="durability"');
  });

  it('does not wear armor on bypass sources such as fall', () => {
    const inventory = new Inventory();
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.IronChestplate));
    const survival = new SurvivalSystem({ health: 20 });
    const result = survival.damage(6, 'fall', { armor: inventory, ignoreInvulnerability: true });
    expect(result.accepted).toBe(true);
    expect(result.armorWorn).toBeUndefined();
    expect(inventory.armor.chest?.durability).toBeUndefined();
  });
});
