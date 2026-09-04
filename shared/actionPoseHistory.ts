import { COMMAND_QUEUE_MAX } from './playerCommand';

/** Authoritative eye after the physics tick that applied `commandSeq`. */
export const ACTION_POSE_HISTORY_MAX = 64;

export interface ActionPoseSample {
  readonly commandSeq: number;
  readonly eyeX: number;
  readonly eyeY: number;
  readonly eyeZ: number;
  readonly selectedSlot: number;
}

export interface ActionEye {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function recordActionPose(
  history: ActionPoseSample[],
  sample: ActionPoseSample,
  max = ACTION_POSE_HISTORY_MAX,
): void {
  const last = history[history.length - 1];
  if (last && last.commandSeq === sample.commandSeq) {
    history[history.length - 1] = sample;
  } else {
    history.push(sample);
  }
  if (history.length > max) history.splice(0, history.length - max);
}

/**
 * Eye used to validate an action captured at `commandSeq`.
 *
 * - History hit: exact authoritative pose after that command was simulated.
 * - Pending (`commandSeq` not yet applied, gap ≤ queue bound): current pose
 *   (later look has not been simulated yet).
 * - Missing / too old / unbounded future: reject. Never substitute a later look.
 */
export function resolveActionEye(
  history: readonly ActionPoseSample[],
  appliedCommandSeq: number,
  current: ActionEye,
  commandSeq: number | undefined,
  options?: { readonly maxPendingGap?: number },
): { ok: true; eye: ActionEye; source: 'history' | 'current' | 'pending' }
  | { ok: false; reason: 'stale' } {
  if (commandSeq === undefined || commandSeq < 0) {
    return { ok: true, eye: current, source: 'current' };
  }
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sample = history[i];
    if (!sample || sample.commandSeq !== commandSeq) continue;
    return {
      ok: true,
      eye: { x: sample.eyeX, y: sample.eyeY, z: sample.eyeZ },
      source: 'history',
    };
  }
  if (appliedCommandSeq >= 0 && commandSeq === appliedCommandSeq) {
    return { ok: true, eye: current, source: 'current' };
  }
  const maxPending = options?.maxPendingGap ?? COMMAND_QUEUE_MAX;
  if (commandSeq > appliedCommandSeq && commandSeq - Math.max(appliedCommandSeq, 0) <= maxPending) {
    return { ok: true, eye: current, source: 'pending' };
  }
  return { ok: false, reason: 'stale' };
}
