import { canonicalJson } from './db/canonicalJson';
import type { ClientInventoryActionMessage } from '../shared/protocol';

export const INVENTORY_REQUEST_LIMIT = 256;

const MUTATING_INVENTORY_ACTIONS = new Set([
  'click', 'drop_selected', 'drop_cursor', 'drop_slot', 'move_stack', 'split_stack',
  'hotbar_swap', 'offhand_swap', 'collect_matching', 'drag_distribute', 'quick_move_matching',
  'recipe', 'craft_recipe',
]);

export function isMutatingInventoryAction(action: ClientInventoryActionMessage): boolean {
  return MUTATING_INVENTORY_ACTIONS.has(action.action);
}

/**
 * Bounded per-connection memory of inventory request ids.
 * An id from a previous connection is cleared with the connection.
 */
export class InventoryRequestLog {
  private readonly order: string[] = [];
  private readonly intents = new Map<string, string>();

  constructor(private readonly limit = INVENTORY_REQUEST_LIMIT) {}

  /** `replay` and `conflict` must not mutate. `new` records the intent. */
  take(requestId: string, intent: string): 'new' | 'replay' | 'conflict' {
    const previous = this.intents.get(requestId);
    if (previous === undefined) {
      this.intents.set(requestId, intent);
      this.order.push(requestId);
      while (this.order.length > this.limit) {
        const dropped = this.order.shift();
        if (dropped) this.intents.delete(dropped);
      }
      return 'new';
    }
    return previous === intent ? 'replay' : 'conflict';
  }

  clear(): void {
    this.order.length = 0;
    this.intents.clear();
  }
}

export function inventoryIntentHash(action: ClientInventoryActionMessage): string {
  return canonicalJson({
    action: action.action,
    key: action.key ?? null,
    sourceKey: action.sourceKey ?? null,
    targetKey: action.targetKey ?? null,
    keys: action.keys ? [...action.keys] : null,
    button: action.button ?? null,
    shift: action.shift === true,
    slot: action.slot ?? null,
    count: action.count ?? null,
    all: action.all === true,
    signature: action.signature ?? null,
    kind: action.kind ?? null,
    x: action.x ?? null,
    y: action.y ?? null,
    z: action.z ?? null,
    recipeId: action.recipeId ?? null,
    expectedInventoryRevision: action.expectedInventoryRevision ?? null,
    expectedContainerRevision: action.expectedContainerRevision ?? null,
  });
}
