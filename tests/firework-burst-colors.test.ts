import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUEL_BURST_LIFE_SCALE, DUEL_BURST_PARTICLE_SIZE, DUEL_BURST_VELOCITY_SCALE } from '../shared/duels';
import {
  FIREWORK_BURST_COLORS,
  FIREWORK_COMPACT_PARTICLE_SIZE,
  FIREWORK_ORDINARY_PARTICLE_SIZE,
  FireworkVisuals,
  chooseFireworkBurstColor,
} from '../src/rendering/FireworkVisuals';
import { TextureAtlas } from '../src/rendering/TextureAtlas';

afterEach(() => vi.restoreAllMocks());

describe('firework burst presentation', () => {
  it('mixes 70 white and 18 evenly spaced particles of one palette accent per burst', () => {
    expect(chooseFireworkBurstColor(() => 0)).toBe(FIREWORK_BURST_COLORS[0]);
    expect(chooseFireworkBurstColor(() => 0.999)).toBe(FIREWORK_BURST_COLORS.at(-1));
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    const visuals = new FireworkVisuals();
    expect(load).toHaveBeenCalledWith(TextureAtlas.url('item/firework_rocket'));
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    visuals.sync([
      { id: 'red', x: 0, y: 0, z: 0, state: 'burst' },
      { id: 'green', x: 3, y: 0, z: 0, state: 'burst' },
    ]);
    visuals.update(0);
    const points = visuals.group.children.find((child): child is THREE.Points => child instanceof THREE.Points)!;
    const colors = points.geometry.getAttribute('color');
    expect(points.geometry.drawRange.count).toBe(176);
    expect((points.material as THREE.PointsMaterial).blending).toBe(THREE.NormalBlending);
    const color = (index: number) => [colors.getX(index), colors.getY(index), colors.getZ(index)];
    for (const start of [0, 88]) {
      const white = Array.from({ length: 88 }, (_, index) => index)
        .filter((index) => color(start + index).every((channel) => channel === 1));
      const accent = Array.from({ length: 88 }, (_, index) => index)
        .filter((index) => !white.includes(index));
      expect(white).toHaveLength(70);
      expect(accent).toEqual(Array.from({ length: 18 }, (_, index) => index * 5));
      const expected = new THREE.Color(start === 0 ? FIREWORK_BURST_COLORS[0] : FIREWORK_BURST_COLORS[3]).toArray();
      for (const index of accent) {
        color(start + index).forEach((channel, component) => expect(channel).toBeCloseTo(expected[component]!, 6));
      }
    }
    visuals.dispose();
  });

  it('spawns a burst without a rocket sprite and keeps the ordinary velocity and life', () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const viaSync = new FireworkVisuals();
    const viaSpawn = new FireworkVisuals();
    viaSync.sync([{ id: 'rocket', x: 4, y: 8, z: 2, state: 'burst' }]);
    viaSpawn.spawnBurst(4, 8, 2);
    expect(spriteCount(viaSync)).toBe(0);
    expect(spriteCount(viaSpawn)).toBe(0);
    viaSync.update(0.05);
    viaSpawn.update(0.05);
    const synced = samples(viaSync);
    const spawned = samples(viaSpawn);
    expect(synced).toHaveLength(88);
    expect(spawned).toHaveLength(88);
    for (let index = 0; index < 88; index += 1) {
      expect(spawned[index]!.x).toBeCloseTo(synced[index]!.x, 5);
      expect(spawned[index]!.z).toBeCloseTo(synced[index]!.z, 5);
      const radius = Math.hypot(spawned[index]!.x - 4, spawned[index]!.z - 2);
      expect(radius).toBeCloseTo(expectedHorizontal(index, 1, 0.05), 5);
    }
    expect(Math.max(...spawned.map((sample) => Math.hypot(sample.x - 4, sample.z - 2)))).toBeGreaterThan(0.05);
    viaSync.dispose();
    viaSpawn.dispose();
  });

  it('halves duel burst speed and retires those particles earlier', () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ordinary = new FireworkVisuals();
    const duel = new FireworkVisuals();
    ordinary.spawnBurst(0, 10, 0);
    duel.spawnBurst(0, 10, 0, {
      velocityScale: DUEL_BURST_VELOCITY_SCALE,
      lifeScale: DUEL_BURST_LIFE_SCALE,
      size: DUEL_BURST_PARTICLE_SIZE,
    });
    expect(spriteCount(ordinary)).toBe(0);
    expect(spriteCount(duel)).toBe(0);
    expect(pointSizes(ordinary)).toEqual([FIREWORK_ORDINARY_PARTICLE_SIZE, FIREWORK_COMPACT_PARTICLE_SIZE]);
    expect(pointSizes(duel)).toEqual([FIREWORK_ORDINARY_PARTICLE_SIZE, FIREWORK_COMPACT_PARTICLE_SIZE]);
    expect(FIREWORK_ORDINARY_PARTICLE_SIZE).toBe(0.2);
    expect(DUEL_BURST_PARTICLE_SIZE).toBe(0.12);
    expect(FIREWORK_COMPACT_PARTICLE_SIZE).toBe(DUEL_BURST_PARTICLE_SIZE);
    ordinary.update(0.05);
    duel.update(0.05);
    expect(drawCount(ordinary, FIREWORK_ORDINARY_PARTICLE_SIZE)).toBe(88);
    expect(drawCount(ordinary, FIREWORK_COMPACT_PARTICLE_SIZE)).toBe(0);
    expect(drawCount(duel, FIREWORK_COMPACT_PARTICLE_SIZE)).toBe(88);
    expect(drawCount(duel, FIREWORK_ORDINARY_PARTICLE_SIZE)).toBe(0);
    expect((pointsOf(duel, FIREWORK_COMPACT_PARTICLE_SIZE).material as THREE.PointsMaterial).size).toBe(0.12);
    expect((pointsOf(ordinary, FIREWORK_ORDINARY_PARTICLE_SIZE).material as THREE.PointsMaterial).size).toBe(0.2);
    const ordinarySamples = samples(ordinary, FIREWORK_ORDINARY_PARTICLE_SIZE);
    const duelSamples = samples(duel, FIREWORK_COMPACT_PARTICLE_SIZE);
    expect(ordinarySamples).toHaveLength(88);
    expect(duelSamples).toHaveLength(88);
    for (let index = 0; index < 88; index += 1) {
      const ordinaryRadius = Math.hypot(ordinarySamples[index]!.x, ordinarySamples[index]!.z);
      const duelRadius = Math.hypot(duelSamples[index]!.x, duelSamples[index]!.z);
      expect(duelRadius).toBeCloseTo(ordinaryRadius * 0.5, 5);
      expect(ordinaryRadius).toBeCloseTo(expectedHorizontal(index, 1, 0.05), 5);
      expect(duelRadius).toBeCloseTo(expectedHorizontal(index, 0.5, 0.05), 5);
    }
    ordinary.dispose();
    duel.dispose();

    const agingOrdinary = new FireworkVisuals();
    const agingDuel = new FireworkVisuals();
    agingOrdinary.spawnBurst(0, 0, 0);
    agingDuel.spawnBurst(0, 0, 0, {
      velocityScale: DUEL_BURST_VELOCITY_SCALE,
      lifeScale: DUEL_BURST_LIFE_SCALE,
      size: DUEL_BURST_PARTICLE_SIZE,
    });
    for (let step = 0; step < 9; step += 1) {
      agingOrdinary.update(0.1);
      agingDuel.update(0.1);
    }
    expect(drawCount(agingOrdinary, FIREWORK_ORDINARY_PARTICLE_SIZE)).toBe(88);
    expect(drawCount(agingDuel, FIREWORK_COMPACT_PARTICLE_SIZE)).toBe(58);
    expect(spriteCount(agingDuel)).toBe(0);
    for (let step = 0; step < 3; step += 1) {
      agingOrdinary.update(0.1);
      agingDuel.update(0.1);
    }
    expect(drawCount(agingDuel, FIREWORK_COMPACT_PARTICLE_SIZE)).toBe(0);
    expect(drawCount(agingOrdinary, FIREWORK_ORDINARY_PARTICLE_SIZE)).toBe(58);
    agingOrdinary.dispose();
    agingDuel.dispose();
  });
});

