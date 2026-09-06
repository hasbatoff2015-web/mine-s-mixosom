/** Client/server mining coordination for Anarchy block-break. */

export function miningBlockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export interface OnlineBreakGate {
  pendingBlockAction?: { kind: 'break' | 'place'; x: number; y: number; z: number };
  rejectedBlockKey?: string;
  miningFinishKey?: string;
  miningLocked?: boolean;
  /**
   * True only between finish-sent and mouse-up / look-away / ack.
   * Mouse-up must clear this so the next pointerdown can start a new mine
   * even if `miningFinishKey` is still held for the server `input.mining` packet.
   */
  clientWaitFinish?: boolean;
  /** Ticks spent with a finish in flight. Caps a stuck wait if no `action_result`. */
  finishWaitTicks?: number;
}

export type BreakFinishHoldReason = 'ok' | 'pending' | 'rejected' | 'finish-inflight';

export const MAX_FINISH_WAIT_TICKS = 40;

export type OnlineMiningTickInput = {
  readonly buttonDown: boolean;
  readonly targetKey?: string;
  readonly miningTarget?: string;
  readonly finishKey?: string;
  readonly clientWaitFinish?: boolean;
  readonly miningLocked?: boolean;
  readonly finishWaitTicks?: number;
};

export type OnlineMiningOp =
  | { readonly type: 'wait' }
  | { readonly type: 'hold-idle' }
  | { readonly type: 'abandon-start'; readonly targetKey: string }
  | { readonly type: 'abandon-idle' }
  | { readonly type: 'start'; readonly targetKey: string }
  | { readonly type: 'progress' }
  | { readonly type: 'idle' };

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
 * Wait for an in-flight finish only while the player is still holding AND
 * (crosshair on that block or empty air). Mouse-up clears `clientWaitFinish`
 * so the next pointerdown is not swallowed. A different solid target must
 * be allowed to retarget even while holding.
 */
export function shouldWaitForInFlightFinish(input: {
  readonly finishKey?: string;
  readonly targetKey?: string;
  readonly clientWaitFinish?: boolean;
}): boolean {
  if (!input.finishKey || !input.clientWaitFinish) return false;
  return !input.targetKey || input.targetKey === input.finishKey;
}

/**
 * A closer remote player must not steal the mining tick while a finish is
 * in flight. Skipping `applyOnlineMiningTick` freezes `finishWaitTicks` at 0,
 * so `MAX_FINISH_WAIT_TICKS` never fires. That is the "Player B stands at the
 * oak planks → Player A cannot mine anything until B breaks that cell" lock:
 * B's later `block_update` is what finally clears `miningFinishKey`.
 */
export function shouldSkipMiningTickForRemote(input: {
  readonly remoteCloser: boolean;
  readonly finishKey?: string;
}): boolean {
  if (input.finishKey) return false;
  return input.remoteCloser;
}

/**
 * Authoritative voxel change (`block_update` / `block_batch` / successful
 * break). Coordinate-matched only — another player's edit of cell X must not
 * wipe mining of cell Y. Matching cell X *does* unlock a stuck finish on X,
 * which is why Player B breaking the oak planks "heals" Player A.
 */
export function applyAuthoritativeVoxelToMiningGate(
  gate: OnlineBreakGate,
  miningTarget: string | undefined,
  x: number,
  y: number,
  z: number,
): { miningTarget?: string; clearProgress: boolean } {
  const key = miningBlockKey(x, y, z);
  if (gate.miningFinishKey === key) {
    gate.miningFinishKey = undefined;
    gate.miningLocked = false;
    gate.clientWaitFinish = false;
    gate.finishWaitTicks = 0;
  }
  const pending = gate.pendingBlockAction;
  if (pending && pending.x === x && pending.y === y && pending.z === z) {
    gate.pendingBlockAction = undefined;
  }
  if (miningTarget === key) {
    return { miningTarget: undefined, clearProgress: true };
  }
  return { miningTarget, clearProgress: false };
}

/**
 * Single client mining tick after raycast. Encodes: wait vs hold-idle vs
 * abandon vs start vs progress. Used by Game.ts and regression tests.
 */
export function resolveOnlineMiningTick(input: OnlineMiningTickInput): OnlineMiningOp {
  const finish = input.finishKey;
  const waitedTooLong = Boolean(finish && (input.finishWaitTicks ?? 0) >= MAX_FINISH_WAIT_TICKS);
  if (waitedTooLong) {
    if (input.buttonDown && input.targetKey) return { type: 'abandon-start', targetKey: input.targetKey };
    return { type: 'abandon-idle' };
  }
  if (shouldWaitForInFlightFinish({
    finishKey: finish,
    targetKey: input.targetKey,
    clientWaitFinish: input.clientWaitFinish,
  })) {
    return { type: 'wait' };
  }
  if (finish && input.targetKey && input.targetKey !== finish) {
    return input.buttonDown
      ? { type: 'abandon-start', targetKey: input.targetKey }
      : { type: 'abandon-idle' };
  }
  if (finish && !input.clientWaitFinish) {
    if (input.buttonDown && input.targetKey) {
      if (input.targetKey !== finish) return { type: 'abandon-start', targetKey: input.targetKey };
      return { type: 'start', targetKey: input.targetKey };
    }
    return { type: 'hold-idle' };
  }
  if (!input.buttonDown || !input.targetKey) return { type: 'idle' };
  if (input.targetKey !== input.miningTarget) return { type: 'start', targetKey: input.targetKey };
  return { type: 'progress' };
}

