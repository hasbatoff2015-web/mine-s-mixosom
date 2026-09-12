import { describe, expect, it } from 'vitest';
import {
  CRAFT_INVENTORY_FULL_MESSAGE,
  canCraftOnce,
  craftOnceByRecipeId,
} from '../src/crafting';
import { Inventory, createItemStack } from '../src/inventory';
import { applyInventoryUiAction, type InventoryUiState } from '../src/inventory/inventoryUiAction';
import { ItemId } from '../src/items';

function survivalState(inventory: Inventory): InventoryUiState {
  return {
    inventory,
    cursor: null,
    craftSlots: [null, null, null, null],
    window: { kind: 'inventory' },
    gamemode: 'survival',
  };
}

describe('atomic craft-once', () => {
  it('crafts the recipe output count once and can repeat while ingredients last', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 3);
    const first = craftOnceByRecipeId(inventory, 'oak_planks_from_log');
    expect(first).toEqual({
      ok: true,
      recipeId: 'oak_planks_from_log',
      output: { item: 'oak_planks', count: 4 },
    });
    expect(inventory.count('oak_log')).toBe(2);
    expect(inventory.count('oak_planks')).toBe(4);
    expect(craftOnceByRecipeId(inventory, 'oak_planks_from_log').ok).toBe(true);
    expect(craftOnceByRecipeId(inventory, 'oak_planks_from_log').ok).toBe(true);
    expect(inventory.count('oak_log')).toBe(0);
    expect(inventory.count('oak_planks')).toBe(12);
    expect(craftOnceByRecipeId(inventory, 'oak_planks_from_log')).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a missing ingredient without mutating the inventory', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 1);
    const before = inventory.serialize();
    expect(craftOnceByRecipeId(inventory, 'sticks')).toEqual({ ok: false, reason: 'missing' });
    expect(canCraftOnce(inventory, 'sticks')).toBe('missing');
    expect(inventory.serialize()).toEqual(before);
  });

  it('rejects unknown recipe ids', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 8);
    const before = inventory.serialize();
    expect(craftOnceByRecipeId(inventory, 'not_a_recipe')).toEqual({ ok: false, reason: 'unknown' });
    expect(inventory.serialize()).toEqual(before);
  });

  it('is atomic when the result cannot fully fit', () => {
    const inventory = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      inventory.setSlot(slot, createItemStack('dirt', 64));
    }
    inventory.setSlot({ section: 'offhand' }, createItemStack('oak_log', 1));
    const before = inventory.serialize();
    expect(canCraftOnce(inventory, 'oak_planks_from_log')).toBe('full');
    expect(craftOnceByRecipeId(inventory, 'oak_planks_from_log')).toEqual({ ok: false, reason: 'full' });
    expect(inventory.serialize()).toEqual(before);
    expect(inventory.count('oak_log')).toBe(1);
    expect(inventory.count('oak_planks')).toBe(0);
    expect(CRAFT_INVENTORY_FULL_MESSAGE).toBe('Инвентарь заполнен.');
  });

  it('returns remainders with the result when the recipe defines them', () => {
    const inventory = new Inventory();
    inventory.addItem(ItemId.Arrow, 1);
    inventory.addItem(ItemId.LavaBucket, 1);
    expect(craftOnceByRecipeId(inventory, 'fire_arrow').ok).toBe(true);
    expect(inventory.count(ItemId.FireArrow)).toBe(1);
    expect(inventory.count(ItemId.Bucket)).toBe(1);
    expect(inventory.count(ItemId.LavaBucket)).toBe(0);
    expect(inventory.count(ItemId.Arrow)).toBe(0);
  });
});

describe('server inventory_action craft_recipe', () => {
  it('crafts from recipeId only and ignores a forged count', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 2);
    const state = survivalState(inventory);
    const first = applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
      count: 8,
    });
    expect(first.ok).toBe(true);
    expect(first.dropped).toEqual([]);
    expect(first.crafted).toEqual({ itemId: 'oak_planks', count: 4, recipeId: 'oak_planks_from_log' });
    expect(inventory.count('oak_planks')).toBe(4);
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    }).ok).toBe(true);
    expect(inventory.count('oak_planks')).toBe(8);
    expect(inventory.count('oak_log')).toBe(0);
  });

  it('does not apply a partial craft when the inventory is full', () => {
    const inventory = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      inventory.setSlot(slot, createItemStack('dirt', 64));
    }
    inventory.setSlot({ section: 'offhand' }, createItemStack('oak_log', 1));
    const before = inventory.serialize();
    const result = applyInventoryUiAction(survivalState(inventory), {
      type: 'inventory_action',
      action: 'craft_recipe',
      recipeId: 'oak_planks_from_log',
    });
    expect(result.ok).toBe(false);
    expect(result.dropped).toEqual([]);
    expect(result.crafted).toBeUndefined();
    expect(inventory.serialize()).toEqual(before);
  });

  it('rejects a craft_recipe without a recipeId', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_log', 1);
    const before = inventory.serialize();
    expect(applyInventoryUiAction(survivalState(inventory), {
      type: 'inventory_action',
      action: 'craft_recipe',
    }).ok).toBe(false);
    expect(inventory.serialize()).toEqual(before);
  });
});