function spriteCount(visuals: FireworkVisuals): number {
  return visuals.group.children.filter((child) => child instanceof THREE.Sprite).length;
}

function pointSizes(visuals: FireworkVisuals): number[] {
  return visuals.group.children
    .filter((child): child is THREE.Points => child instanceof THREE.Points)
    .map((points) => (points.material as THREE.PointsMaterial).size);
}

function pointsOf(visuals: FireworkVisuals, size?: number): THREE.Points {
  const points = visuals.group.children.filter((child): child is THREE.Points => child instanceof THREE.Points);
  if (size === undefined) {
    return points.find((entry) => entry.geometry.drawRange.count > 0) ?? points[0]!;
  }
  const match = points.find((entry) => Math.abs((entry.material as THREE.PointsMaterial).size - size) < 1e-6);
  if (!match) throw new Error(`missing point layer ${size}`);
  return match;
}

function drawCount(visuals: FireworkVisuals, size?: number): number {
  return pointsOf(visuals, size).geometry.drawRange.count;
}

function samples(visuals: FireworkVisuals, size?: number): Array<{ x: number; y: number; z: number }> {
  const points = pointsOf(visuals, size);
  const position = points.geometry.getAttribute('position');
  const count = points.geometry.drawRange.count;
  const result: Array<{ x: number; y: number; z: number }> = [];
  for (let index = 0; index < count; index += 1) {
    result.push({ x: position.getX(index), y: position.getY(index), z: position.getZ(index) });
  }
  return result;
}

function expectedHorizontal(index: number, velocityScale: number, dt: number): number {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const elevation = 1 - 2 * (index + 0.5) / 88;
  const horizontal = Math.sqrt(1 - elevation * elevation);
  const speed = (2.6 + (index % 4) * 0.18) * velocityScale;
  return Math.hypot(Math.cos(angle) * horizontal * speed * dt, Math.sin(angle) * horizontal * speed * dt);
}
