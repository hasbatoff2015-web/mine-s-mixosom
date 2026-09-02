import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from './constants';

export interface FixedStepAdvance {
  readonly elapsed: number;
  readonly ticks: number;
  readonly nextAccumulator: number;
  readonly droppedSeconds: number;
}

export interface FixedStepPose {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts a raw frame delta into a bounded number of 20 TPS steps.
 * Excess time beyond `MAX_CATCH_UP_TICKS` is dropped, not queued, so a 300 ms
 * stall cannot run an unbounded catch-up loop on the next frames.
 */
export function advanceFixedStep(
  accumulator: number,
  rawElapsedSeconds: number,
  dt = FIXED_DT,
  maxFrameDelta = MAX_FRAME_DELTA,
  maxTicks = MAX_CATCH_UP_TICKS,
): FixedStepAdvance {
  const elapsed = Math.min(maxFrameDelta, Math.max(0, rawElapsedSeconds));
  let next = accumulator + elapsed;
  const maxAccumulated = Math.max(0, maxTicks) * dt;
  let droppedSeconds = 0;
  if (next > maxAccumulated) {
    droppedSeconds = next - maxAccumulated;
    next = maxAccumulated;
  }
  const ticks = Math.min(maxTicks, Math.floor((next + 1e-12) / dt));
  next -= ticks * dt;
  if (next < 1e-12) next = 0;
  return { elapsed, ticks, nextAccumulator: next, droppedSeconds };
}

/**
 * Leftover accumulator as the 0..1 blend toward the pose after this frame's ticks.
 * `advanceFixedStep` always returns leftover < dt, so this is leftover / dt.
 */
export function interpolationAlpha(leftover: number, dt = FIXED_DT): number {
  if (!(dt > 0) || leftover <= 0) return 0;
  if (leftover >= dt) return 1;
  return leftover / dt;
}

/**
 * After N ticks in one render frame, PlayerController has copied previousPosition
 * at the start of every inner tick. Leftover/dt is the fraction of *one* tick, so
 * the interpolation origin must be the pose from before this frame's first tick,
 * not the last inner copy. ticks=0 leaves previousPosition unchanged.
 */
export function restoreInterpolationOrigin(
  previousPosition: FixedStepPose,
  originBeforeTicks: Readonly<FixedStepPose>,
  ticksThisFrame: number,
): void {
  if (ticksThisFrame < 1) return;
  previousPosition.x = originBeforeTicks.x;
  previousPosition.y = originBeforeTicks.y;
  previousPosition.z = originBeforeTicks.z;
}

/**
 * Canonical local render pose: lerp(originBeforeTicks, positionAfterTicks, leftover/dt).
 * Same expression Game.render uses after restoreInterpolationOrigin.
 */
export function interpolateAfterFixedTicks(
  originBeforeTicks: Readonly<FixedStepPose>,
  positionAfterTicks: Readonly<FixedStepPose>,
  leftover: number,
  dt = FIXED_DT,
): FixedStepPose & { alpha: number } {
  const alpha = interpolationAlpha(leftover, dt);
  return {
    x: originBeforeTicks.x + (positionAfterTicks.x - originBeforeTicks.x) * alpha,
    y: originBeforeTicks.y + (positionAfterTicks.y - originBeforeTicks.y) * alpha,
    z: originBeforeTicks.z + (positionAfterTicks.z - originBeforeTicks.z) * alpha,
    alpha,
  };
}
