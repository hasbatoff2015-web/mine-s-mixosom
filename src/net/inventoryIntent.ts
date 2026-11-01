import type { ClientInventoryActionMessage, InventoryActionKind } from '../../shared/protocol';

const MUTATING = new Set<InventoryActionKind>([
  'click', 'drop_selected', 'drop_cursor', 'drop_slot', 'move_stack', 'split_stack',
  'hotbar_swap', 'offhand_swap', 'collect_matching', 'drag_distribute', 'quick_move_matching',
  'recipe', 'craft_recipe',
]);

export function stampInventoryIntent(
  message: ClientInventoryActionMessage,
  revisions: { readonly inventory: number; readonly container?: number },
): ClientInventoryActionMessage {
  if (!MUTATING.has(message.action)) return message;
  return {
    ...message,
    requestId: crypto.randomUUID(),
    expectedInventoryRevision: revisions.inventory,
    ...(revisions.container !== undefined ? { expectedContainerRevision: revisions.container } : {}),
  };
}

/**
 * Network send for an inventory mutation that GameUI already stamped.
 * A second stamp would mint a new requestId and could attach a container
 * revision from a window the player has already left.
 */
export function transmitInventoryIntent(
  send: (message: ClientInventoryActionMessage) => void,
  message: ClientInventoryActionMessage,
): void {
  send(message);
}