export function resetOnlineMiningGate(gate: OnlineBreakGate): void {
  gate.pendingBlockAction = undefined;
  gate.rejectedBlockKey = undefined;
  gate.miningFinishKey = undefined;
  gate.miningLocked = false;
  gate.clientWaitFinish = false;
  gate.finishWaitTicks = 0;
}

/**
 * `mining` means the server is not done yet (client is typically one tick ahead).
 * It is not a protection deny and must not lock the block as rejected.
 */
export function isInFlightBreakReject(reason: string | undefined): boolean {
  return reason === 'mining';
}

/**
 * Server finish now accepts any `miningProgress > 0`. `reason: mining` therefore
 * means there is no lock (start never landed, or `input.mining` went false and
 * wiped the target). Resending finish cannot recover; a new start can.
 */
export function shouldResendBreakStartAfterFinishReject(reason: string | undefined): boolean {
  return isInFlightBreakReject(reason);
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
  gate.clientWaitFinish = true;
  gate.finishWaitTicks = 0;
}

export function noteBreakAbortSent(gate: OnlineBreakGate): void {
  resetOnlineMiningGate(gate);
}

/** Mouse-up starts a new attempt; do not keep a hard deny or client wait on the same coords. */
export function noteMiningReleased(gate: OnlineBreakGate): void {
  gate.rejectedBlockKey = undefined;
  gate.clientWaitFinish = false;
}

export function abandonInFlightFinish(gate: OnlineBreakGate): void {
  resetOnlineMiningGate(gate);
}

export function snapshotMiningGate(gate: OnlineBreakGate, extra?: {
  readonly miningTarget?: string;
  readonly buttonDown?: boolean;
  readonly targetKey?: string;
  readonly op?: string;
}): Record<string, string | number | boolean | undefined> {
  return {
    finish: gate.miningFinishKey,
    pending: gate.pendingBlockAction
      ? `${gate.pendingBlockAction.kind}:${gate.pendingBlockAction.x},${gate.pendingBlockAction.y},${gate.pendingBlockAction.z}`
      : undefined,
    rejected: gate.rejectedBlockKey,
    locked: Boolean(gate.miningLocked),
    clientWait: Boolean(gate.clientWaitFinish),
    waitTicks: gate.finishWaitTicks ?? 0,
    mine: extra?.miningTarget,
    button: extra?.buttonDown,
    look: extra?.targetKey,
    op: extra?.op,
  };
}

export function formatMiningLifecycle(
  phase: string,
  gate: OnlineBreakGate,
  extra?: {
    readonly miningTarget?: string;
    readonly buttonDown?: boolean;
    readonly targetKey?: string;
    readonly reason?: string;
    readonly progress?: number;
  },
): string {
  const snap = snapshotMiningGate(gate, extra);
  const parts = [
    `[MINING] ${phase}`,
    extra?.reason ? `because=${extra.reason}` : undefined,
    `look=${snap.look ?? '—'}`,
    `mine=${snap.mine ?? '—'}`,
    `finish=${snap.finish ?? '—'}`,
    `wait=${snap.clientWait ? 1 : 0}`,
    `locked=${snap.locked ? 1 : 0}`,
    `pending=${snap.pending ?? '—'}`,
    `rejected=${snap.rejected ?? '—'}`,
    `button=${snap.button === true ? 1 : snap.button === false ? 0 : '—'}`,
    extra?.progress !== undefined ? `progress=${extra.progress.toFixed(3)}` : undefined,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}

/**
 * Sequenced `action_result` is the only ack for `block_break_finish`.
 * Any finish ack — success, hard reject, `mining`, or missing coords — must
 * drop `miningFinishKey` / `clientWaitFinish` / `miningLocked`. Leaving those
 * set swallows every later pointerdown via `shouldWaitForInFlightFinish`.
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
    gate.miningFinishKey = undefined;
    gate.clientWaitFinish = false;
    gate.miningLocked = false;
    gate.finishWaitTicks = 0;
  }
  if (!hasCoords) {
    if (isFinish) gate.rejectedBlockKey = undefined;
    return;
  }
  const key = miningBlockKey(result.x!, result.y!, result.z!);
  if (result.ok) {
    if (gate.rejectedBlockKey === key) gate.rejectedBlockKey = undefined;
    return;
  }
  if (isInFlightBreakReject(result.reason)) return;
  if (!isFinish) {
    gate.miningLocked = false;
    return;
  }
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
    `wait=${gate.clientWaitFinish ? 1 : 0}`,
  ];
  if (extra?.miningTarget !== undefined) parts.push(`mine=${extra.miningTarget || '—'}`);
  if (extra?.blockId !== undefined) parts.push(`id=${extra.blockId}`);
  if (extra?.hold !== undefined) parts.push(`hold=${extra.hold}`);
  return parts.join(' ');
}
