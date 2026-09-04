import {
  CREATIVE_FLY_DOUBLE_TAP_TICKS,
  TICK_RATE,
} from '../core/constants';

export {
  CREATIVE_FLY_SPEED,
  CREATIVE_SPRINT_FLY_SPEED,
  CREATIVE_VERTICAL_SPEED,
  CREATIVE_FLY_DOUBLE_TAP_TICKS,
} from '../core/constants';

export const CREATIVE_FLY_DOUBLE_TAP_MS = CREATIVE_FLY_DOUBLE_TAP_TICKS * (1000 / TICK_RATE);

/** Creative Flight is a gamemode permission, not a movement-state field. */
export function creativeFlightAllowedForGamemode(gamemode: string | undefined): boolean {
  return gamemode === 'creative';
}

/**
 * Scratch/reconcile permission: live controller flag, or the snapshot's
 * authoritative gamemode when the local flag was never synced (welcome /
 * Online tickOnline used to skip this).
 */
export function creativeFlightAllowedForPrediction(
  player: { readonly creativeFlightAllowed?: boolean } | undefined,
  gamemode: string | undefined,
): boolean {
  return player?.creativeFlightAllowed === true || creativeFlightAllowedForGamemode(gamemode);
}

export function syncCreativeFlightAllowed(
  player: { creativeFlightAllowed: boolean },
  gamemode: string | undefined,
): void {
  player.creativeFlightAllowed = creativeFlightAllowedForGamemode(gamemode);
}

export function shouldAcceptFlyToggle(
  creative: boolean,
  jumpPressed: boolean,
  windowTicksRemaining: number,
): 'arm' | 'toggle' | 'idle' {
  if (!creative || !jumpPressed) return 'idle';
  return windowTicksRemaining > 0 ? 'toggle' : 'arm';
}

export function nextFlyWindowTicks(
  action: 'arm' | 'toggle' | 'idle',
  windowTicksRemaining: number,
): number {
  if (action === 'arm') return CREATIVE_FLY_DOUBLE_TAP_TICKS;
  if (action === 'toggle') return 0;
  return Math.max(0, windowTicksRemaining - 1);
}
