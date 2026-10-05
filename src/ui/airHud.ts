import { clamp } from '../core/constants';
import { MAX_AIR_TICKS } from '../survival';
import { HUD_STATUS_ICON_COUNT } from './hudStatusLayout';

export const AIR_HUD_ICON_COUNT = HUD_STATUS_ICON_COUNT;
export type AirHudIcon = 'full' | 'bursting';

export interface AirHudState {
  readonly airTicks: number;
  readonly visible: boolean;
  readonly icons: readonly AirHudIcon[];
}

/**
 * Vanilla-style bubble row from the canonical 0–300 air ticks.
 * Bursting icons are emitted first so flex-end keeps the popping bubble
 * on the left of the remaining cluster.
 *
 * fullCount = ceil((air - 2) * 10 / 300)
 * visibleCount = ceil(air * 10 / 300)
 */
export function airHudIcons(airTicks: number, submerged: boolean): AirHudState {
  const air = clamp(Math.floor(Number.isFinite(airTicks) ? airTicks : 0), 0, MAX_AIR_TICKS);
  const fullCount = clamp(
    Math.ceil((air - 2) * AIR_HUD_ICON_COUNT / MAX_AIR_TICKS),
    0,
    AIR_HUD_ICON_COUNT,
  );
  const visibleCount = clamp(
    Math.ceil(air * AIR_HUD_ICON_COUNT / MAX_AIR_TICKS),
    0,
    AIR_HUD_ICON_COUNT,
  );
  const burstingCount = Math.max(0, visibleCount - fullCount);
  const icons: AirHudIcon[] = [];
  for (let index = 0; index < burstingCount; index += 1) icons.push('bursting');
  for (let index = 0; index < fullCount; index += 1) icons.push('full');
  return {
    airTicks: air,
    visible: submerged === true,
    icons,
  };
}
