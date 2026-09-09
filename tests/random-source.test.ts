import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  DEATH_DROP_SCATTER_MULTIPLIER,
  DROP_SCATTER_HORIZONTAL,
  DROP_SCATTER_ORIGIN_SPAN,
  DROP_SCATTER_UP,
  dropScatterVelocity,
  dropScatterOrigin,
  rollDropCount,
  seededRandomFn,
  seededRandomSource,
  systemRandomFn,
} from '../src/gameplay/random';
import { resolveExplosion } from '../src/world/Explosion';
import { VoxelWorld } from '../src/world/World';

describe('simulation RandomSource', () => {
  it('is deterministic for the same seed and diverges for another seed', () => {
    const a = seededRandomSource(42);
    const b = seededRandomSource(42);
    const c = seededRandomSource(43);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    const seqC = [c.next(), c.next(), c.next()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    expect(seqA.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('string seeds match hashString-backed sequences', () => {
    const first = seededRandomFn('anarchy');
    const second = seededRandomFn('anarchy');
    expect(first()).toBe(second());
    expect(first()).toBe(second());
  });

  it('rollDropCount is stable with a seeded source', () => {
    const drop = { min: 1, max: 4 };
    expect(rollDropCount(drop, seededRandomFn(7))).toBe(rollDropCount(drop, seededRandomFn(7)));
    expect(rollDropCount({ count: 3 }, seededRandomFn(1))).toBe(3);
  });

  it('drop scatter stays inside the previous gameplay envelope', () => {
    const [x, y, z] = dropScatterVelocity(seededRandomFn(9));
    expect(y).toBe(DROP_SCATTER_UP);
    expect(x).toBeGreaterThanOrEqual(-DROP_SCATTER_HORIZONTAL / 2);
    expect(x).toBeLessThanOrEqual(DROP_SCATTER_HORIZONTAL / 2);
    expect(z).toBeGreaterThanOrEqual(-DROP_SCATTER_HORIZONTAL / 2);
    expect(z).toBeLessThanOrEqual(DROP_SCATTER_HORIZONTAL / 2);
  });

  it('ordinary drop origin jitters around the player without a huge radius', () => {
    const half = DROP_SCATTER_ORIGIN_SPAN / 2;
    const origin = dropScatterOrigin({ x: 10, y: 64, z: -4 }, seededRandomFn(3));
    expect(origin[0]).toBeGreaterThanOrEqual(10 - half);
    expect(origin[0]).toBeLessThanOrEqual(10 + half);
    expect(origin[1]).toBeCloseTo(64.35, 5);
    expect(origin[2]).toBeGreaterThanOrEqual(-4 - half);
    expect(origin[2]).toBeLessThanOrEqual(-4 + half);
  });

  it('death drop scatter is 3× on X/Z and keeps the same vertical toss', () => {
    expect(DEATH_DROP_SCATTER_MULTIPLIER).toBe(3);
    const half = (DROP_SCATTER_ORIGIN_SPAN * DEATH_DROP_SCATTER_MULTIPLIER) / 2;
    const speed = (DROP_SCATTER_HORIZONTAL * DEATH_DROP_SCATTER_MULTIPLIER) / 2;
    let maxOrigin = 0;
    let maxSpeed = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const origin = dropScatterOrigin(
        { x: 0, y: 64, z: 0 },
        seededRandomFn(seed),
        { horizontalScale: DEATH_DROP_SCATTER_MULTIPLIER },
      );
      const [vx, vy, vz] = dropScatterVelocity(
        seededRandomFn(seed + 100),
        { horizontalScale: DEATH_DROP_SCATTER_MULTIPLIER },
      );
      expect(origin[1]).toBeCloseTo(64.35, 5);
      expect(Math.abs(origin[0])).toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(origin[2])).toBeLessThanOrEqual(half + 1e-9);
      expect(vy).toBe(DROP_SCATTER_UP);
      expect(Math.abs(vx)).toBeLessThanOrEqual(speed + 1e-9);
      expect(Math.abs(vz)).toBeLessThanOrEqual(speed + 1e-9);
      maxOrigin = Math.max(maxOrigin, Math.hypot(origin[0], origin[2]));
      maxSpeed = Math.max(maxSpeed, Math.hypot(vx, vz));
    }
    expect(half).toBeCloseTo(0.75, 8);
    expect(speed).toBeCloseTo(2.1, 8);
    expect(maxOrigin).toBeGreaterThan(DROP_SCATTER_ORIGIN_SPAN / 2);
    expect(maxSpeed).toBeGreaterThan(DROP_SCATTER_HORIZONTAL / 2);
  });

  it('explosion resolution uses the injected source, not a second Math.random path', () => {
    const world = new VoxelWorld('rng-explosion');
    world.getChunk(0, 0);
    world.setBlock(2, 40, 2, BlockId.Dirt);
    world.setBlock(3, 40, 2, BlockId.Dirt);
    const a = resolveExplosion(world, { x: 2.5, y: 40.5, z: 2.5, radius: 3, power: 4 }, {
      random: seededRandomFn(21),
    });
    const b = resolveExplosion(world, { x: 2.5, y: 40.5, z: 2.5, radius: 3, power: 4 }, {
      random: seededRandomFn(21),
    });
    expect(a.destroyed).toEqual(b.destroyed);
    expect(a.chainedTnt).toEqual(b.chainedTnt);
  });

  it('systemRandomFn still returns a unit interval value', () => {
    const value = systemRandomFn();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});
