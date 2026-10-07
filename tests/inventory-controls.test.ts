import { describe, expect, it } from 'vitest';
import { creativeCatalogItems } from '../src/items';
import { Inventory, createItemStack } from '../src/inventory';
import { itemMergeIdentity } from '../src/inventory/inventoryActions';
import { applyInventoryUiAction, isManualDropAction, type InventoryUiState } from '../src/inventory/inventoryUiAction';
import { initialStackAmount, splitAmountAllowed } from '../src/inventory/stackAmount';
import { parseClientMessage, type ClientInventoryActionMessage } from '../shared/protocol';
import type { ChestState, FurnaceState } from '../src/world/World';

function inventoryState(patch: Partial<InventoryUiState> = {}): InventoryUiState {
  return {
    inventory: new Inventory(),
    cursor: null,
    craftSlots: [null, null, null, null],
    window: { kind: 'inventory' },
    gamemode: 'survival',
    ...patch,
  };
}

function act(state: InventoryUiState, action: Omit<ClientInventoryActionMessage, 'type'>) {
  return applyInventoryUiAction(state, { type: 'inventory_action', ...action });
}

function furnace(): FurnaceState {
  return { slots: [null, null, null], burnTime: 0, burnTotal: 0, cookTime: 0 };
}

function chest(): ChestState {
  return { slots: Array.from({ length: 27 }, () => null) };
}

describe('existing click semantics', () => {
  it('takes half rounded up and places one while carrying', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('apple', 7));
    act(state, { action: 'click', key: 'inventory-0', button: 'right' });
    expect(state.cursor?.count).toBe(4);
    expect(state.inventory.getSlot(0)?.count).toBe(3);
    act(state, { action: 'click', key: 'inventory-1', button: 'right' });
    expect(state.inventory.getSlot(1)?.count).toBe(1);
    expect(state.cursor?.count).toBe(3);
  });

  it('moves, merges, and swaps on left click', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('apple', 10));
    act(state, { action: 'click', key: 'inventory-0', button: 'left' });
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.cursor?.count).toBe(10);
    state.inventory.setSlot(1, createItemStack('apple', 5));
    act(state, { action: 'click', key: 'inventory-1', button: 'left' });
    expect(state.inventory.getSlot(1)?.count).toBe(15);
    expect(state.cursor).toBeNull();
    state.inventory.setSlot(2, createItemStack('stone', 4));
    act(state, { action: 'click', key: 'inventory-1', button: 'left' });
    act(state, { action: 'click', key: 'inventory-2', button: 'left' });
    expect(state.inventory.getSlot(2)?.itemId).toBe('apple');
    expect(state.cursor?.itemId).toBe('stone');
  });
});

describe('shift quick move', () => {
  it('equips each armor piece into an empty matching slot and will not replace one', () => {
    const pieces = [
      ['diamond_helmet', 'armor-head'],
      ['diamond_chestplate', 'armor-chest'],
      ['diamond_leggings', 'armor-legs'],
      ['diamond_boots', 'armor-feet'],
    ] as const;
    for (const [itemId, slot] of pieces) {
      const state = inventoryState();
      state.inventory.setSlot(10, createItemStack(itemId, 1, { durability: 100 }));
      act(state, { action: 'click', key: 'inventory-10', button: 'left', shift: true });
      expect(state.inventory.getSlot({ section: 'armor', slot: slot.slice('armor-'.length) as 'head' | 'chest' | 'legs' | 'feet' })).toMatchObject({
        itemId,
        durability: 100,
      });
      expect(state.inventory.getSlot(10)).toBeNull();

      state.inventory.setSlot(11, createItemStack(itemId, 1, { durability: 40 }));
      act(state, { action: 'click', key: 'inventory-11', button: 'left', shift: true });
      expect(state.inventory.getSlot({ section: 'armor', slot: slot.slice('armor-'.length) as 'head' | 'chest' | 'legs' | 'feet' })?.durability).toBe(100);
      expect(state.inventory.getSlot(0)?.durability).toBe(40);
    }
  });

  it('returns equipped armor to regular inventory and swaps hotbar with main', () => {
    const state = inventoryState();
    state.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet', 1, { durability: 90 }));
    act(state, { action: 'click', key: 'armor-head', button: 'left', shift: true });
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })).toBeNull();
    expect(state.inventory.getSlot(0)).toMatchObject({ itemId: 'diamond_helmet', durability: 90 });

    state.inventory.setSlot(0, createItemStack('dirt', 6));
    act(state, { action: 'click', key: 'inventory-0', button: 'left', shift: true });
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.inventory.getSlot(9)?.count).toBe(6);

    state.inventory.setSlot(12, createItemStack('stone', 3));
    act(state, { action: 'click', key: 'inventory-12', button: 'left', shift: true });
    expect(state.inventory.getSlot(12)).toBeNull();
    expect(state.inventory.getSlot(0)?.count).toBe(3);
  });

  it('keeps chest and furnace shift routes', () => {
    const stored = chest();
    const container = inventoryState({ window: { kind: 'chest' }, chest: stored });
    container.inventory.setSlot(4, createItemStack('diamond_helmet', 1));
    act(container, { action: 'click', key: 'inventory-4', button: 'left', shift: true });
    expect(stored.slots[0]?.itemId).toBe('diamond_helmet');
    expect(container.inventory.getSlot({ section: 'armor', slot: 'head' })).toBeNull();
    act(container, { action: 'click', key: 'container-0', button: 'left', shift: true });
    expect(stored.slots[0]).toBeNull();
    expect(container.inventory.getSlot(0)?.itemId).toBe('diamond_helmet');

    const smelter = furnace();
    const cooking = inventoryState({ window: { kind: 'furnace' }, furnace: smelter });
    cooking.inventory.setSlot(0, createItemStack('iron_ore', 3));
    cooking.inventory.setSlot(1, createItemStack('coal', 2));
    cooking.inventory.setSlot(2, createItemStack('stone', 4));
    act(cooking, { action: 'click', key: 'inventory-0', button: 'left', shift: true });
    act(cooking, { action: 'click', key: 'inventory-1', button: 'left', shift: true });
    act(cooking, { action: 'click', key: 'inventory-2', button: 'left', shift: true });
    expect(smelter.slots[0]?.count).toBe(3);
    expect(smelter.slots[1]?.itemId).toBe('coal');
    expect(cooking.inventory.getSlot(9)?.itemId).toBe('stone');
    smelter.slots[2] = createItemStack('iron_ingot', 1);
    act(cooking, { action: 'click', key: 'furnace-2', button: 'left', shift: true });
    expect(smelter.slots[2]).toBeNull();
    expect(cooking.inventory.count('iron_ingot')).toBe(1);
  });
});

