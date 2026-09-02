import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  dropScatterVelocity,
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
    expect(y).toBe(2.2);
    expect(x).toBeGreaterThanOrEqual(-0.7);
    expect(x).toBeLessThanOrEqual(0.7);
    expect(z).toBeGreaterThanOrEqual(-0.7);
    expect(z).toBeLessThanOrEqual(0.7);
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
