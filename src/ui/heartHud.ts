import { clamp } from '../core/constants';
import { MAX_HEALTH } from '../survival';
import { HUD_STATUS_ICON_COUNT } from './hudStatusLayout';

export const HEART_HUD_ICON_COUNT = HUD_STATUS_ICON_COUNT;
export type HeartHudIcon = 'empty' | 'half' | 'full';

export interface HeartHudState {
  readonly health: number;
  readonly icons: readonly HeartHudIcon[];
}

/** 10 hearts from a clamped 0–20 health total. Full = 2 HP, half = 1 HP. */
export function heartHudIcons(health: number): HeartHudState {
  const points = clamp(Number.isFinite(health) ? health : 0, 0, MAX_HEALTH);
  const icons: HeartHudIcon[] = [];
  for (let index = 0; index < HEART_HUD_ICON_COUNT; index += 1) {
    const remaining = points - index * 2;
    icons.push(remaining >= 2 ? 'full' : remaining === 1 ? 'half' : 'empty');
  }
  return { health: points, icons };
}
