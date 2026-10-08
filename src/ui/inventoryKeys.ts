export type InventoryKeyDecision =
  | { readonly type: 'passthrough' }
  | { readonly type: 'close-amount' }
  | { readonly type: 'consume' }
  | { readonly type: 'drop'; readonly key: string; readonly all: boolean }
  | { readonly type: 'hotbar'; readonly key: string; readonly slot: number }
  | { readonly type: 'offhand'; readonly key: string };

const SHORTCUTS = new Set(['KeyQ', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);

/**
 * Inventory shortcuts win over gameplay Q / 1–9 while a container is open.
 * Typing in a search field is left to the field. Escape and E still close the
 * container unless the amount dialog is the top layer.
 */
export function inventoryKeyDecision(input: {
  readonly inventoryOpen: boolean;
  readonly amountOpen: boolean;
  readonly typing: boolean;
  readonly repeat: boolean;
  readonly code: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly hoveredKey: string | null;
  readonly hoveredDroppable: boolean;
  readonly hoveredMutable: boolean;
}): InventoryKeyDecision {
  if (!input.inventoryOpen) return { type: 'passthrough' };
  if (input.amountOpen && (input.code === 'Escape' || input.code === 'KeyE')) {
    return { type: 'close-amount' };
  }
  if (input.amountOpen) {
    if (SHORTCUTS.has(input.code)) return { type: 'consume' };
    return { type: 'passthrough' };
  }
  if (input.typing) return { type: 'passthrough' };
  if (!SHORTCUTS.has(input.code)) return { type: 'passthrough' };
  if (input.repeat) return { type: 'consume' };
  if (input.code === 'KeyQ') {
    if (!input.hoveredKey || !input.hoveredDroppable) return { type: 'consume' };
    return { type: 'drop', key: input.hoveredKey, all: input.ctrl || input.meta };
  }
  if (input.code === 'KeyF') {
    if (!input.hoveredKey || !input.hoveredMutable) return { type: 'consume' };
    return { type: 'offhand', key: input.hoveredKey };
  }
  const slot = Number(input.code.slice('Digit'.length)) - 1;
  if (!input.hoveredKey || !input.hoveredMutable || slot < 0 || slot > 8) return { type: 'consume' };
  return { type: 'hotbar', key: input.hoveredKey, slot };
}
