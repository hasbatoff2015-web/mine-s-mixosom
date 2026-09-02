import { MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from '../src/core/constants';

export interface GameplayTickDue {
  readonly ticks: number;
  readonly nextAccumulator: number;
  readonly elapsed: number;
}

/**
 * Same catch-up rule as the client `advanceFixedStep`: convert wall time into
 * a bounded number of 20 TPS steps. Does not change FIXED_DT or tick rate.
 */
export function gameplayTicksDue(
  accumulatorSeconds: number,
  rawElapsedSeconds: number,
  dt: number,
  maxFrameDelta = MAX_FRAME_DELTA,
  maxTicks = MAX_CATCH_UP_TICKS,
): GameplayTickDue {
  const elapsed = Math.min(maxFrameDelta, Math.max(0, rawElapsedSeconds));
  let next = accumulatorSeconds + elapsed;
  const ticks = Math.min(maxTicks, Math.floor((next + 1e-12) / dt));
  next -= ticks * dt;
  if (next < 1e-12) next = 0;
  return { ticks, nextAccumulator: next, elapsed };
}