describe('slot drop, swap, and split', () => {
  it('drops one or the whole hovered stack and clamps a stale count', () => {
    const state = inventoryState();
    state.inventory.setSlot(4, createItemStack('apple', 5));
    const one = act(state, { action: 'drop_slot', key: 'inventory-4', count: 1 });
    expect(one.dropped).toEqual([expect.objectContaining({ itemId: 'apple', count: 1 })]);
    expect(state.inventory.getSlot(4)?.count).toBe(4);
    const whole = act(state, { action: 'drop_slot', key: 'inventory-4', all: true });
    expect(whole.dropped[0]?.count).toBe(4);
    expect(state.inventory.getSlot(4)).toBeNull();

    state.inventory.setSlot(5, createItemStack('apple', 10));
    const stale = act(state, { action: 'drop_slot', key: 'inventory-5', count: 18 });
    expect(stale.dropped[0]?.count).toBe(10);
    expect(state.inventory.getSlot(5)).toBeNull();
    expect(act(state, { action: 'drop_slot', key: 'inventory-5', count: 1 }).ok).toBe(false);
  });

  it('rejects virtual, creative, and mismatched sources', () => {
    const state = inventoryState();
    state.craftSlots[0] = createItemStack('oak_log', 1);
    expect(act(state, { action: 'drop_slot', key: 'result' }).ok).toBe(false);
    expect(state.craftSlots[0]?.itemId).toBe('oak_log');
    expect(state.inventory.count('oak_planks')).toBe(0);

    const creative = inventoryState({ gamemode: 'creative' });
    expect(act(creative, { action: 'drop_slot', key: 'creative-0' }).ok).toBe(false);
    expect(creative.cursor).toBeNull();
    const god = creativeCatalogItems().findIndex((item) => item.id === 'god_sword');
    expect(god).toBeGreaterThanOrEqual(0);
    act(creative, { action: 'click', key: `creative-${god}`, button: 'left' });
    expect(creative.cursor?.itemId).toBe('god_sword');

    const signed = inventoryState();
    signed.inventory.setSlot(0, createItemStack('dirt', 4));
    expect(act(signed, { action: 'drop_slot', key: 'inventory-0', count: 1, signature: 'stone|4||' }).ok).toBe(false);
    expect(signed.inventory.getSlot(0)?.count).toBe(4);
  });

  it('swaps with the hotbar and offhand, and rejects an illegal armor swap atomically', () => {
    const state = inventoryState();
    state.inventory.setSlot(10, createItemStack('dirt', 6));
    state.inventory.setSlot(2, createItemStack('stone', 3));
    act(state, { action: 'hotbar_swap', key: 'inventory-10', slot: 2 });
    expect(state.inventory.getSlot(10)?.itemId).toBe('stone');
    expect(state.inventory.getSlot(2)?.itemId).toBe('dirt');
    act(state, { action: 'hotbar_swap', key: 'inventory-2', slot: 2 });
    expect(state.inventory.getSlot(2)?.itemId).toBe('dirt');

    state.inventory.setSlot(0, createItemStack('diamond_sword', 1));
    act(state, { action: 'offhand_swap', key: 'inventory-0' });
    expect(state.inventory.getSlot({ section: 'offhand' })?.itemId).toBe('diamond_sword');
    expect(state.inventory.getSlot(0)).toBeNull();

    state.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet', 1, { durability: 50 }));
    state.inventory.setSlot(1, createItemStack('diamond_sword', 1));
    const rejected = act(state, { action: 'hotbar_swap', key: 'armor-head', slot: 1 });
    expect(rejected.ok).toBe(false);
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })?.durability).toBe(50);
    expect(state.inventory.getSlot(1)?.itemId).toBe('diamond_sword');
  });

  it('splits into an empty regular slot and refuses a full inventory or a whole stack', () => {
    expect(initialStackAmount(64)).toBe(32);
    expect(initialStackAmount(7)).toBe(4);
    expect(initialStackAmount(1)).toBe(1);
    expect(splitAmountAllowed(1, 1, true)).toBe(false);
    expect(splitAmountAllowed(64, 64, true)).toBe(false);
    expect(splitAmountAllowed(20, 64, false)).toBe(false);

    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('apple', 64));
    const split = act(state, { action: 'split_stack', key: 'inventory-0', count: 20 });
    expect(split.ok).toBe(true);
    expect(state.inventory.getSlot(0)?.count).toBe(44);
    expect(state.inventory.getSlot(9)?.count).toBe(20);
    expect(state.cursor).toBeNull();

    const whole = act(state, { action: 'split_stack', key: 'inventory-0', count: 44 });
    expect(whole.ok).toBe(false);
    expect(state.inventory.getSlot(0)?.count).toBe(44);

    for (let index = 0; index < Inventory.SLOT_COUNT; index += 1) {
      if (state.inventory.getSlot(index) === null) state.inventory.setSlot(index, createItemStack('stone', 1));
    }
    state.inventory.setSlot(0, createItemStack('apple', 10));
    const full = act(state, { action: 'split_stack', key: 'inventory-0', count: 4 });
    expect(full).toMatchObject({ ok: false, reason: 'no-slot' });
    expect(state.inventory.getSlot(0)?.count).toBe(10);

    const fresh = inventoryState();
    fresh.inventory.setSlot(9, createItemStack('apple', 8));
    expect(act(fresh, { action: 'split_stack', key: 'inventory-9', count: 20, signature: 'apple|8||' }).ok).toBe(false);
    expect(fresh.inventory.getSlot(9)?.count).toBe(8);
    expect(fresh.inventory.getSlot(10)).toBeNull();
  });
});

