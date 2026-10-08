import { describe, expect, it } from 'vitest';
import { inventoryKeyDecision } from '../src/ui/inventoryKeys';
import {
  INVENTORY_TOUCH_DRAG_THRESHOLD_PX,
  INVENTORY_TOUCH_LONG_PRESS_MS,
  shouldFollowCarriedPointer,
  stepInventoryGesture,
  type PointerDownContext,
  type PointerSample,
} from '../src/ui/inventoryPointerGesture';
import { mobileDropHitContains, mobileDropHitRegion } from '../src/ui/mobileDropTarget';

const realContext: PointerDownContext = {
  cursorOccupied: false,
  sourceOccupied: true,
  sourceClass: 'real',
  allowLongPress: true,
};

function sample(patch: Partial<PointerSample> = {}): PointerSample {
  return {
    pointerId: 1,
    pointerClass: 'coarse',
    x: 20,
    y: 20,
    button: 'left',
    shift: false,
    zone: 'slot',
    slotKey: 'inventory-0',
    now: 0,
    ...patch,
  };
}

describe('inventory pointer gesture', () => {
  it('treats a short press under the threshold as one tap', () => {
    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    expect(started.effects).toEqual([]);
    expect(started.gesture?.phase).toBe('pending');
    const finished = stepInventoryGesture(started.gesture, {
      type: 'up',
      sample: sample({
        x: 20 + INVENTORY_TOUCH_DRAG_THRESHOLD_PX - 1,
        now: INVENTORY_TOUCH_LONG_PRESS_MS - 1,
      }),
    });
    expect(finished.gesture).toBeNull();
    expect(finished.effects).toEqual([
      { type: 'click', key: 'inventory-0', button: 'left', shift: false },
    ]);
  });

  it('lets a drag win before the long-press timer', () => {
    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const dragged = stepInventoryGesture(started.gesture, {
      type: 'move',
      sample: sample({ x: 20 + INVENTORY_TOUCH_DRAG_THRESHOLD_PX }),
    });
    expect(dragged.gesture?.phase).toBe('drag');
    const late = stepInventoryGesture(dragged.gesture, {
      type: 'tick',
      now: INVENTORY_TOUCH_LONG_PRESS_MS + 20,
    });
    expect(late.gesture?.phase).toBe('drag');
    expect(late.effects).toEqual([]);
  });

  it('opens the amount dialog when the hold stays inside the threshold', () => {
    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const held = stepInventoryGesture(started.gesture, {
      type: 'tick',
      now: INVENTORY_TOUCH_LONG_PRESS_MS,
    });
    expect(held.gesture?.phase).toBe('long-press');
    expect(held.effects).toEqual([{ type: 'long-press', key: 'inventory-0' }]);
    const moved = stepInventoryGesture(held.gesture, {
      type: 'move',
      sample: sample({ x: 80, y: 80, now: 500 }),
    });
    expect(moved.gesture?.phase).toBe('long-press');
    expect(moved.effects).toEqual([]);
    const released = stepInventoryGesture(moved.gesture, {
      type: 'up',
      sample: sample({ x: 80, y: 80, zone: 'backdrop', slotKey: null, now: 520 }),
    });
    expect(released.effects).toEqual([]);
  });

  it('cancels a pending press and an active drag without a transfer', () => {
    const pending = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const cancelled = stepInventoryGesture(pending.gesture, { type: 'cancel' });
    expect(cancelled.gesture).toBeNull();
    expect(cancelled.effects).toEqual([{ type: 'cancel' }]);

    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const dragged = stepInventoryGesture(started.gesture, {
      type: 'move',
      sample: sample({ x: 40 }),
    });
    const aborted = stepInventoryGesture(dragged.gesture, { type: 'cancel' });
    expect(aborted.effects).toEqual([{ type: 'cancel' }]);
    expect(aborted.effects.some((effect) => effect.type === 'move' || effect.type === 'drop-slot')).toBe(false);
  });

  it('moves on release over a slot and drops only on the mobile drop target', () => {
    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const dragged = stepInventoryGesture(started.gesture, {
      type: 'move',
      sample: sample({ x: 40, zone: 'slot', slotKey: 'inventory-3' }),
    });
    const moved = stepInventoryGesture(dragged.gesture, {
      type: 'up',
      sample: sample({ x: 40, zone: 'slot', slotKey: 'inventory-3' }),
    });
    expect(moved.effects).toEqual([
      { type: 'move', sourceKey: 'inventory-0', targetKey: 'inventory-3' },
    ]);

    const again = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const towardDrop = stepInventoryGesture(again.gesture, {
      type: 'move',
      sample: sample({ x: 50, zone: 'drop', slotKey: null }),
    });
    const dropped = stepInventoryGesture(towardDrop.gesture, {
      type: 'up',
      sample: sample({ x: 50, zone: 'drop', slotKey: null }),
    });
    expect(dropped.effects).toEqual([{ type: 'drop-slot', key: 'inventory-0' }]);
  });

  it('does not drop a coarse pointer on empty backdrop', () => {
    const backdrop = stepInventoryGesture(null, {
      type: 'down',
      sample: sample({ zone: 'backdrop', slotKey: null, x: 400, y: 40 }),
      context: { ...realContext, cursorOccupied: true, sourceOccupied: false, sourceClass: 'none' },
    });
    expect(backdrop.gesture).toBeNull();
    expect(backdrop.effects).toEqual([]);

    const started = stepInventoryGesture(null, {
      type: 'down',
      sample: sample(),
      context: realContext,
    });
    const dragged = stepInventoryGesture(started.gesture, {
      type: 'move',
      sample: sample({ x: 80, zone: 'backdrop', slotKey: null }),
    });
    const released = stepInventoryGesture(dragged.gesture, {
      type: 'up',
      sample: sample({ x: 90, zone: 'backdrop', slotKey: null }),
    });
    expect(released.effects).toEqual([{ type: 'cancel' }]);
  });

  it('drops a fine pointer outside the panel and distributes visited slots once', () => {
    const carried = {
      cursorOccupied: true,
      sourceOccupied: false,
      sourceClass: 'none' as const,
      allowLongPress: false,
    };
    const outside = stepInventoryGesture(null, {
      type: 'down',
      sample: sample({ pointerClass: 'fine', zone: 'backdrop', slotKey: null, button: 'right' }),
      context: carried,
    });
    const dropped = stepInventoryGesture(outside.gesture, {
      type: 'up',
      sample: sample({ pointerClass: 'fine', zone: 'backdrop', slotKey: null, button: 'right' }),
    });
    expect(dropped.effects).toEqual([{ type: 'drop-cursor', mode: 'one' }]);

    const direct = stepInventoryGesture(null, {
      type: 'down',
      sample: sample({ pointerClass: 'fine' }),
      context: { ...realContext, allowLongPress: false },
    });
    const away = stepInventoryGesture(direct.gesture, {
      type: 'move',
      sample: sample({ pointerClass: 'fine', x: 80, zone: 'backdrop', slotKey: null }),
    });
    const whole = stepInventoryGesture(away.gesture, {
      type: 'up',
      sample: sample({ pointerClass: 'fine', x: 80, zone: 'backdrop', slotKey: null }),
    });
    expect(whole.effects).toEqual([{ type: 'drop-slot', key: 'inventory-0' }]);

    const paint = stepInventoryGesture(null, {
      type: 'down',
      sample: sample({ pointerClass: 'fine', slotKey: 'inventory-1' }),
      context: carried,
    });
    const second = stepInventoryGesture(paint.gesture, {
      type: 'move',
      sample: sample({ pointerClass: 'fine', slotKey: 'inventory-2', x: 40 }),
    });
    const third = stepInventoryGesture(second.gesture, {
      type: 'move',
      sample: sample({ pointerClass: 'fine', slotKey: 'inventory-1', x: 48 }),
    });
    const spread = stepInventoryGesture(third.gesture, {
      type: 'up',
      sample: sample({ pointerClass: 'fine', slotKey: 'inventory-3', x: 60 }),
    });
    expect(spread.effects).toEqual([{
      type: 'distribute',
      button: 'left',
      keys: ['inventory-1', 'inventory-2', 'inventory-3'],
    }]);
  });
});

