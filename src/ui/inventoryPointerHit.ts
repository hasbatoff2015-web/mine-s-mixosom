import type { PointerZone } from './inventoryPointerGesture';

/** Controls that must never count as an outside drop. */
const BLOCKED_SELECTOR = 'button, input, textarea, select, a, [data-recipe-id], [data-creative-tab], [data-craft-item]';
/** Empty space inside the inventory UI. A release here cancels. */
const PANEL_SELECTOR = '.mc-panel, .mc-recipe-book, .mc-item-tooltip, .mc-stack-amount-dialog';
/**
 * The carried preview and tooltip sit above the slots.
 * `pointer-events: none` should already skip them. This is the second check.
 */
const CARRIED_OVERLAY_SELECTOR = '#cursor-stack, .mc-item-tooltip';

export interface InventoryPointerHit {
  readonly zone: PointerZone;
  readonly slotKey: string | null;
}

export interface InventoryPointerHitInput {
  readonly x: number;
  readonly y: number;
  readonly fallbackTarget: EventTarget | null;
  /** Move and pointerup after pointer capture must use coordinates, not `event.target`. */
  readonly coordinateHitTest: boolean;
  readonly amountOpen: boolean;
  readonly mobileDropContains: (x: number, y: number) => boolean;
  readonly elementFromPoint: (x: number, y: number) => Element | null;
  readonly elementsFromPoint?: (x: number, y: number) => readonly Element[];
}

function isCarriedOverlay(element: Element): boolean {
  return element.closest(CARRIED_OVERLAY_SELECTOR) !== null;
}

/** Topmost element that is not the drag preview or the tooltip. */
export function physicalPointerElement(
  elementFromPoint: (x: number, y: number) => Element | null,
  elementsFromPoint: ((x: number, y: number) => readonly Element[]) | undefined,
  x: number,
  y: number,
): Element | null {
  const stack = elementsFromPoint?.(x, y) ?? [];
  const first = elementFromPoint(x, y) ?? stack[0] ?? null;
  if (!first) return null;
  if (!isCarriedOverlay(first)) return first;
  for (const candidate of stack) {
    if (!isCarriedOverlay(candidate)) return candidate;
  }
  return null;
}

/**
 * Classify the element actually under the pointer.
 * Order: amount dialog, slot, blocked control, panel, backdrop.
 * The mobile drop region is decided by coordinates before this runs.
 */
export function classifyInventoryPointerElement(
  element: Element | null,
  options: { readonly amountOpen: boolean },
): InventoryPointerHit {
  if (options.amountOpen) return { zone: 'dialog', slotKey: null };
  if (!element) return { zone: 'backdrop', slotKey: null };
  if (element.closest('[data-amount-dialog], [data-amount-scrim]')) return { zone: 'dialog', slotKey: null };
  const slotKey = element.closest('[data-slot]')?.getAttribute('data-slot') ?? null;
  if (slotKey && slotKey !== 'cursor') return { zone: 'slot', slotKey };
  if (element.closest(BLOCKED_SELECTOR)) return { zone: 'blocked', slotKey: null };
  if (element.closest(PANEL_SELECTOR)) return { zone: 'panel', slotKey: null };
  return { zone: 'backdrop', slotKey: null };
}

export function resolveInventoryPointerZone(input: InventoryPointerHitInput): InventoryPointerHit {
  if (input.amountOpen) return { zone: 'dialog', slotKey: null };
  if (input.mobileDropContains(input.x, input.y)) return { zone: 'drop', slotKey: null };
  const element = input.coordinateHitTest
    ? physicalPointerElement(input.elementFromPoint, input.elementsFromPoint, input.x, input.y)
    : (input.fallbackTarget instanceof Element ? input.fallbackTarget : null);
  if (element?.closest('[data-mobile-drop]')) return { zone: 'drop', slotKey: null };
  return classifyInventoryPointerElement(element, { amountOpen: false });
}
