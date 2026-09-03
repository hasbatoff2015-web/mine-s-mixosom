import { MAX_CATCH_UP_TICKS, MAX_FRAME_DELTA } from '../src/core/constants';
import { advanceFixedStep } from '../src/core/fixedStep';

export interface GameplayTickDue {
  readonly ticks: number;
  readonly nextAccumulator: number;
  readonly elapsed: number;
  readonly droppedSeconds: number;
  readonly droppedTicks: number;
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
  const step = advanceFixedStep(accumulatorSeconds, rawElapsedSeconds, dt, maxFrameDelta, maxTicks);
  const droppedTicks = dt > 0 ? Math.round(step.droppedSeconds / dt) : 0;
  return {
    ticks: step.ticks,
    nextAccumulator: step.nextAccumulator,
    elapsed: step.elapsed,
    droppedSeconds: step.droppedSeconds,
    droppedTicks,
  };
}

export interface TickSlotSchedule {
  readonly nextSlotAt: number;
  readonly waitMs: number;
}

/**
 * Absolute 20 Hz slot. Timeout slack shortens the next wait instead of
 * accumulating (`wait = tickMs - work` drifted to ~17 Hz on Node).
 */
export function scheduleNextTickSlot(
  previousSlotAt: number,
  now: number,
  tickMs: number,
): TickSlotSchedule {
  const step = Math.max(1, tickMs);
  let nextSlotAt = previousSlotAt + step;
  while (nextSlotAt <= now) nextSlotAt += step;
  return { nextSlotAt, waitMs: Math.max(0, nextSlotAt - now) };
}

export interface SimulatedServerLoop {
  readonly outerLoops: number;
  readonly physicsTicks: number;
  readonly snapshots: number;
  readonly catchUpLoops: number;
  readonly droppedTicks: number;
}

/**
 * Deterministic outer-loop accounting. `drift` is the old `setTimeout(tickMs - work)`
 * schedule; `absolute` is `scheduleNextTickSlot`.
 */
export function simulateServerOuterLoop(options: {
  readonly seconds: number;
  readonly tickMs?: number;
  readonly dt?: number;
  readonly workMs?: number;
  readonly timeoutSlackMs?: number;
  readonly mode: 'drift' | 'absolute';
}): SimulatedServerLoop {
  const tickMs = options.tickMs ?? 50;
  const dt = options.dt ?? tickMs / 1000;
  const workMs = options.workMs ?? 5;
  const slack = options.timeoutSlackMs ?? 4;
  const end = options.seconds * 1000;
  let now = 0;
  let lastWall = 0;
  let acc = 0;
  let slot = 0;
  let outerLoops = 0;
  let physicsTicks = 0;
  let snapshots = 0;
  let catchUpLoops = 0;
  let droppedTicks = 0;
  now = tickMs + slack;
  while (now <= end + 1e-9) {
    const due = gameplayTicksDue(acc, (now - lastWall) / 1000, dt);
    lastWall = now;
    acc = due.nextAccumulator;
    droppedTicks += due.droppedTicks;
    if (due.ticks > 0) {
      physicsTicks += due.ticks;
      snapshots += 1;
      if (due.ticks > 1) catchUpLoops += 1;
    }
    outerLoops += 1;
    const afterWork = now + workMs;
    if (options.mode === 'drift') {
      const wait = Math.max(0, tickMs - workMs);
      now = afterWork + wait + slack;
    } else {
      const planned = scheduleNextTickSlot(slot, afterWork, tickMs);
      slot = planned.nextSlotAt;
      now = afterWork + planned.waitMs + slack;
    }
  }
  return { outerLoops, physicsTicks, snapshots, catchUpLoops, droppedTicks };
}
