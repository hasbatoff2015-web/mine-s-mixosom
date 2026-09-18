import {
  DEFAULT_PLAYER_APPEARANCE,
  createPlayerAppearance,
  type PlayerAppearance,
} from '../player/appearance/PlayerAppearance';

/** First snapshot or a buffered appearance update, never a silent default. */
export function appearanceForRemoteSpawn(
  infoAppearance: PlayerAppearance | undefined,
  pending: PlayerAppearance | undefined,
): PlayerAppearance {
  return createPlayerAppearance(infoAppearance ?? pending ?? DEFAULT_PLAYER_APPEARANCE);
}

/**
 * If the remote visual does not exist yet, keep the appearance until spawn.
 * Reconnect must not be required for the selected skin to win.
 */
export function bufferPendingAppearance(
  pending: Map<string, PlayerAppearance>,
  playerId: string,
  appearance: PlayerAppearance,
  hasRemote: boolean,
): 'applied' | 'buffered' {
  if (hasRemote) {
    pending.delete(playerId);
    return 'applied';
  }
  pending.set(playerId, createPlayerAppearance(appearance));
  return 'buffered';
}

export function takePendingAppearance(
  pending: Map<string, PlayerAppearance>,
  playerId: string,
): PlayerAppearance | undefined {
  const appearance = pending.get(playerId);
  if (appearance) pending.delete(playerId);
  return appearance;
}
