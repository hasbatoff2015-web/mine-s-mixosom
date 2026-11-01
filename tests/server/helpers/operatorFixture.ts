import type { WorldInstance } from '../../../server/WorldInstance';

/**
 * Existing command tests list a display name in `config.operators`.
 * Production does not treat that name as an operator. Bind the joined
 * player's own id so those tests still have one privileged connection.
 */
export function bindNamedOperatorFixture(world: WorldInstance, player: { id: string; name: string }): void {
  const wanted = player.name.toLowerCase();
  if (world.config.operators.some((entry) => entry.toLowerCase() === wanted)) {
    world.permissions.op(player.id);
  }
}
