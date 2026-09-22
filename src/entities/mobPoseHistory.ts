/** Longer than the accepted rewind so 80 ms interpolation still has both samples. */
export const MOB_POSE_HISTORY_TICKS = 16;
/**
 * Mob-only pose rewind. 8 ticks = 400 ms at 20 TPS.
 * Independent of PvP (`MAX_PVP_REWIND_TICKS` stays 5). The client already
 * renders about `ENTITY_INTERP_DELAY_MS` (80 ms) behind the newest snapshot,
 * so 5 ticks left too little budget for click latency + jitter.
 */
export const MAX_MOB_REWIND_TICKS = 8;

export interface MobPoseSample {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface RewoundMobPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly resolvedTick: number;
  readonly rewindTicks: number;
}

export function recordMobPose(
  history: MobPoseSample[],
  sample: MobPoseSample,
  max = MOB_POSE_HISTORY_TICKS,
): void {
  const last = history[history.length - 1];
  if (last?.tick === sample.tick) history[history.length - 1] = sample;
  else history.push(sample);
  if (history.length > max) history.splice(0, history.length - max);
}

export function mobPoseAtTick(
  history: readonly MobPoseSample[],
  requestedTick: number,
): Omit<RewoundMobPose, 'rewindTicks'> | undefined {
  if (!Number.isFinite(requestedTick) || history.length === 0) return undefined;
  let before: MobPoseSample | undefined;
  let after: MobPoseSample | undefined;
  for (const sample of history) {
    if (sample.tick <= requestedTick && (!before || sample.tick > before.tick)) before = sample;
    if (sample.tick >= requestedTick && (!after || sample.tick < after.tick)) after = sample;
  }
  if (!before || !after) return undefined;
  if (before.tick === after.tick) {
    return { x: before.x, y: before.y, z: before.z, yaw: before.yaw, resolvedTick: before.tick };
  }
  const t = (requestedTick - before.tick) / (after.tick - before.tick);
  return {
    x: before.x + (after.x - before.x) * t,
    y: before.y + (after.y - before.y) * t,
    z: before.z + (after.z - before.z) * t,
    yaw: before.yaw + (after.yaw - before.yaw) * t,
    resolvedTick: requestedTick,
  };
}

export function rewindMobPose(
  history: readonly MobPoseSample[],
  requestedTick: number,
  currentTick: number,
  maxRewind = MAX_MOB_REWIND_TICKS,
): RewoundMobPose | undefined {
  if (!Number.isFinite(requestedTick) || !Number.isFinite(currentTick)) return undefined;
  if (requestedTick > currentTick || requestedTick < currentTick - maxRewind) return undefined;
  const pose = mobPoseAtTick(history, requestedTick);
  return pose ? { ...pose, rewindTicks: currentTick - pose.resolvedTick } : undefined;
}
