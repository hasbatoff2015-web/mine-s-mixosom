import type { MoveInput } from '../input/MoveInput';
import { ItemId, tryGetItemDefinition } from '../items';

export const ACTIVE_USE_MOVEMENT_MULTIPLIER = 0.2;

export function slowsMovementWhileUsing(itemId: string | undefined): boolean {
  if (itemId === ItemId.Bow) return true;
  return itemId !== undefined && tryGetItemDefinition(itemId)?.kind === 'weapon';
}

/** Node-safe command transform shared by local prediction, SP and the server. */
export function movementDuringItemUse(
  movement: MoveInput,
  itemId: string | undefined,
  using: boolean,
): MoveInput {
  if (!using || !slowsMovementWhileUsing(itemId)) return movement;
  return {
    ...movement,
    forward: movement.forward * ACTIVE_USE_MOVEMENT_MULTIPLIER,
    right: movement.right * ACTIVE_USE_MOVEMENT_MULTIPLIER,
    sprint: false,
    flySprint: false,
  };
}
