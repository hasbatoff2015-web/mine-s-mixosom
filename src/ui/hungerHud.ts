import { clamp } from '../core/constants';
import { HUD_STATUS_ICON_COUNT } from './hudStatusLayout';

export const HUNGER_HUD_ICON_COUNT = HUD_STATUS_ICON_COUNT;
export type HungerHudIcon = 'empty' | 'half' | 'full';

export interface HungerHudState {
  readonly hunger: number;
  readonly icons: readonly HungerHudIcon[];
}

/** 10 presentation-only drumsticks from the canonical 0–20 hunger value. */
export function hungerHudIcons(hunger: number): HungerHudState {
  const points = Math.floor(clamp(Number.isFinite(hunger) ? hunger : 0, 0, 20));
  const icons: HungerHudIcon[] = [];
  for (let index = 0; index < HUNGER_HUD_ICON_COUNT; index += 1) {
    const remaining = points - index * 2;
    icons.push(remaining >= 2 ? 'full' : remaining === 1 ? 'half' : 'empty');
  }
  return { hunger: points, icons };
}
