import type { LifecycleState } from './Lifecycle';
import { playerGameplayAllowed, worldSimulationActive } from './gameplayModal';

export interface SurvivalLifeFlags {
  readonly dead: boolean;
  readonly health: number;
}

/** True when a health/snapshot packet means the player just came back from death. */
export function shouldRestoreGameplayAfterRespawn(
  previous: SurvivalLifeFlags,
  next: SurvivalLifeFlags,
): boolean {
  const wasDown = previous.dead || previous.health <= 0;
  const alive = !next.dead && next.health > 0;
  return wasDown && alive;
}

/**
 * Online death never uses the singleplayer DEAD screen. Respawn must return
 * the same PLAYING + unblocked-input contract as a fresh join — including
 * BACKGROUND (spurious blur while pointer-locked) and leftover DEAD.
 * Pause stays pause: the user opened that overlay on purpose.
 */
export function lifecycleAfterOnlineRespawn(state: LifecycleState): LifecycleState {
  if (state === 'BACKGROUND' || state === 'DEAD') return 'PLAYING';
  return state;
}

export function onlineRespawnAllowsMovement(state: LifecycleState, overlayOpen: boolean): boolean {
  const restored = lifecycleAfterOnlineRespawn(state);
  return worldSimulationActive(restored) && playerGameplayAllowed(restored, overlayOpen);
}
