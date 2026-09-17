import { describe, expect, it } from 'vitest';
import {
  TOTEM_BURST_COLORS,
  TOTEM_BURST_COUNT,
  TOTEM_BURST_LIFE_MAX,
  TOTEM_BURST_LIFE_MIN,
  TOTEM_BURST_MAX_EFFECTS,
  TOTEM_PRESENTATION_DISTANCE,
  createTotemBurst,
  isTotemPaletteColor,
  stepTotemBurst,
} from '../src/gameplay/totemBurst';
import { TotemParticles } from '../src/rendering/TotemParticles';

function cycle(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

describe('Totem particle burst', () => {
  it('spawns a bounded Totem-palette burst that expires within one second', () => {
    const burst = createTotemBurst(3, 70, 8, { random: cycle([0.1, 0.4, 0.7, 0.9]) });
    expect(burst.particles).toHaveLength(TOTEM_BURST_COUNT);
    expect(TOTEM_BURST_COUNT).toBeGreaterThanOrEqual(24);
    expect(TOTEM_BURST_COUNT).toBeLessThanOrEqual(36);
    expect(TOTEM_BURST_LIFE_MIN).toBeGreaterThanOrEqual(0.55);
    expect(TOTEM_BURST_LIFE_MAX).toBeLessThanOrEqual(0.9);
    expect(new Set(burst.particles.map((particle) => particle.color)).size).toBeGreaterThan(1);
    for (const particle of burst.particles) {
      expect(isTotemPaletteColor(particle.color)).toBe(true);
      expect(particle.maxLife).toBeGreaterThanOrEqual(TOTEM_BURST_LIFE_MIN);
      expect(particle.maxLife).toBeLessThanOrEqual(TOTEM_BURST_LIFE_MAX);
      expect(TOTEM_BURST_COLORS).not.toContain(0xf62935);
    }
    expect(stepTotemBurst(burst, 0.2)).toBe(true);
    expect(stepTotemBurst(burst, 1)).toBe(false);
    expect(burst.particles.every((particle) => particle.life <= 0)).toBe(true);
  });

  it('removes finished bursts and keeps a bounded number of concurrent effects', () => {
    const visuals = new TotemParticles();
    for (let index = 0; index < TOTEM_BURST_MAX_EFFECTS + 2; index += 1) {
      visuals.burst(index, 70, 0, { random: cycle([0.2, 0.5, 0.8]) });
    }
    expect(visuals.activeBurstCount).toBe(TOTEM_BURST_MAX_EFFECTS);
    expect(visuals.particleCount).toBe(TOTEM_BURST_COUNT * TOTEM_BURST_MAX_EFFECTS);
    visuals.update(1);
    expect(visuals.activeBurstCount).toBe(0);
    expect(visuals.particleCount).toBe(0);
    visuals.dispose();
  });

  it('keeps Totem presentation distance independent of firework range', () => {
    expect(TOTEM_PRESENTATION_DISTANCE).toBe(32);
  });
});
