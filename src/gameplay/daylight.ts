import { DAY_TICKS, clamp } from '../core/constants';

/**
 * Shared day/night factor for sky, mob spawning, and sunlight burning.
 * Both singleplayer and the Anarchy server must use this — not a second curve.
 */
export function daylightFactor(timeOfDay: number): number {
  const phase = (timeOfDay / DAY_TICKS) * Math.PI * 2;
  return clamp((Math.sin(phase) + 0.22) / 0.75, 0.08, 1);
}