describe('drag, collect, and matching quick move', () => {
  it('moves a full stack, merges, swaps, and cancels an illegal armor drop without a cursor', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('apple', 40));
    state.inventory.setSlot(1, createItemStack('apple', 30));
    act(state, { action: 'move_stack', sourceKey: 'inventory-0', targetKey: 'inventory-1' });
    expect(state.inventory.getSlot(1)?.count).toBe(64);
    expect(state.inventory.getSlot(0)?.count).toBe(6);
    expect(state.cursor).toBeNull();

    state.inventory.setSlot(2, createItemStack('stone', 4));
    act(state, { action: 'move_stack', sourceKey: 'inventory-2', targetKey: 'inventory-3' });
    expect(state.inventory.getSlot(3)?.itemId).toBe('stone');
    expect(state.inventory.getSlot(2)).toBeNull();

    state.inventory.setSlot(4, createItemStack('dirt', 2));
    state.inventory.setSlot(5, createItemStack('cobblestone', 2));
    act(state, { action: 'move_stack', sourceKey: 'inventory-4', targetKey: 'inventory-5' });
    expect(state.inventory.getSlot(4)?.itemId).toBe('cobblestone');
    expect(state.inventory.getSlot(5)?.itemId).toBe('dirt');

    state.inventory.setSlot(6, createItemStack('diamond_helmet', 1));
    act(state, { action: 'move_stack', sourceKey: 'inventory-6', targetKey: 'armor-head' });
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })?.itemId).toBe('diamond_helmet');
    expect(state.inventory.getSlot(6)).toBeNull();

    state.inventory.setSlot(7, createItemStack('diamond_sword', 1));
    const rejected = act(state, { action: 'move_stack', sourceKey: 'inventory-7', targetKey: 'armor-head' });
    expect(rejected.ok).toBe(false);
    expect(state.cursor).toBeNull();
    expect(state.inventory.getSlot(7)?.itemId).toBe('diamond_sword');
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })?.itemId).toBe('diamond_helmet');
    expect(act(state, { action: 'move_stack', sourceKey: 'inventory-7', targetKey: 'inventory-7' }).ok).toBe(true);
    expect(state.inventory.getSlot(7)?.itemId).toBe('diamond_sword');
  });

  it('distributes evenly or one each and skips duplicates, full slots, wrong armor, and metadata', () => {
    const even = inventoryState();
    even.cursor = createItemStack('apple', 8);
    act(even, {
      action: 'drag_distribute',
      button: 'left',
      keys: ['inventory-1', 'inventory-1', 'inventory-2', 'inventory-3'],
    });
    expect(even.inventory.getSlot(1)?.count).toBe(2);
    expect(even.inventory.getSlot(2)?.count).toBe(2);
    expect(even.inventory.getSlot(3)?.count).toBe(2);
    expect(even.cursor?.count).toBe(2);

    const ones = inventoryState();
    ones.cursor = createItemStack('apple', 8);
    act(ones, { action: 'drag_distribute', button: 'right', keys: ['inventory-1', 'inventory-2', 'inventory-3'] });
    expect(ones.inventory.getSlot(1)?.count).toBe(1);
    expect(ones.inventory.getSlot(2)?.count).toBe(1);
    expect(ones.inventory.getSlot(3)?.count).toBe(1);
    expect(ones.cursor?.count).toBe(5);

    const filtered = inventoryState();
    filtered.cursor = createItemStack('apple', 8);
    filtered.inventory.setSlot(1, createItemStack('apple', 64));
    filtered.inventory.setSlot(2, createItemStack('apple', 3, { metadata: { kind: 'other' } }));
    filtered.inventory.setSlot({ section: 'armor', slot: 'chest' }, null);
    act(filtered, {
      action: 'drag_distribute',
      button: 'left',
      keys: ['inventory-1', 'inventory-2', 'armor-chest', 'inventory-4', 'inventory-5'],
    });
    expect(filtered.inventory.getSlot(1)?.count).toBe(64);
    expect(filtered.inventory.getSlot(2)?.count).toBe(3);
    expect(filtered.inventory.getSlot({ section: 'armor', slot: 'chest' })).toBeNull();
    expect(filtered.inventory.getSlot(4)?.count).toBe(4);
    expect(filtered.inventory.getSlot(5)?.count).toBe(4);
    expect(filtered.cursor).toBeNull();
  });

  it('collects compatible stacks up to the max and does not take a virtual result', () => {
    const state = inventoryState();
    state.cursor = createItemStack('apple', 10);
    state.inventory.setSlot(3, createItemStack('apple', 20));
    state.inventory.setSlot(4, createItemStack('apple', 30));
    state.inventory.setSlot(5, createItemStack('stone', 64));
    state.inventory.setSlot(6, createItemStack('apple', 8, { metadata: { kind: 'other' } }));
    act(state, { action: 'collect_matching' });
    expect(state.cursor?.count).toBe(60);
    expect(state.inventory.getSlot(3)).toBeNull();
    expect(state.inventory.getSlot(4)).toBeNull();
    expect(state.inventory.getSlot(5)?.count).toBe(64);
    expect(state.inventory.getSlot(6)?.count).toBe(8);

    state.cursor = createItemStack('apple', 50);
    state.inventory.setSlot(7, createItemStack('apple', 20));
    state.inventory.setSlot(8, createItemStack('apple', 20));
    act(state, { action: 'collect_matching' });
    expect(state.cursor?.count).toBe(64);
    expect(state.inventory.getSlot(7)?.count).toBe(6);
    expect(state.inventory.getSlot(8)?.count).toBe(20);

    state.craftSlots[0] = createItemStack('oak_log', 1);
    const before = state.cursor?.count;
    act(state, { action: 'collect_matching' });
    expect(state.cursor?.count).toBe(before);
    expect(state.craftSlots[0]?.itemId).toBe('oak_log');
  });

  it('quick-moves matching stacks on the same side without touching the cursor', () => {
    const stored = chest();
    const state = inventoryState({ window: { kind: 'chest' }, chest: stored });
    state.cursor = createItemStack('apple', 3);
    state.inventory.setSlot(0, createItemStack('dirt', 10));
    state.inventory.setSlot(1, createItemStack('dirt', 4));
    state.inventory.setSlot(2, createItemStack('stone', 6));
    state.inventory.setSlot(3, createItemStack('dirt', 2, { metadata: { kind: 'other' } }));
    act(state, { action: 'quick_move_matching', key: 'inventory-0' });
    expect(state.cursor?.count).toBe(3);
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.inventory.getSlot(1)).toBeNull();
    expect(state.inventory.getSlot(2)?.itemId).toBe('stone');
    expect(state.inventory.getSlot(3)?.count).toBe(2);
    expect(stored.slots.filter((slot) => slot?.itemId === 'dirt').reduce((sum, slot) => sum + (slot?.count ?? 0), 0)).toBe(14);
  });
});

