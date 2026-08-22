import { FIXED_DT, MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from './constants';

export interface FixedStepAdvance {
  readonly elapsed: number;
  readonly ticks: number;
  readonly nextAccumulator: number;
  readonly droppedSeconds: number;
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
