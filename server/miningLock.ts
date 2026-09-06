/**
 * Server mining lock vs the command queue.
 *
 * `block_break_start` is applied immediately. Movement commands stay FIFO:
 * one per physics tick. Packets the client sent *before* START (idle, no
 * `mining`) can therefore be applied *after* the lock exists. Treating those
 * as mouse-up wipes `miningTarget` and makes the first overlay cycle a dry
 * run. A later START on the same hold sees a queue already full of
 * `mining: true`, so neighbors break on the first cycle.
 *
 * Mouse-up / pause is a command with seq >= START and no `mining: true`.
 */

export function shouldKeepMiningLock(input: {
  readonly mining?: boolean;
  readonly appliedCommandSeq: number;
  readonly miningStartCommandSeq?: number;
}): boolean {
  if (input.mining === true) return true;
  const started = input.miningStartCommandSeq;
  if (started === undefined) return false;
  return input.appliedCommandSeq < started;
}

export function clearMiningLock(player: {
  miningTarget?: { x: number; y: number; z: number };
  miningProgress: number;
  miningStartCommandSeq?: number;
}): void {
  player.miningTarget = undefined;
  player.miningProgress = 0;
  player.miningStartCommandSeq = undefined;
}

/**
 * Survival finish vs the mining lock.
 *
 * `reason: mining` means there is no lock on this cell (START never landed, or
 * a later input cancelled it). The client must send a new START.
 *
 * `reason: in_progress` means START already locked this cell but
 * `advanceMining` has not ticked yet (`progress === 0`). That is not a missing
 * lock. Treating it as `mining` makes the client reset the overlay (dry first
 * cycle) while the server still holds the target.
 */
export function survivalFinishLockReject(player: {
  readonly miningTarget?: { x: number; y: number; z: number };
  readonly miningProgress: number;
}, x: number, y: number, z: number): 'mining' | 'in_progress' | undefined {
  const mining = player.miningTarget;
  if (!mining || mining.x !== x || mining.y !== y || mining.z !== z) return 'mining';
  if (player.miningProgress <= 0) return 'in_progress';
  return undefined;
}