function countInRange(inventory: Inventory, itemId: string, start: number, end: number): number {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    const stack = inventory.getSlot(index);
    if (stack?.itemId === itemId) total += stack.count;
  }
  return total;
}

describe('quick move matching source groups', () => {
  it('moves every matching main stack into the hotbar and leaves hotbar stacks there', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('dirt', 5));
    state.inventory.setSlot(9, createItemStack('dirt', 10));
    state.inventory.setSlot(10, createItemStack('dirt', 4));
    act(state, { action: 'quick_move_matching', key: 'inventory-9' });
    expect(state.inventory.getSlot(9)).toBeNull();
    expect(state.inventory.getSlot(10)).toBeNull();
    expect(countInRange(state.inventory, 'dirt', 9, 36)).toBe(0);
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(19);
    expect(state.cursor).toBeNull();
  });

  it('moves every matching hotbar stack into main and does not bring it back', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('dirt', 10));
    state.inventory.setSlot(1, createItemStack('dirt', 4));
    state.inventory.setSlot(9, createItemStack('dirt', 6));
    act(state, { action: 'quick_move_matching', key: 'inventory-0' });
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.inventory.getSlot(1)).toBeNull();
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(0);
    expect(countInRange(state.inventory, 'dirt', 9, 36)).toBe(20);
    expect(state.cursor).toBeNull();
  });

  it('keeps a crafting-table player quick move on the hotbar or main side', () => {
    const state = inventoryState({ window: { kind: 'crafting-table' } });
    state.inventory.setSlot(9, createItemStack('dirt', 8));
    state.inventory.setSlot(0, createItemStack('stone', 2));
    act(state, { action: 'quick_move_matching', key: 'inventory-9' });
    expect(state.inventory.getSlot(9)).toBeNull();
    expect(state.inventory.getSlot(0)?.itemId).toBe('stone');
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(8);
  });

  it('moves matching chest stacks into the player inventory', () => {
    const stored = chest();
    stored.slots[0] = createItemStack('dirt', 10);
    stored.slots[1] = createItemStack('dirt', 4);
    stored.slots[2] = createItemStack('stone', 6);
    stored.slots[4] = createItemStack('dirt', 2, { metadata: { kind: 'other' } });
    const state = inventoryState({ window: { kind: 'chest' }, chest: stored });
    state.cursor = createItemStack('apple', 1);
    act(state, { action: 'quick_move_matching', key: 'container-0' });
    expect(state.cursor?.itemId).toBe('apple');
    expect(stored.slots[0]).toBeNull();
    expect(stored.slots[1]).toBeNull();
    expect(stored.slots[2]?.itemId).toBe('stone');
    expect(stored.slots[4]?.count).toBe(2);
    expect(state.inventory.count('dirt')).toBe(14);
  });

  it('moves matching portal-chest stacks into the player inventory', () => {
    const stored = chest();
    stored.slots[3] = createItemStack('cobblestone', 5);
    stored.slots[8] = createItemStack('cobblestone', 2);
    const state = inventoryState({ window: { kind: 'portal-chest' }, chest: stored });
    act(state, { action: 'quick_move_matching', key: 'container-8' });
    expect(stored.slots[3]).toBeNull();
    expect(stored.slots[8]).toBeNull();
    expect(state.inventory.count('cobblestone')).toBe(7);
  });

  it('routes every matching player ore into the furnace and does not bounce stone', () => {
    const smelter = furnace();
    const state = inventoryState({ window: { kind: 'furnace' }, furnace: smelter });
    state.inventory.setSlot(0, createItemStack('iron_ore', 3));
    state.inventory.setSlot(9, createItemStack('iron_ore', 2));
    state.inventory.setSlot(1, createItemStack('coal', 4));
    act(state, { action: 'quick_move_matching', key: 'inventory-0' });
    expect(smelter.slots[0]?.count).toBe(5);
    expect(smelter.slots[0]?.itemId).toBe('iron_ore');
    expect(state.inventory.getSlot(1)?.count).toBe(4);
    expect(state.inventory.count('iron_ore')).toBe(0);

    state.inventory.setSlot(0, createItemStack('stone', 2));
    state.inventory.setSlot(9, createItemStack('stone', 4));
    act(state, { action: 'quick_move_matching', key: 'inventory-9' });
    expect(state.inventory.getSlot(9)).toBeNull();
    expect(countInRange(state.inventory, 'stone', 9, 36)).toBe(0);
    expect(countInRange(state.inventory, 'stone', 0, 9)).toBe(6);
    expect(smelter.slots[1]).toBeNull();
  });

  it('quick-moves furnace outputs to the player and does not take them back', () => {
    const smelter = furnace();
    smelter.slots[2] = createItemStack('iron_ingot', 4);
    const state = inventoryState({ window: { kind: 'furnace' }, furnace: smelter });
    act(state, { action: 'quick_move_matching', key: 'furnace-2' });
    expect(smelter.slots[2]).toBeNull();
    expect(state.inventory.count('iron_ingot')).toBe(4);
  });

  it('moves craft inputs to the player inventory', () => {
    const state = inventoryState();
    state.craftSlots[0] = createItemStack('oak_log', 3);
    state.craftSlots[1] = createItemStack('oak_log', 2);
    state.craftSlots[2] = createItemStack('stone', 1);
    act(state, { action: 'quick_move_matching', key: 'craft-0' });
    expect(state.craftSlots[0]).toBeNull();
    expect(state.craftSlots[1]).toBeNull();
    expect(state.craftSlots[2]?.itemId).toBe('stone');
    expect(state.inventory.count('oak_log')).toBe(5);
  });

  it('does not send an equipped stack back onto the armor slot it just left', () => {
    const state = inventoryState();
    state.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet', 1, { durability: 80 }));
    state.inventory.setSlot({ section: 'offhand' }, createItemStack('apple', 10));
    state.inventory.setSlot(0, createItemStack('apple', 4));
    act(state, { action: 'quick_move_matching', key: 'armor-head' });
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })).toBeNull();
    expect(state.inventory.count('diamond_helmet')).toBe(1);

    const apples = inventoryState();
    apples.inventory.setSlot({ section: 'offhand' }, createItemStack('apple', 10));
    apples.inventory.setSlot(0, createItemStack('apple', 4));
    act(apples, { action: 'quick_move_matching', key: 'offhand' });
    expect(apples.inventory.getSlot({ section: 'offhand' })).toBeNull();
    expect(apples.inventory.getSlot(0)?.count).toBe(14);
    expect(apples.inventory.getSlot(9)).toBeNull();
  });
});