describe('carried pointer anchoring', () => {
  it('follows a fine pointer and an active touch drag, not a coarse backdrop', () => {
    expect(shouldFollowCarriedPointer({
      inventoryOpen: true,
      carried: true,
      pointerClass: 'fine',
      dragging: false,
      amountOpen: false,
    })).toBe(true);
    expect(shouldFollowCarriedPointer({
      inventoryOpen: true,
      carried: true,
      pointerClass: 'coarse',
      dragging: false,
      amountOpen: false,
    })).toBe(false);
    expect(shouldFollowCarriedPointer({
      inventoryOpen: true,
      carried: true,
      pointerClass: 'coarse',
      dragging: true,
      amountOpen: false,
    })).toBe(true);
    expect(shouldFollowCarriedPointer({
      inventoryOpen: true,
      carried: true,
      pointerClass: 'fine',
      dragging: true,
      amountOpen: true,
    })).toBe(false);
  });
});

describe('mobile drop hit region', () => {
  it('grows right, up, and down, and never left', () => {
    const visual = { left: 200, top: 80, right: 244, bottom: 124 };
    const hit = mobileDropHitRegion(visual, 1);
    expect(hit.left).toBe(visual.left);
    expect(hit.right).toBeGreaterThan(visual.right);
    expect(hit.top).toBeLessThan(visual.top);
    expect(hit.bottom).toBeGreaterThan(visual.bottom);
    expect(mobileDropHitContains(visual, visual.left - 5, visual.top + 5, 1)).toBe(false);
    expect(mobileDropHitContains(visual, visual.right + 5, visual.top + 5, 1)).toBe(true);
    expect(mobileDropHitContains(visual, visual.right + 11, visual.top + 5, 1)).toBe(false);
  });
});

