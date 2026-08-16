import { describe, expect, it } from 'vitest';
import { Inventory, createItemStack, damageItem } from '../src/inventory';
import { ItemId } from '../src/items';

describe('Inventory', () => {
  it('stacks into existing slots, spills across empty slots and removes reliably', () => {
    const inventory = new Inventory();
    expect(inventory.addItem('cobblestone', 130)).toBe(0);
    expect(inventory.getSlot(0)?.count).toBe(64);
    expect(inventory.getSlot(1)?.count).toBe(64);
    expect(inventory.getSlot(2)?.count).toBe(2);
    expect(inventory.count('cobblestone')).toBe(130);
    expect(inventory.remove('cobblestone', 65)).toBe(65);
    expect(inventory.count('cobblestone')).toBe(65);
  });

  it('reports the exact remainder when full', () => {
    const inventory = new Inventory();
    for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
      inventory.setSlot(index, createItemStack('dirt', 64));
    }
    expect(inventory.add(createItemStack('stone', 12))).toEqual({ itemId: 'stone', count: 12 });
    expect(inventory.addItem('stone', 100)).toBe(100);
  });

  it('implements left-click pickup/place and right-click split/place-one', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('oak_planks', 9));

    let cursor = inventory.clickSlot(0, null, 'right');
    expect(cursor?.count).toBe(5);
    expect(inventory.getSlot(0)?.count).toBe(4);

    cursor = inventory.clickSlot(1, cursor, 'right');
    expect(inventory.getSlot(1)?.count).toBe(1);
    expect(cursor?.count).toBe(4);

    cursor = inventory.clickSlot(0, cursor, 'left');
    expect(inventory.getSlot(0)?.count).toBe(8);
    expect(cursor).toBeNull();
  });

  it('enforces armor slots while allowing a shield in offhand', () => {
    const inventory = new Inventory();
    const helmet = createItemStack(ItemId.IronHelmet);
    inventory.setSlot({ section: 'armor', slot: 'head' }, helmet);
    inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.Shield));

    expect(inventory.armor.head?.itemId).toBe(ItemId.IronHelmet);
    expect(inventory.offhand?.itemId).toBe(ItemId.Shield);
    expect(() => inventory.setSlot(
      { section: 'armor', slot: 'feet' },
      createItemStack(ItemId.IronHelmet),
    )).toThrow(/cannot be placed/);
  });

  it('supports shift-click equipment and RMB drag distribution', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.DiamondBoots));
    expect(inventory.quickMove(0)).toBe(true);
    expect(inventory.getSlot(0)).toBeNull();
    expect(inventory.armor.feet?.itemId).toBe(ItemId.DiamondBoots);

    const remainder = inventory.dragPlace(createItemStack('stone', 5), [0, 1, 2]);
    expect(inventory.getSlot(0)?.count).toBe(1);
    expect(inventory.getSlot(1)?.count).toBe(1);
    expect(inventory.getSlot(2)?.count).toBe(1);
    expect(remainder?.count).toBe(2);
    expect(inventory.dropFromSlot(1)).toEqual({ itemId: 'stone', count: 1 });
    expect(inventory.getSlot(1)).toBeNull();
  });

  it('serializes without leaking mutable references and validates deserialization', () => {
    const inventory = new Inventory();
    inventory.setSlot(4, createItemStack('stone', 3, { metadata: { label: 'kept', nested: [1, 2] } }));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.GoldChestplate));

    const restored = Inventory.deserialize(JSON.parse(JSON.stringify(inventory)) as unknown);
    expect(restored.serialize()).toEqual(inventory.serialize());
    restored.setSlot(4, null);
    expect(inventory.getSlot(4)?.count).toBe(3);

    expect(() => Inventory.deserialize({ version: 1, slots: [] })).toThrow(/malformed/);
  });

  it('consumes atomically and breaks exhausted durable items', () => {
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 5);
    expect(inventory.consume({ oak_planks: 6 })).toBe(false);
    expect(inventory.count('oak_planks')).toBe(5);
    expect(inventory.consume({ oak_planks: 4 })).toBe(true);
    expect(inventory.count('oak_planks')).toBe(1);

    const pickaxe = createItemStack(ItemId.WoodenPickaxe, 1, { durability: 1 });
    expect(damageItem(pickaxe)).toBeNull();
  });
});
