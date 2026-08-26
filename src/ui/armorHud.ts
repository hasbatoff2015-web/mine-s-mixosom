import { clamp } from '../core/constants';
import { MAX_ARMOR_POINTS } from '../survival';
import { HUD_STATUS_ICON_COUNT } from './hudStatusLayout';

export const ARMOR_HUD_ICON_COUNT = HUD_STATUS_ICON_COUNT;
export type ArmorHudIcon = 'empty' | 'half' | 'full';

export interface ArmorHudState {
  readonly visible: boolean;
  readonly points: number;
  readonly icons: readonly ArmorHudIcon[];
}

/** 10 Minecraft-like armor icons from a clamped 0–20 point total. */
export function armorHudIcons(points: number): ArmorHudState {
  const armor = clamp(Number.isFinite(points) ? points : 0, 0, MAX_ARMOR_POINTS);
  const icons: ArmorHudIcon[] = [];
  for (let index = 0; index < ARMOR_HUD_ICON_COUNT; index += 1) {
    const remaining = armor - index * 2;
    icons.push(remaining >= 2 ? 'full' : remaining === 1 ? 'half' : 'empty');
  }
  return { visible: armor > 0, points: armor, icons };
}
