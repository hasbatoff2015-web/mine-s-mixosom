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
