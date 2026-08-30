import { hashString, mulberry32 } from '../world/noise';

/**
 * Runtime-independent simulation RNG.
 * Visual/audio code may keep `Math.random`; gameplay must not call it directly.
 */
export interface RandomSource {
  next(): number;
}

export type RandomFn = () => number;

/** Browser/Node default. The only simulation path that may call `Math.random`. */
export const SYSTEM_RANDOM: RandomSource = {
  next: () => Math.random(),
};

export function systemRandomFn(): number {
  return SYSTEM_RANDOM.next();
}

export function asRandomFn(source: RandomSource = SYSTEM_RANDOM): RandomFn {
  return () => source.next();
}

export function seededRandomSource(seed: number | string): RandomSource {
  const numeric = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const rng = mulberry32(numeric);
  return { next: rng };
}

export function seededRandomFn(seed: number | string): RandomFn {
  return asRandomFn(seededRandomSource(seed));
}

export function nextIntInclusive(random: RandomFn, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

export function rollDropCount(
  drop: { readonly count?: number; readonly min?: number; readonly max?: number },
  random: RandomFn = systemRandomFn,
): number {
  if (drop.count !== undefined) return drop.count;
  if (drop.min !== undefined) return nextIntInclusive(random, drop.min, drop.max ?? drop.min);
  return 1;
}

/** Historical name used by the Anarchy server. Same helper. */
export const rollBlockDropCount = rollDropCount;

/** Scatter used when a stack pops into the world from a block/player. */
export function dropScatterVelocity(
  random: RandomFn = systemRandomFn,
): readonly [number, number, number] {
  return [(random() - 0.5) * 1.4, 2.2, (random() - 0.5) * 1.4];
}
