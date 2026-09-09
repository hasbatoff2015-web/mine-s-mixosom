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

/** Horizontal velocity span: `(r - 0.5) * this` → ±0.7 at scale 1. */
export const DROP_SCATTER_HORIZONTAL = 1.4;
/** Upward toss. Death scatter does not scale this. */
export const DROP_SCATTER_UP = 2.2;
/** Origin X/Z width in blocks at scale 1 (`(r - 0.5) * span` → ±0.25). */
export const DROP_SCATTER_ORIGIN_SPAN = 0.5;
/** Death drops fan out this many times farther on X/Z than ordinary block/Q drops. */
export const DEATH_DROP_SCATTER_MULTIPLIER = 3;

export interface DropScatterOptions {
  readonly horizontalScale?: number;
  readonly yOffset?: number;
}

/** Scatter used when a stack pops into the world from a block/player. */
export function dropScatterVelocity(
  random: RandomFn = systemRandomFn,
  options: DropScatterOptions = {},
): readonly [number, number, number] {
  const scale = options.horizontalScale ?? 1;
  const span = DROP_SCATTER_HORIZONTAL * scale;
  return [(random() - 0.5) * span, DROP_SCATTER_UP, (random() - 0.5) * span];
}

/**
 * Minecraft-like origin jitter around a death/block drop point.
 * Scale 1 spans ~0.5 blocks horizontally; death uses `DEATH_DROP_SCATTER_MULTIPLIER`.
 */
export function dropScatterOrigin(
  base: { readonly x: number; readonly y: number; readonly z: number },
  random: RandomFn = systemRandomFn,
  options: DropScatterOptions = {},
): readonly [number, number, number] {
  const scale = options.horizontalScale ?? 1;
  const span = DROP_SCATTER_ORIGIN_SPAN * scale;
  const yOffset = options.yOffset ?? 0.35;
  return [
    base.x + (random() - 0.5) * span,
    base.y + yOffset,
    base.z + (random() - 0.5) * span,
  ];
}