describe('inventory key ownership', () => {
  const base = {
    inventoryOpen: true,
    amountOpen: false,
    typing: false,
    repeat: false,
    code: 'KeyQ',
    ctrl: false,
    meta: false,
    hoveredKey: 'inventory-4',
    hoveredDroppable: true,
    hoveredMutable: true,
  };

  it('leaves gameplay keys alone when the inventory is closed or a search field is typing', () => {
    expect(inventoryKeyDecision({ ...base, inventoryOpen: false }).type).toBe('passthrough');
    expect(inventoryKeyDecision({ ...base, typing: true, code: 'Digit3' }).type).toBe('passthrough');
  });

  it('closes only the amount dialog for Escape and E, and swallows item shortcuts', () => {
    expect(inventoryKeyDecision({ ...base, amountOpen: true, typing: true, code: 'KeyE' })).toEqual({ type: 'close-amount' });
    expect(inventoryKeyDecision({ ...base, amountOpen: true, typing: true, code: 'Escape' })).toEqual({ type: 'close-amount' });
    expect(inventoryKeyDecision({ ...base, amountOpen: true, code: 'KeyQ' }).type).toBe('consume');
    expect(inventoryKeyDecision({ ...base, amountOpen: true, code: 'Digit1' }).type).toBe('consume');
  });

  it('binds Q, digits, and F to the hovered slot', () => {
    expect(inventoryKeyDecision(base)).toEqual({ type: 'drop', key: 'inventory-4', all: false });
    expect(inventoryKeyDecision({ ...base, ctrl: true })).toEqual({ type: 'drop', key: 'inventory-4', all: true });
    expect(inventoryKeyDecision({ ...base, hoveredKey: null }).type).toBe('consume');
    expect(inventoryKeyDecision({ ...base, hoveredDroppable: false }).type).toBe('consume');
    expect(inventoryKeyDecision({ ...base, code: 'Digit3' })).toEqual({ type: 'hotbar', key: 'inventory-4', slot: 2 });
    expect(inventoryKeyDecision({ ...base, code: 'KeyF' })).toEqual({ type: 'offhand', key: 'inventory-4' });
    expect(inventoryKeyDecision({ ...base, code: 'KeyF', hoveredMutable: false }).type).toBe('consume');
    expect(inventoryKeyDecision({ ...base, code: 'KeyE' }).type).toBe('passthrough');
  });
});
