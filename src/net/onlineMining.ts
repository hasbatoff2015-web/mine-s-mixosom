/** Client/server mining coordination for Anarchy block-break. */

export function miningBlockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export interface OnlineBreakGate {
  pendingBlockAction?: { kind: 'break' | 'place'; x: number; y: number; z: number };
  rejectedBlockKey?: string;
  miningFinishKey?: string;
  miningLocked?: boolean;
}

export type BreakFinishHoldReason = 'ok' | 'pending' | 'rejected' | 'finish-inflight';

/**
 * Abort only cancels an in-progress mine. After finish is sent, the server
 * must be allowed to complete (or reject for a real reason). Mouse-up must
 * not send abort for that target.
 */
export function shouldSendBreakAbort(input: {
  readonly miningReleased: boolean;
  readonly miningTarget?: string;
  readonly finishKey?: string;
}): boolean {
  if (!input.miningReleased || !input.miningTarget) return false;
  return input.finishKey !== input.miningTarget;
}

/** Keep `input.mining` true after local finish so server advanceMining is not wiped. */
export function shouldHoldServerMining(input: {
  readonly buttonDown: boolean;
  readonly finishKey?: string;
}): boolean {
  return input.buttonDown || Boolean(input.finishKey);
}

/** Do not start a new mine while a finish is awaiting the authoritative break. */
export function shouldRetargetOnlineMine(input: {
  readonly nextTargetKey?: string;
  readonly currentTarget?: string;
  readonly finishKey?: string;
}): boolean {
  if (input.finishKey) return false;
  return input.nextTargetKey !== input.currentTarget;
}

/**
 * Wait for an in-flight finish only while the crosshair is still on that block
 * (or on empty air). A different solid target must be allowed to retarget.
 */
export function shouldWaitForInFlightFinish(input: {
  readonly finishKey?: string;
  readonly targetKey?: string;
}): boolean {
  if (!input.finishKey) return false;
  return !input.targetKey || input.targetKey === input.finishKey;
}

/**
 * `mining` means the server is not done yet (client is typically one tick ahead).
 * It is not a protection deny and must not lock the block as rejected.
 */
export function isInFlightBreakReject(reason: string | undefined): boolean {
  return reason === 'mining';
}

export function breakFinishHoldReason(
  gate: OnlineBreakGate,
  x: number,
  y: number,
  z: number,
): BreakFinishHoldReason {
  const key = miningBlockKey(x, y, z);
  if (gate.miningFinishKey === key) return 'finish-inflight';
  if (gate.rejectedBlockKey === key) return 'rejected';
  const pending = gate.pendingBlockAction;
  if (pending && pending.kind === 'break' && pending.x === x && pending.y === y && pending.z === z) {
    return 'pending';
  }
  return 'ok';
}

export function shouldSendBreakFinish(gate: OnlineBreakGate, x: number, y: number, z: number): boolean {
  return breakFinishHoldReason(gate, x, y, z) === 'ok';
}

export function noteBreakStartSent(gate: OnlineBreakGate, x: number, y: number, z: number): void {
  gate.miningLocked = true;
  const key = miningBlockKey(x, y, z);
  if (gate.rejectedBlockKey === key) gate.rejectedBlockKey = undefined;
}

export function noteBreakFinishSent(gate: OnlineBreakGate, x: number, y: number, z: number): void {
  gate.pendingBlockAction = { kind: 'break', x, y, z };
  gate.miningFinishKey = miningBlockKey(x, y, z);
}

export function noteBreakAbortSent(gate: OnlineBreakGate): void {
  gate.pendingBlockAction = undefined;
  gate.miningFinishKey = undefined;
  gate.miningLocked = false;
}

/** Mouse-up starts a new attempt; do not keep a hard deny on the same coords. */
export function noteMiningReleased(gate: OnlineBreakGate): void {
  gate.rejectedBlockKey = undefined;
}

export function abandonInFlightFinish(gate: OnlineBreakGate): void {
  gate.pendingBlockAction = undefined;
  gate.miningFinishKey = undefined;
  gate.miningLocked = false;
}

/**
 * Sequenced `action_result` is the only ack for `block_break_finish`.
 * `pendingBlockAction` must clear here: there is often no `block_result` / `block_update`
 * after a failed finish, and reconnect was the only thing wiping the gate.
 */
export function applyBreakActionResult(gate: OnlineBreakGate, result: {
  readonly ok: boolean;
  readonly reason?: string;
  readonly kind?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}): void {
  const isFinish = result.kind === 'block_break_finish' || result.kind === undefined;
  const hasCoords = result.x !== undefined && result.y !== undefined && result.z !== undefined;
  if (isFinish) {
    const pending = gate.pendingBlockAction;
    if (!hasCoords || (pending && pending.x === result.x && pending.y === result.y && pending.z === result.z)) {
      gate.pendingBlockAction = undefined;
    }
  }
  if (!hasCoords) return;
  const key = miningBlockKey(result.x!, result.y!, result.z!);
  if (result.ok) {
    if (isFinish && gate.miningFinishKey === key) {
      gate.miningFinishKey = undefined;
      gate.miningLocked = false;
    }
    if (gate.rejectedBlockKey === key) gate.rejectedBlockKey = undefined;
    return;
  }
  if (isInFlightBreakReject(result.reason)) return;
  gate.miningLocked = false;
  if (!isFinish) return;
  if (gate.miningFinishKey === key) gate.miningFinishKey = undefined;
  gate.rejectedBlockKey = key;
}

export function formatBreakGateDiag(gate: OnlineBreakGate, extra?: {
  readonly blockId?: number;
  readonly miningTarget?: string;
  readonly hold?: BreakFinishHoldReason;
}): string {
  const pending = gate.pendingBlockAction
    ? `${gate.pendingBlockAction.kind}:${gate.pendingBlockAction.x},${gate.pendingBlockAction.y},${gate.pendingBlockAction.z}`
    : '—';
  const parts = [
    `finish=${gate.miningFinishKey ?? '—'}`,
    `pending=${pending}`,
    `rejected=${gate.rejectedBlockKey ?? '—'}`,
    `locked=${gate.miningLocked ? 1 : 0}`,
  ];
  if (extra?.miningTarget !== undefined) parts.push(`mine=${extra.miningTarget || '—'}`);
  if (extra?.blockId !== undefined) parts.push(`id=${extra.blockId}`);
  if (extra?.hold !== undefined) parts.push(`hold=${extra.hold}`);
  return parts.join(' ');
}