describe('inventory action protocol', () => {
  it('rejects malformed keys, counts, and oversized lists, and ignores forged item fields', () => {
    expect(isManualDropAction({ action: 'drop_slot' })).toBe(true);
    expect(isManualDropAction({ action: 'drop_cursor' })).toBe(true);
    expect(isManualDropAction({ action: 'drop_selected' })).toBe(true);
    expect(isManualDropAction({ action: 'move_stack' })).toBe(false);

    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'drop_slot',
      key: 'x'.repeat(65),
    })).toEqual({ error: 'inventory_action.key invalid' });
    expect(parseClientMessage({ type: 'inventory_action', action: 'split_stack', key: 'inventory-0', count: 0 })).toHaveProperty('error');
    expect(parseClientMessage({ type: 'inventory_action', action: 'split_stack', key: 'inventory-0', count: 65 })).toHaveProperty('error');
    expect(parseClientMessage({ type: 'inventory_action', action: 'split_stack', key: 'inventory-0', count: Number.NaN })).toHaveProperty('error');
    expect(parseClientMessage({ type: 'inventory_action', action: 'hotbar_swap', key: 'inventory-1', slot: 9 })).toHaveProperty('error');
    expect(parseClientMessage({ type: 'inventory_action', action: 'move_stack', sourceKey: 'inventory-0' })).toHaveProperty('error');
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'drag_distribute',
      keys: Array.from({ length: 81 }, (_unused, index) => `inventory-${index}`),
    })).toHaveProperty('error');
    expect(parseClientMessage({
      type: 'inventory_action',
      action: 'drag_distribute',
      button: 'left',
      keys: ['inventory-1', 'inventory-1', 'inventory-2'],
    })).toMatchObject({ keys: ['inventory-1', 'inventory-2'] });
    const forged = parseClientMessage({
      type: 'inventory_action',
      action: 'drop_slot',
      key: 'inventory-0',
      count: 2,
      itemId: 'diamond_sword',
      sourceCount: 64,
    });
    expect(forged).not.toHaveProperty('itemId');
    expect(forged).not.toHaveProperty('sourceCount');
    expect(forged).toMatchObject({ action: 'drop_slot', key: 'inventory-0', count: 2 });
  });
});

