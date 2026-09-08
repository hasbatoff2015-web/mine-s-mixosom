import type { PlayerAABB } from '../src/player/PlayerController';

/** Longer than the accepted rewind so jitter does not evict usable samples. */
export const COMBAT_HISTORY_TICKS = 12;
/** 5 ticks at 20 TPS = 250 ms. Requests outside this window are rejected. */
export const MAX_PVP_REWIND_TICKS = 5;
export const MAX_PENDING_MELEE_ACTIONS = 32;
/** Command wait budget; independent from the already-validated target rewind window. */
export const MAX_PENDING_MELEE_TICKS = 8;

export interface CombatPoseSample {
  readonly serverTick: number;
  readonly commandSeq: number;
  /** True only on the tick that dequeued this command, not sticky repeats. */
  readonly commandBoundary: boolean;
  readonly eyeX: number;
  readonly eyeY: number;
  readonly eyeZ: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly selectedSlot: number;
  readonly aabb: PlayerAABB;
  readonly dead: boolean;
  readonly fallDistance: number;
  readonly onGround: boolean;
  readonly sprinting: boolean;
  readonly inWater: boolean;
  readonly onLadder: boolean;
  readonly riding: boolean;
}

export interface RewoundCombatPose {
  readonly aabb: PlayerAABB;
  readonly dead: boolean;
  readonly resolvedTick: number;
  readonly rewindTicks: number;
}

function cloneAabb(aabb: PlayerAABB): PlayerAABB {
  return { ...aabb };
}

export function recordCombatPose(
  history: CombatPoseSample[],
  sample: CombatPoseSample,
  max = COMBAT_HISTORY_TICKS,
): void {
  const last = history[history.length - 1];
  if (last?.serverTick === sample.serverTick) history[history.length - 1] = sample;
  else history.push(sample);
  if (history.length > max) history.splice(0, history.length - max);
}

/** Exact authoritative post-physics pose for the tick that dequeued commandSeq. */
export function combatPoseForCommand(
  history: readonly CombatPoseSample[],
  commandSeq: number,
): CombatPoseSample | undefined {
  return history.find((sample) => sample.commandBoundary && sample.commandSeq === commandSeq);
}

function lerpAabb(a: PlayerAABB, b: PlayerAABB, t: number): PlayerAABB {
  return {
    minX: a.minX + (b.minX - a.minX) * t,
    minY: a.minY + (b.minY - a.minY) * t,
    minZ: a.minZ + (b.minZ - a.minZ) * t,
    maxX: a.maxX + (b.maxX - a.maxX) * t,
    maxY: a.maxY + (b.maxY - a.maxY) * t,
    maxZ: a.maxZ + (b.maxZ - a.maxZ) * t,
  };
}

export function rewindCombatPose(
  history: readonly CombatPoseSample[],
  requestedTick: number,
  currentTick: number,
  maxRewind = MAX_PVP_REWIND_TICKS,
): RewoundCombatPose | undefined {
  if (!Number.isFinite(requestedTick) || !Number.isFinite(currentTick)) return undefined;
  if (requestedTick > currentTick || requestedTick < currentTick - maxRewind) return undefined;
  let before: CombatPoseSample | undefined;
  let after: CombatPoseSample | undefined;
  for (const sample of history) {
    if (sample.serverTick <= requestedTick && (!before || sample.serverTick > before.serverTick)) before = sample;
    if (sample.serverTick >= requestedTick && (!after || sample.serverTick < after.serverTick)) after = sample;
  }
  if (!before || !after) return undefined;
  if (before.serverTick === after.serverTick) {
    return {
      aabb: cloneAabb(before.aabb),
      dead: before.dead,
      resolvedTick: before.serverTick,
      rewindTicks: currentTick - before.serverTick,
    };
  }
  const t = (requestedTick - before.serverTick) / (after.serverTick - before.serverTick);
  return {
    aabb: lerpAabb(before.aabb, after.aabb, t),
    dead: before.dead || after.dead,
    resolvedTick: requestedTick,
    rewindTicks: currentTick - requestedTick,
  };
}
