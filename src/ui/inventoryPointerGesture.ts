export const INVENTORY_TOUCH_DRAG_THRESHOLD_PX = 8;
export const INVENTORY_TOUCH_LONG_PRESS_MS = 350;
export const INVENTORY_DOUBLE_CLICK_MS = 250;

export type PointerClass = 'fine' | 'coarse';
export type PointerZone = 'slot' | 'drop' | 'backdrop' | 'panel' | 'blocked' | 'dialog';
export type SourceClass = 'real' | 'creative' | 'virtual' | 'empty' | 'none';

export interface PointerSample {
  readonly pointerId: number;
  readonly pointerClass: PointerClass;
  readonly x: number;
  readonly y: number;
  readonly button: 'left' | 'right';
  readonly shift: boolean;
  readonly zone: PointerZone;
  readonly slotKey: string | null;
  readonly now: number;
}

export interface PointerDownContext {
  readonly cursorOccupied: boolean;
  readonly sourceOccupied: boolean;
  readonly sourceClass: SourceClass;
  readonly allowLongPress: boolean;
}

export interface InventoryGesture {
  readonly pointerId: number;
  readonly pointerClass: PointerClass;
  readonly button: 'left' | 'right';
  readonly shift: boolean;
  readonly phase: 'pending' | 'drag' | 'long-press';
  readonly sourceKey: string | null;
  readonly sourceClass: SourceClass;
  readonly sourceOccupied: boolean;
  readonly cursorOccupied: boolean;
  readonly allowLongPress: boolean;
  readonly downZone: PointerZone;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  readonly visited: readonly string[];
  readonly armedDrop: boolean;
}

export type GestureEffect =
  | { readonly type: 'click'; readonly key: string; readonly button: 'left' | 'right'; readonly shift: boolean }
  | { readonly type: 'move'; readonly sourceKey: string; readonly targetKey: string }
  | { readonly type: 'distribute'; readonly button: 'left' | 'right'; readonly keys: readonly string[] }
  | { readonly type: 'drop-slot'; readonly key: string }
  | { readonly type: 'drop-cursor'; readonly mode: 'all' | 'one' }
  | { readonly type: 'long-press'; readonly key: string }
  | { readonly type: 'cancel' };

export interface GestureStep {
  readonly gesture: InventoryGesture | null;
  readonly effects: readonly GestureEffect[];
}

export type GestureEvent =
  | { readonly type: 'down'; readonly sample: PointerSample; readonly context: PointerDownContext }
  | { readonly type: 'move'; readonly sample: PointerSample }
  | { readonly type: 'up'; readonly sample: PointerSample }
  | { readonly type: 'cancel' }
  | { readonly type: 'tick'; readonly now: number };

function movedPastThreshold(gesture: InventoryGesture, sample: PointerSample): boolean {
  const dx = sample.x - gesture.startX;
  const dy = sample.y - gesture.startY;
  return Math.hypot(dx, dy) >= INVENTORY_TOUCH_DRAG_THRESHOLD_PX;
}

function withVisit(gesture: InventoryGesture, sample: PointerSample, phase: InventoryGesture['phase']): InventoryGesture {
  const visited = gesture.visited.slice();
  if (sample.zone === 'slot' && sample.slotKey && !visited.includes(sample.slotKey)) visited.push(sample.slotKey);
  return {
    ...gesture,
    phase,
    x: sample.x,
    y: sample.y,
    visited,
    armedDrop: sample.zone === 'drop',
  };
}

function clickEffect(sample: PointerSample, key: string): GestureEffect {
  return { type: 'click', key, button: sample.button, shift: sample.shift };
}

/**
 * Coarse empty backdrop never drops and never becomes the carried-item anchor.
 * Fine pointers may follow the mouse anywhere the inventory is open.
 */
export function shouldFollowCarriedPointer(input: {
  readonly inventoryOpen: boolean;
  readonly carried: boolean;
  readonly pointerClass: PointerClass;
  readonly dragging: boolean;
  readonly amountOpen: boolean;
}): boolean {
  if (!input.inventoryOpen || !input.carried || input.amountOpen) return false;
  if (input.pointerClass === 'coarse') return input.dragging;
  return true;
}

