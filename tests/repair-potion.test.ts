import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPES } from '../src/crafting';
import { Inventory, createItemStack, restoredRemainingDurability } from '../src/inventory';
import {
  ItemId,
  REPAIR_POTION_LOST_FRACTION,
  getItemDefinition,
  obtainableItems,
} from '../src/items';
import { itemDescriptionFor } from '../src/i18n';
import { SurvivalSystem } from '../src/survival';
import {
  BUYER_EXAMPLE_REPAIR_POTION_ITEM,
  BUYER_EXAMPLE_REPAIR_POTION_PRICE,
} from '../shared/buyers';
import { itemHoverAttributeString } from '../src/ui/itemTooltip';

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
    expect(item.description).toBe('Восстанавливает 50% потерянной прочности всех предметов');
    expect(itemDescriptionFor(ItemId.PotionRepair)).toBe(item.description);
    expect(item.kind).toBe('food');
    if (item.kind !== 'food') throw new Error('expected food item');
    expect(item.maxStack).toBe(64);
    expect(item.food).toMatchObject({
      alwaysEdible: true,
      returnsItem: ItemId.GlassBottle,
      repairLostDurabilityFraction: REPAIR_POTION_LOST_FRACTION,
    });
    expect(item.food.effects).toBeUndefined();
    expect(obtainableItems().some((entry) => entry.id === ItemId.PotionRepair)).toBe(true);
  });

  it('restores 50% of missing durability and never exceeds max', () => {
    expect(restoredRemainingDurability(20, 100, 0.5)).toBe(60);
    expect(restoredRemainingDurability(90, 100, 0.5)).toBe(95);
    expect(restoredRemainingDurability(100, 100, 0.5)).toBe(100);
    expect(restoredRemainingDurability(0, 100, 0.5)).toBe(50);
    expect(restoredRemainingDurability(20, 100, 0.5)).toBe(60);
    expect(restoredRemainingDurability(60, 100, 0.5)).toBe(80);
    expect(restoredRemainingDurability(80, 100, 0.5)).toBe(90);

    const pickMax = durabilityOf(ItemId.IronPickaxe);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.IronPickaxe, 1, { durability: 20 }));
    inventory.setSlot(1, createItemStack(ItemId.PotionRepair));
    expect(new SurvivalSystem({ health: 20, hunger: 20 }).consumeFood(ItemId.PotionRepair, inventory)).toBe(true);
    const restored = inventory.getSlot(0);
    expect(restored?.durability).toBe(restoredRemainingDurability(20, pickMax, 0.5));
    expect(restored!.durability!).toBeLessThanOrEqual(pickMax);
  });

  it('repairs every durability item in hotbar, inventory, armor and offhand, and ignores the rest', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.IronSword, 1, { durability: 20 }));
    inventory.setSlot(12, createItemStack(ItemId.IronPickaxe, 1, { durability: 40 }));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.IronChestplate, 1, { durability: 50 }));
    inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.FlintAndSteel, 1, { durability: 10 }));
    inventory.setSlot(3, createItemStack(ItemId.Apple, 8));
    inventory.setSlot(4, createItemStack(ItemId.IronIngot, 16));
    inventory.setSlot(5, createItemStack(ItemId.PotionRepair, 2));

    expect(drinkRepairPotion(inventory, 5)).toBe(true);

    const swordMax = durabilityOf(ItemId.IronSword);
    const pickMax = durabilityOf(ItemId.IronPickaxe);
    const chestMax = durabilityOf(ItemId.IronChestplate);
    const flintMax = durabilityOf(ItemId.FlintAndSteel);
    expect(inventory.getSlot(0)?.durability).toBe(restoredRemainingDurability(20, swordMax, 0.5));
    expect(inventory.getSlot(12)?.durability).toBe(restoredRemainingDurability(40, pickMax, 0.5));
    expect(inventory.armor.chest?.durability).toBe(restoredRemainingDurability(50, chestMax, 0.5));
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
    expect(markup).toContain('data-item-tooltip-hint="Восстанавливает 50% потерянной прочности всех предметов"');
  });
});