describe('online shift double-click bulk transfer', () => {
  const dirtHint = itemMergeIdentity(createItemStack('dirt', 1));

  it('moves the rest of main after the first shift click has emptied the origin', () => {
    const state = inventoryState();
    state.inventory.setSlot(9, createItemStack('dirt', 10));
    state.inventory.setSlot(10, createItemStack('dirt', 4));
    act(state, { action: 'click', key: 'inventory-9', button: 'left', shift: true });
    expect(state.inventory.getSlot(9)).toBeNull();
    expect(state.inventory.getSlot(10)?.count).toBe(4);
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(10);

    const stale = act(state, { action: 'quick_move_matching', key: 'inventory-9' });
    expect(stale.ok).toBe(false);
    expect(state.inventory.getSlot(10)?.count).toBe(4);

    const bulk = act(state, { action: 'quick_move_matching', key: 'inventory-9', signature: dirtHint });
    expect(bulk.ok).toBe(true);
    expect(state.inventory.getSlot(9)).toBeNull();
    expect(state.inventory.getSlot(10)).toBeNull();
    expect(countInRange(state.inventory, 'dirt', 9, 36)).toBe(0);
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(14);
    expect(state.inventory.count('dirt')).toBe(14);
  });

  it('moves the rest of the hotbar after the origin shift click', () => {
    const state = inventoryState();
    state.inventory.setSlot(0, createItemStack('dirt', 10));
    state.inventory.setSlot(1, createItemStack('dirt', 4));
    act(state, { action: 'click', key: 'inventory-0', button: 'left', shift: true });
    expect(state.inventory.getSlot(0)).toBeNull();
    act(state, { action: 'quick_move_matching', key: 'inventory-0', signature: dirtHint });
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.inventory.getSlot(1)).toBeNull();
    expect(countInRange(state.inventory, 'dirt', 0, 9)).toBe(0);
    expect(countInRange(state.inventory, 'dirt', 9, 36)).toBe(14);
    expect(state.inventory.count('dirt')).toBe(14);
  });

  it('finishes a player-to-chest bulk after the first stack has already left', () => {
    const stored = chest();
    const state = inventoryState({ window: { kind: 'chest' }, chest: stored });
    state.inventory.setSlot(0, createItemStack('dirt', 10));
    state.inventory.setSlot(1, createItemStack('dirt', 4));
    state.inventory.setSlot(2, createItemStack('dirt', 2, { metadata: { kind: 'other' } }));
    act(state, { action: 'click', key: 'inventory-0', button: 'left', shift: true });
    expect(state.inventory.getSlot(0)).toBeNull();
    act(state, { action: 'quick_move_matching', key: 'inventory-0', signature: dirtHint });
    expect(state.inventory.getSlot(1)).toBeNull();
    expect(state.inventory.getSlot(2)?.count).toBe(2);
    expect(stored.slots.reduce((sum, slot) => sum + (slot?.itemId === 'dirt' && slot.metadata === undefined ? slot.count : 0), 0)).toBe(14);
    expect(state.inventory.count('dirt')).toBe(2);
  });

  it('finishes a chest-to-player bulk after the origin container slot is empty', () => {
    const stored = chest();
    stored.slots[0] = createItemStack('dirt', 10);
    stored.slots[1] = createItemStack('dirt', 4);
    stored.slots[4] = createItemStack('dirt', 2, { metadata: { kind: 'other' } });
    const state = inventoryState({ window: { kind: 'chest' }, chest: stored });
    act(state, { action: 'click', key: 'container-0', button: 'left', shift: true });
    expect(stored.slots[0]).toBeNull();
    act(state, { action: 'quick_move_matching', key: 'container-0', signature: dirtHint });
    expect(stored.slots[1]).toBeNull();
    expect(stored.slots[4]?.count).toBe(2);
    expect(state.inventory.count('dirt')).toBe(14);
  });

  it('finishes both portal-chest directions from an emptied origin', () => {
    const intoChest = chest();
    const deposit = inventoryState({ window: { kind: 'portal-chest' }, chest: intoChest });
    deposit.inventory.setSlot(3, createItemStack('cobblestone', 5));
    deposit.inventory.setSlot(4, createItemStack('cobblestone', 2));
    const cobbleHint = itemMergeIdentity(createItemStack('cobblestone', 1));
    act(deposit, { action: 'click', key: 'inventory-3', button: 'left', shift: true });
    act(deposit, { action: 'quick_move_matching', key: 'inventory-3', signature: cobbleHint });
    expect(deposit.inventory.count('cobblestone')).toBe(0);
    expect(intoChest.slots.reduce((sum, slot) => sum + (slot?.count ?? 0), 0)).toBe(7);

    const stored = chest();
    stored.slots[3] = createItemStack('cobblestone', 5);
    stored.slots[8] = createItemStack('cobblestone', 2);
    const withdraw = inventoryState({ window: { kind: 'portal-chest' }, chest: stored });
    act(withdraw, { action: 'click', key: 'container-3', button: 'left', shift: true });
    act(withdraw, { action: 'quick_move_matching', key: 'container-3', signature: cobbleHint });
    expect(stored.slots[3]).toBeNull();
    expect(stored.slots[8]).toBeNull();
    expect(withdraw.inventory.count('cobblestone')).toBe(7);
  });

  it('routes the remaining furnace ores after the first shift click', () => {
    const smelter = furnace();
    const state = inventoryState({ window: { kind: 'furnace' }, furnace: smelter });
    state.inventory.setSlot(0, createItemStack('iron_ore', 3));
    state.inventory.setSlot(9, createItemStack('iron_ore', 2));
    const hint = itemMergeIdentity(createItemStack('iron_ore', 1));
    act(state, { action: 'click', key: 'inventory-0', button: 'left', shift: true });
    expect(state.inventory.getSlot(0)).toBeNull();
    expect(state.inventory.getSlot(9)?.count).toBe(2);
    act(state, { action: 'quick_move_matching', key: 'inventory-0', signature: hint });
    expect(smelter.slots[0]?.count).toBe(5);
    expect(state.inventory.count('iron_ore')).toBe(0);
  });

  it('moves the remaining craft inputs after the origin input is empty', () => {
    const state = inventoryState();
    state.craftSlots[0] = createItemStack('oak_log', 3);
    state.craftSlots[1] = createItemStack('oak_log', 2);
    state.craftSlots[2] = createItemStack('stone', 1);
    const hint = itemMergeIdentity(createItemStack('oak_log', 1));
    act(state, { action: 'click', key: 'craft-0', button: 'left', shift: true });
    expect(state.craftSlots[0]).toBeNull();
    act(state, { action: 'quick_move_matching', key: 'craft-0', signature: hint });
    expect(state.craftSlots[0]).toBeNull();
    expect(state.craftSlots[1]).toBeNull();
    expect(state.craftSlots[2]?.itemId).toBe('stone');
    expect(state.inventory.count('oak_log')).toBe(5);
  });

  it('does not duplicate an equipped item when the armor slot is already empty', () => {
    const state = inventoryState();
    state.inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack('diamond_helmet', 1, { durability: 80 }));
    const hint = itemMergeIdentity(createItemStack('diamond_helmet', 1, { durability: 80 }));
    act(state, { action: 'click', key: 'armor-head', button: 'left', shift: true });
    expect(state.inventory.getSlot({ section: 'armor', slot: 'head' })).toBeNull();
    const bulk = act(state, { action: 'quick_move_matching', key: 'armor-head', signature: hint });
    expect(bulk.ok).toBe(false);
    expect(state.inventory.count('diamond_helmet')).toBe(1);
  });

  it('leaves an incompatible replacement in the origin and does not mint the hinted item', () => {
    const state = inventoryState();
    state.inventory.setSlot(9, createItemStack('dirt', 10));
    state.inventory.setSlot(10, createItemStack('dirt', 4));
    act(state, { action: 'click', key: 'inventory-9', button: 'left', shift: true });
    state.inventory.setSlot(9, createItemStack('stone', 3));
    act(state, { action: 'quick_move_matching', key: 'inventory-9', signature: dirtHint });
    expect(state.inventory.getSlot(9)?.itemId).toBe('stone');
    expect(state.inventory.getSlot(9)?.count).toBe(3);
    expect(state.inventory.getSlot(10)).toBeNull();
    expect(state.inventory.count('dirt')).toBe(14);
    expect(state.inventory.count('diamond')).toBe(0);

    const forged = inventoryState();
    forged.inventory.setSlot(9, createItemStack('dirt', 10));
    forged.inventory.setSlot(10, createItemStack('dirt', 4));
    act(forged, { action: 'click', key: 'inventory-9', button: 'left', shift: true });
    const rejected = act(forged, { action: 'quick_move_matching', key: 'inventory-9', signature: 'diamond||' });
    expect(rejected.ok).toBe(false);
    expect(forged.inventory.getSlot(10)?.count).toBe(4);
    expect(forged.inventory.count('dirt')).toBe(14);
    expect(forged.inventory.count('diamond')).toBe(0);
  });

  it('rejects a hinted bulk on a virtual result and a creative grant', () => {
    const crafting = inventoryState({ window: { kind: 'crafting-table' }, craftSlots: Array.from({ length: 9 }, () => null) });
    crafting.craftSlots[0] = createItemStack('oak_log', 1);
    const result = act(crafting, { action: 'quick_move_matching', key: 'result', signature: 'oak_planks||' });
    expect(result.ok).toBe(false);
    expect(crafting.craftSlots[0]?.count).toBe(1);
    expect(crafting.inventory.count('oak_planks')).toBe(0);

    const creative = inventoryState({ gamemode: 'creative' });
    const grant = act(creative, { action: 'quick_move_matching', key: 'creative-0', signature: 'stone||' });
    expect(grant.ok).toBe(false);
    expect(creative.inventory.count('stone')).toBe(0);
  });

  it('keeps the merge hint on the wire and ignores a forged count', () => {
    const parsed = parseClientMessage({
      type: 'inventory_action',
      action: 'quick_move_matching',
      key: 'inventory-9',
      signature: dirtHint,
      itemId: 'diamond',
      count: 64,
    });
    expect(parsed).toMatchObject({
      type: 'inventory_action',
      action: 'quick_move_matching',
      key: 'inventory-9',
      signature: dirtHint,
    });
    expect(parsed).not.toHaveProperty('itemId');
    if (!parsed || !('type' in parsed) || parsed.type !== 'inventory_action') {
      throw new Error('hint did not survive the parser');
    }

    const state = inventoryState();
    state.inventory.setSlot(9, createItemStack('dirt', 10));
    state.inventory.setSlot(10, createItemStack('dirt', 4));
    act(state, { action: 'click', key: 'inventory-9', button: 'left', shift: true });
    applyInventoryUiAction(state, parsed);
    expect(state.inventory.count('dirt')).toBe(14);
    expect(state.inventory.count('diamond')).toBe(0);
  });
});