export function stepInventoryGesture(gesture: InventoryGesture | null, event: GestureEvent): GestureStep {
  if (event.type === 'cancel') {
    if (!gesture) return { gesture: null, effects: [] };
    return { gesture: null, effects: [{ type: 'cancel' }] };
  }
  if (event.type === 'tick') {
    if (!gesture || gesture.pointerClass !== 'coarse' || gesture.phase !== 'pending' || !gesture.allowLongPress) {
      return { gesture, effects: [] };
    }
    const dx = gesture.x - gesture.startX;
    const dy = gesture.y - gesture.startY;
    if (Math.hypot(dx, dy) >= INVENTORY_TOUCH_DRAG_THRESHOLD_PX) return { gesture, effects: [] };
    if (event.now - gesture.startedAt < INVENTORY_TOUCH_LONG_PRESS_MS) return { gesture, effects: [] };
    if (!gesture.sourceKey) return { gesture, effects: [] };
    return {
      gesture: { ...gesture, phase: 'long-press', armedDrop: false },
      effects: [{ type: 'long-press', key: gesture.sourceKey }],
    };
  }
  if (event.type === 'down') {
    if (gesture) return { gesture, effects: [] };
    return beginGesture(event.sample, event.context);
  }
  if (!gesture || event.sample.pointerId !== gesture.pointerId) return { gesture, effects: [] };
  if (event.type === 'move') return moveGesture(gesture, event.sample);
  return finishGesture(gesture, event.sample);
}

function beginGesture(sample: PointerSample, context: PointerDownContext): GestureStep {
  if (sample.zone === 'blocked' || sample.zone === 'dialog') return { gesture: null, effects: [] };
  const onSlot = sample.zone === 'slot' && sample.slotKey !== null;
  if (sample.pointerClass === 'coarse' && sample.zone === 'backdrop' && !onSlot) {
    return { gesture: null, effects: [] };
  }
  if (!onSlot && sample.zone !== 'drop' && sample.zone !== 'backdrop' && sample.zone !== 'panel') {
    return { gesture: null, effects: [] };
  }
  if (!onSlot && !context.cursorOccupied && sample.zone !== 'drop') {
    return { gesture: null, effects: [] };
  }

  const next: InventoryGesture = {
    pointerId: sample.pointerId,
    pointerClass: sample.pointerClass,
    button: sample.button,
    shift: sample.shift,
    phase: 'pending',
    sourceKey: onSlot ? sample.slotKey : null,
    sourceClass: onSlot ? context.sourceClass : 'none',
    sourceOccupied: context.sourceOccupied,
    cursorOccupied: context.cursorOccupied,
    allowLongPress: sample.pointerClass === 'coarse' && context.allowLongPress && onSlot,
    downZone: sample.zone,
    startX: sample.x,
    startY: sample.y,
    x: sample.x,
    y: sample.y,
    startedAt: sample.now,
    visited: onSlot && sample.slotKey ? [sample.slotKey] : [],
    armedDrop: sample.zone === 'drop',
  };
  return { gesture: next, effects: [] };
}

function moveGesture(gesture: InventoryGesture, sample: PointerSample): GestureStep {
  if (gesture.phase === 'long-press') {
    return { gesture: { ...gesture, x: sample.x, y: sample.y, armedDrop: false }, effects: [] };
  }
  const past = movedPastThreshold(gesture, sample) || (gesture.pointerClass === 'fine' && sample.zone === 'slot' && sample.slotKey !== gesture.sourceKey);
  if (gesture.phase === 'pending' && !past) {
    return { gesture: { ...gesture, x: sample.x, y: sample.y, armedDrop: sample.zone === 'drop' }, effects: [] };
  }
  return { gesture: withVisit(gesture, sample, 'drag'), effects: [] };
}

