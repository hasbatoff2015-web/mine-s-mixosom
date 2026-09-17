import { describe, expect, it } from 'vitest';
import {
  TOTEM_BURST_COLORS,
  TOTEM_BURST_COUNT,
  TOTEM_BURST_LIFE_MAX,
  TOTEM_BURST_LIFE_MIN,
  TOTEM_BURST_MAX_EFFECTS,
  TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON,
  TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON,
  TOTEM_BURST_SPEED_FIRST_PERSON,
  TOTEM_BURST_SPEED_THIRD_PERSON,
  TOTEM_PRESENTATION_DISTANCE,
  createTotemBurst,
  isTotemPaletteColor,
  stepTotemBurst,
} from '../src/gameplay/totemBurst';
import { TOTEM_PARTICLE_SIZE, TotemParticles } from '../src/rendering/TotemParticles';

function cycle(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe('Totem particle burst', () => {
  it('spawns a bounded Totem-palette burst that expires within one second', () => {
    const burst = createTotemBurst(3, 70, 8, { random: cycle([0.1, 0.4, 0.7, 0.9]) });
    expect(burst.particles).toHaveLength(TOTEM_BURST_COUNT);
    expect(TOTEM_BURST_COUNT).toBe(48);
    expect(TOTEM_BURST_COUNT * TOTEM_BURST_MAX_EFFECTS).toBe(192);
    expect(TOTEM_BURST_LIFE_MIN).toBe(0.55);
    expect(TOTEM_BURST_LIFE_MAX).toBe(0.9);
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

  it('keeps spawn tight and roughly doubles the previous outward speed', () => {
    expect(TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON).toBe(0.16);
    expect(TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON).toBe(0.26);
    expect(TOTEM_BURST_SPEED_FIRST_PERSON).toBeCloseTo(2.3);
    expect(TOTEM_BURST_SPEED_THIRD_PERSON).toBeCloseTo(3.1);
    expect(TOTEM_BURST_SPEED_FIRST_PERSON / 1.15).toBeCloseTo(2, 5);
    expect(TOTEM_BURST_SPEED_THIRD_PERSON / 1.55).toBeCloseTo(2, 5);

    const seed = [0.1, 0.4, 0.7, 0.9];
    const firstPerson = createTotemBurst(0, 70, 0, {
      firstPerson: true,
      random: cycle(seed),
    });
    const remote = createTotemBurst(0, 70, 0, {
      firstPerson: false,
      random: cycle(seed),
    });
    const speedRatio = TOTEM_BURST_SPEED_THIRD_PERSON / TOTEM_BURST_SPEED_FIRST_PERSON;
    for (let index = 0; index < TOTEM_BURST_COUNT; index += 1) {
      const local = firstPerson.particles[index]!;
      const other = remote.particles[index]!;
      expect(Math.abs(local.x)).toBeLessThanOrEqual(TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON + 1e-6);
      expect(Math.abs(local.z)).toBeLessThanOrEqual(TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON + 1e-6);
      expect(Math.abs(other.x)).toBeLessThanOrEqual(TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON + 1e-6);
      expect(Math.abs(other.z)).toBeLessThanOrEqual(TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON + 1e-6);
      expect(other.vx / local.vx).toBeCloseTo(speedRatio, 5);
      expect(other.vz / local.vz).toBeCloseTo(speedRatio, 5);
    }

    const horizontal = remote.particles.map((particle) => Math.hypot(particle.vx, particle.vz));
    expect(mean(horizontal)).toBeGreaterThan(1.6);
    expect(Math.min(...horizontal)).toBeGreaterThan(0.9);
  });

  it('biases the burst outward with a modest upward lift', () => {
    const burst = createTotemBurst(0, 70, 0, {
      random: cycle([0.15, 0.35, 0.55, 0.75, 0.95]),
    });
    const upward = burst.particles.map((particle) => particle.vy);
    const horizontal = burst.particles.map((particle) => Math.hypot(particle.vx, particle.vz));
    expect(Math.min(...upward)).toBeGreaterThan(0.8);
    expect(mean(upward)).toBeGreaterThan(1.6);
    expect(mean(horizontal)).toBeGreaterThan(mean(upward) * 0.55);
    expect(upward.filter((value) => value > 4.8).length).toBeLessThan(burst.particles.length * 0.2);
  });

  it('removes finished bursts and keeps a bounded number of concurrent effects', () => {
    const visuals = new TotemParticles();
    expect(visuals.pointSize).toBeCloseTo(TOTEM_PARTICLE_SIZE);
    expect(TOTEM_PARTICLE_SIZE).toBeCloseTo(0.05);
    for (let index = 0; index < TOTEM_BURST_MAX_EFFECTS + 2; index += 1) {
      visuals.burst(index, 70, 0, { random: cycle([0.2, 0.5, 0.8]) });
    }
    expect(visuals.activeBurstCount).toBe(TOTEM_BURST_MAX_EFFECTS);
    expect(visuals.particleCount).toBe(TOTEM_BURST_COUNT * TOTEM_BURST_MAX_EFFECTS);
    expect(visuals.particleCount).toBe(192);
    visuals.update(1);
    expect(visuals.activeBurstCount).toBe(0);
    expect(visuals.particleCount).toBe(0);
    visuals.dispose();
  });

  it('keeps Totem presentation distance independent of firework range', () => {
    expect(TOTEM_PRESENTATION_DISTANCE).toBe(32);
  });
});
