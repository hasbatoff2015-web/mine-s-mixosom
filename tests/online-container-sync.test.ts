import { describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { applyInventoryUiAction } from '../src/inventory/inventoryUiAction';
import {
  applyAuthoritativeContainerSlots,
  parseNetworkItemStack,
  shouldOpenOnlineContainer,
} from '../src/net/onlineContainerSync';
import { VoxelWorld } from '../src/world/World';

describe('online container GUI sync', () => {
  it('does not reopen the GUI for later inventory snapshots', () => {
    expect(shouldOpenOnlineContainer('chest', false)).toBe(true);
    expect(shouldOpenOnlineContainer('chest', true)).toBe(false);
    expect(shouldOpenOnlineContainer('furnace', true)).toBe(false);
    expect(shouldOpenOnlineContainer('inventory', false)).toBe(false);
  });

  it('applies put/take to the live chest object while a GUI would already be open', () => {
    const world = new VoxelWorld('online-chest-gui');
    const chest = world.getChest(4, 40, 4);
    expect(chest.slots[0]).toBeNull();
    expect(shouldOpenOnlineContainer('chest', true)).toBe(false);

    applyAuthoritativeContainerSlots(world, {
      kind: 'chest',
      x: 4,
      y: 40,
      z: 4,
      slots: [{ itemId: 'diamond', count: 1 }, ...Array.from({ length: 26 }, () => null)],
    });
    expect(chest.slots[0]).toEqual(createItemStack('diamond', 1));
    expect(chest.slots[0]).toBe(world.getChest(4, 40, 4).slots[0]);

    applyAuthoritativeContainerSlots(world, {
      kind: 'chest',
      x: 4,
      y: 40,
      z: 4,
      slots: Array.from({ length: 27 }, () => null),
    });
    expect(chest.slots[0]).toBeNull();
  });

  it('round-trips player inventory together with chest slots from one snapshot', () => {
    const world = new VoxelWorld('online-chest-inv');
    const inventory = new Inventory();
    inventory.addItem('dirt', 8);
    applyAuthoritativeContainerSlots(world, {
      kind: 'chest',
      x: 1,
      y: 2,
      z: 3,
      slots: [{ itemId: 'diamond', count: 2 }],
    }, parseNetworkItemStack);
    expect(world.getChest(1, 2, 3).slots[0]?.itemId).toBe('diamond');
    expect(world.getChest(1, 2, 3).slots[0]?.count).toBe(2);
    expect(inventory.has('dirt', 8)).toBe(true);
  });

  it('keeps singleplayer chest click mutation on the same chest object', () => {
    const inventory = new Inventory();
    inventory.addItem('diamond', 1);
    const world = new VoxelWorld('sp-chest');
    const chest = world.getChest(1, 2, 3);
    const state = {
      inventory,
      cursor: null as ReturnType<Inventory['getSlot']>,
      craftSlots: [null, null, null, null],
      window: { kind: 'chest' as const, x: 1, y: 2, z: 3 },
      gamemode: 'survival' as const,
      chest,
    };
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'inventory-0',
      button: 'left',
    }).ok).toBe(true);
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
    }).ok).toBe(true);
    expect(chest.slots[0]?.itemId).toBe('diamond');
    expect(inventory.has('diamond', 1)).toBe(false);

    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
    }).ok).toBe(true);
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'inventory-0',
      button: 'left',
    }).ok).toBe(true);
    expect(chest.slots[0]).toBeNull();
    expect(inventory.has('diamond', 1)).toBe(true);
  });

  it('leaves the chest item in place when shift-take is rejected by a full inventory', () => {
    const inventory = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) {
      inventory.setSlot(slot, createItemStack('dirt', 64));
    }
    const chest = new VoxelWorld('full-inv-chest').getChest(0, 1, 0);
    chest.slots[0] = createItemStack('diamond', 1);
    const state = {
      inventory,
      cursor: null as ReturnType<Inventory['getSlot']>,
      craftSlots: [null, null, null, null],
      window: { kind: 'chest' as const, x: 0, y: 1, z: 0 },
      gamemode: 'survival' as const,
      chest,
    };
    expect(applyInventoryUiAction(state, {
      type: 'inventory_action',
      action: 'click',
      key: 'container-0',
      button: 'left',
      shift: true,
    }).ok).toBe(true);
    expect(chest.slots[0]?.itemId).toBe('diamond');
    expect(inventory.has('diamond', 1)).toBe(false);
  });
});