function finishGesture(gesture: InventoryGesture, sample: PointerSample): GestureStep {
  const current = withVisit(gesture, sample, gesture.phase);
  if (current.phase === 'long-press') return { gesture: null, effects: [] };
  if (current.pointerClass === 'coarse') return finishCoarse(current, sample);
  return finishFine(current, sample);
}

function finishCoarse(gesture: InventoryGesture, sample: PointerSample): GestureStep {
  if (gesture.phase !== 'drag') {
    if (sample.zone === 'drop' && gesture.cursorOccupied) {
      return { gesture: null, effects: [{ type: 'drop-cursor', mode: 'all' }] };
    }
    if (sample.zone === 'slot' && sample.slotKey) {
      return { gesture: null, effects: [clickEffect(sample, sample.slotKey)] };
    }
    return { gesture: null, effects: [] };
  }
  if (sample.zone === 'drop') {
    if (gesture.cursorOccupied) return { gesture: null, effects: [{ type: 'drop-cursor', mode: 'all' }] };
    if (gesture.sourceKey && gesture.sourceClass === 'real' && gesture.sourceOccupied) {
      return { gesture: null, effects: [{ type: 'drop-slot', key: gesture.sourceKey }] };
    }
    return { gesture: null, effects: [{ type: 'cancel' }] };
  }
  if (sample.zone === 'slot' && sample.slotKey) {
    if (gesture.cursorOccupied) return { gesture: null, effects: [clickEffect(sample, sample.slotKey)] };
    if (gesture.sourceKey && gesture.sourceClass === 'real' && gesture.sourceOccupied) {
      if (sample.slotKey === gesture.sourceKey) return { gesture: null, effects: [{ type: 'cancel' }] };
      return { gesture: null, effects: [{ type: 'move', sourceKey: gesture.sourceKey, targetKey: sample.slotKey }] };
    }
    return { gesture: null, effects: [{ type: 'cancel' }] };
  }
  return { gesture: null, effects: [{ type: 'cancel' }] };
}

function finishFine(gesture: InventoryGesture, sample: PointerSample): GestureStep {
  const dragged = gesture.phase === 'drag';
  if (gesture.cursorOccupied && gesture.visited.length >= 2) {
    return {
      gesture: null,
      effects: [{ type: 'distribute', button: gesture.button, keys: gesture.visited }],
    };
  }
  if (!gesture.cursorOccupied && gesture.sourceKey && gesture.sourceClass === 'real' && gesture.sourceOccupied) {
    if (sample.zone === 'slot' && sample.slotKey && sample.slotKey !== gesture.sourceKey) {
      return { gesture: null, effects: [{ type: 'move', sourceKey: gesture.sourceKey, targetKey: sample.slotKey }] };
    }
    if (sample.zone === 'backdrop' && dragged) {
      return { gesture: null, effects: [{ type: 'drop-slot', key: gesture.sourceKey }] };
    }
    if (sample.zone === 'slot' && sample.slotKey) {
      return { gesture: null, effects: [clickEffect(sample, sample.slotKey)] };
    }
    return { gesture: null, effects: [{ type: 'cancel' }] };
  }
  if (gesture.cursorOccupied) {
    if (sample.zone === 'slot' && sample.slotKey) {
      return { gesture: null, effects: [clickEffect(sample, sample.slotKey)] };
    }
    if (sample.zone === 'backdrop' && (dragged || gesture.downZone === 'backdrop')) {
      return {
        gesture: null,
        effects: [{ type: 'drop-cursor', mode: gesture.button === 'right' ? 'one' : 'all' }],
      };
    }
    if (sample.zone === 'drop') return { gesture: null, effects: [{ type: 'drop-cursor', mode: 'all' }] };
    return { gesture: null, effects: dragged ? [{ type: 'cancel' }] : [] };
  }
  if (!dragged && sample.zone === 'slot' && sample.slotKey) {
    return { gesture: null, effects: [clickEffect(sample, sample.slotKey)] };
  }
  return { gesture: null, effects: dragged ? [{ type: 'cancel' }] : [] };
}
