import type { LifecycleState } from './lifecycleTypes';
import { playerGameplayAllowed, worldSimulationActive } from './gameplayModal';

export interface SurvivalLifeFlags {
  readonly dead: boolean;
  readonly health: number;
}

export interface OnlineRespawnInputPlan {
  readonly lifecycle: LifecycleState;
  readonly clearHeldKeys: boolean;
  readonly focusCanvas: boolean;
  readonly requestPointerLock: boolean;
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

/**
 * Overlay close may reset held keys (chat/inventory owned the keyboard).
 * Do not clear WASD merely because the player respawned — a physically held
 * W must stay W until keyup.
 */
export function planOnlineRespawnInputRestore(options: {
  readonly state: LifecycleState;
  readonly pointerLocked: boolean;
  readonly chatOpen: boolean;
  readonly inventoryOpen: boolean;
}): OnlineRespawnInputPlan {
  const lifecycle = lifecycleAfterOnlineRespawn(options.state);
  const playing = lifecycle === 'PLAYING';
  return {
    lifecycle,
    clearHeldKeys: options.chatOpen || options.inventoryOpen,
    focusCanvas: playing && !options.pointerLocked,
    requestPointerLock: playing && !options.pointerLocked,
  };
}

/** Drop a dead snapshot that is not newer than the last confirmed alive tick. */
export function shouldIgnoreStaleDeadSnapshot(options: {
  readonly snapshotTick: number;
  readonly lastAliveTick: number | undefined;
  readonly dead: boolean;
}): boolean {
  if (!options.dead) return false;
  if (options.lastAliveTick === undefined) return false;
  return options.snapshotTick <= options.lastAliveTick;
}

export function recordAliveSnapshotTick(
  lastAliveTick: number | undefined,
  snapshotTick: number,
): number {
  if (lastAliveTick === undefined) return snapshotTick;
  return Math.max(lastAliveTick, snapshotTick);
}
