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
