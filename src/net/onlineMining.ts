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
  /**
   * True after `block_break_start` is sent until that start is acked.
   * Finish must not go out while this is set — server `miningProgress` is still 0.
   */
  miningStartUnacked?: boolean;
  /**
   * Server accepted START and rejected FINISH only because progress is still 0.
   * Do not treat `MAX_FINISH_WAIT_TICKS` as a stuck finish: catch-up can burn
   * those ticks before the next physics `advanceMining`. Wait for auto-break.
   */
  awaitingAutoBreak?: boolean;
}

export type BreakFinishHoldReason = 'ok' | 'pending' | 'rejected' | 'finish-inflight' | 'awaiting-start';

export const MAX_FINISH_WAIT_TICKS = 40;

export type OnlineMiningTickInput = {
  readonly buttonDown: boolean;
  readonly targetKey?: string;
  readonly miningTarget?: string;
  readonly finishKey?: string;
  readonly clientWaitFinish?: boolean;
  readonly miningLocked?: boolean;
  readonly finishWaitTicks?: number;
  readonly awaitingAutoBreak?: boolean;
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
  readonly awaitingAutoBreak?: boolean;
}): boolean {
  if (!input.miningReleased || !input.miningTarget) return false;
  if (input.awaitingAutoBreak) return true;
  return input.finishKey !== input.miningTarget;
}

/**
 * Keep `input.mining: true` on the wire for an in-flight mining action.
 * Protocol omits the field unless it is strictly `true`; one omitted packet
 * wipes `ServerPlayer.miningTarget` (`mine=—` → finish `reason: mining`).
 *
 * Hold while the player is pressing LMB, a finish is in flight, or start was
 * sent (`miningLocked`) and not yet aborted. Idle / pause / inventory must
 * clear those flags first so this does not turn every idle packet into mining.
 */
export function shouldHoldServerMining(input: {
  readonly buttonDown?: boolean;
  readonly finishKey?: string;
  readonly miningLocked?: boolean;
}): boolean {
  return Boolean(input.buttonDown) || Boolean(input.finishKey) || Boolean(input.miningLocked);
}

/** Protocol encodes mining only when true; omitted means server wipe/cancel. */
export function inputMiningField(hold: boolean): { readonly mining: true } | Record<string, never> {
  return hold ? { mining: true } : {};
}

/**
 * An input packet without `mining: true` while the client still has an active
 * mine is a client lifecycle bug, not a valid idle. Mouse-up / pause /
 * inventory / target-abandon must clear the hold flags, then omit mining.
 */
export function omittedMiningDuringHoldIsClientError(input: {
  readonly buttonDown?: boolean;
  readonly finishKey?: string;
  readonly miningLocked?: boolean;
}): boolean {
  return shouldHoldServerMining(input);
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
    gate.awaitingAutoBreak = false;
    gate.miningStartUnacked = false;
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
  const waitedTooLong = Boolean(
    finish
    && !input.awaitingAutoBreak
    && (input.finishWaitTicks ?? 0) >= MAX_FINISH_WAIT_TICKS,
  );
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
  gate.miningStartUnacked = false;
  gate.awaitingAutoBreak = false;
}

/**
 * `mining` means the server has no lock (start never landed, or input wiped it).
 * `in_progress` means the lock exists but no physics tick has advanced progress yet.
 * Only `mining` is a missing lock; `in_progress` must not reset the overlay.
 */
export function isInFlightBreakReject(reason: string | undefined): boolean {
  return reason === 'mining' || reason === 'in_progress';
}

/**
 * Server finish with a matching lock and `progress > 0` succeeds. `reason: mining`
 * therefore means there is no lock. Resending finish cannot recover; a new start can.
 * `in_progress` is the opposite: keep the in-flight finish and wait for auto-break.
 */
export function shouldResendBreakStartAfterFinishReject(reason: string | undefined): boolean {
  return reason === 'mining';
}

/** Premature finish while the server lock is real — stay at 100%, do not restart. */
export function shouldKeepFinishWait(reason: string | undefined): boolean {
  return reason === 'in_progress';
}

/**
 * After a `reason: mining` finish reject: drop the old finish wait, unlock
 * start, and require a new start ack before finish. Local overlay progress
 * must be reset by the caller so a leftover 1.0 does not immediately finish.
 */
export function noteResendBreakStart(gate: OnlineBreakGate): void {
  gate.pendingBlockAction = undefined;
  gate.miningFinishKey = undefined;
  gate.clientWaitFinish = false;
  gate.finishWaitTicks = 0;
  gate.miningLocked = false;
  gate.miningStartUnacked = true;
  gate.awaitingAutoBreak = false;
}

export function breakFinishHoldReason(
  gate: OnlineBreakGate,
  x: number,
  y: number,
  z: number,
): BreakFinishHoldReason {
  const key = miningBlockKey(x, y, z);
  if (gate.miningStartUnacked) return 'awaiting-start';
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
  gate.miningStartUnacked = true;
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
  readonly commandSeq?: number;
  readonly inputSeq?: number;
  readonly actionSeq?: number;
  readonly blockId?: number;
  readonly serverProgress?: number;
  readonly miningStartCommandSeq?: number;
  readonly appliedCommandSeq?: number;
  readonly queueDepth?: number;
  readonly inputMining?: boolean;
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
    startUnacked: Boolean(gate.miningStartUnacked),
    awaitingAutoBreak: Boolean(gate.awaitingAutoBreak),
    mine: extra?.miningTarget,
    button: extra?.buttonDown,
    look: extra?.targetKey,
    op: extra?.op,
    commandSeq: extra?.commandSeq,
    inputSeq: extra?.inputSeq,
    actionSeq: extra?.actionSeq,
    blockId: extra?.blockId,
    serverProgress: extra?.serverProgress,
    startCmd: extra?.miningStartCommandSeq,
    applied: extra?.appliedCommandSeq,
    queueDepth: extra?.queueDepth,
    inputMining: extra?.inputMining,
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
    readonly commandSeq?: number;
    readonly inputSeq?: number;
    readonly actionSeq?: number;
    readonly blockId?: number;
    readonly serverProgress?: number;
    readonly miningStartCommandSeq?: number;
    readonly appliedCommandSeq?: number;
    readonly queueDepth?: number;
    readonly inputMining?: boolean;
  },
): string {
  const snap = snapshotMiningGate(gate, extra);
  const parts = [
    `[MINING] ${phase}`,
    extra?.reason ? `because=${extra.reason}` : undefined,
    `look=${snap.look ?? '—'}`,
    `mine=${snap.mine ?? '—'}`,
    extra?.blockId !== undefined ? `id=${extra.blockId}` : undefined,
    `finish=${snap.finish ?? '—'}`,
    `wait=${snap.clientWait ? 1 : 0}`,
    `locked=${snap.locked ? 1 : 0}`,
    `pending=${snap.pending ?? '—'}`,
    `rejected=${snap.rejected ?? '—'}`,
    `button=${snap.button === true ? 1 : snap.button === false ? 0 : '—'}`,
    `startUnacked=${snap.startUnacked ? 1 : 0}`,
    snap.awaitingAutoBreak ? 'autoBreak=1' : undefined,
    extra?.progress !== undefined ? `clientProgress=${extra.progress.toFixed(3)}` : undefined,
    extra?.serverProgress !== undefined ? `serverProgress=${extra.serverProgress.toFixed(3)}` : undefined,
    extra?.commandSeq !== undefined ? `cmd=${extra.commandSeq}` : undefined,
    extra?.inputSeq !== undefined ? `inputSeq=${extra.inputSeq}` : undefined,
    extra?.actionSeq !== undefined ? `actionSeq=${extra.actionSeq}` : undefined,
    extra?.miningStartCommandSeq !== undefined ? `startCmd=${extra.miningStartCommandSeq}` : undefined,
    extra?.appliedCommandSeq !== undefined ? `applied=${extra.appliedCommandSeq}` : undefined,
    extra?.queueDepth !== undefined ? `queue=${extra.queueDepth}` : undefined,
    extra?.inputMining !== undefined ? `input.mining=${extra.inputMining ? 1 : 0}` : undefined,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}

/**
 * Sequenced `action_result` is the only ack for `block_break_finish`.
 * Success, hard reject, `mining`, or missing coords must drop finish wait.
 * `in_progress` is different: the server lock exists at progress 0, so keep
 * wait and let auto-break finish the first overlay.
 */
export function applyBreakActionResult(gate: OnlineBreakGate, result: {
  readonly ok: boolean;
  readonly reason?: string;
  readonly kind?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}): void {
  const isStart = result.kind === 'block_break_start';
  const isFinish = result.kind === 'block_break_finish';
  const hasCoords = result.x !== undefined && result.y !== undefined && result.z !== undefined;
  if (isStart) {
    gate.miningStartUnacked = false;
    if (!result.ok) gate.miningLocked = false;
  }
  if (isFinish && shouldKeepFinishWait(result.reason)) {
    gate.finishWaitTicks = 0;
    gate.awaitingAutoBreak = true;
    return;
  }
  if (isFinish) {
    const pending = gate.pendingBlockAction;
    if (!hasCoords || (pending && pending.x === result.x && pending.y === result.y && pending.z === result.z)) {
      gate.pendingBlockAction = undefined;
    }
    gate.miningFinishKey = undefined;
    gate.clientWaitFinish = false;
    gate.miningLocked = false;
    gate.finishWaitTicks = 0;
    gate.miningStartUnacked = false;
    gate.awaitingAutoBreak = false;
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
    gate.miningStartUnacked = false;
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
    `startAck=${gate.miningStartUnacked ? 0 : 1}`,
  ];
  if (extra?.miningTarget !== undefined) parts.push(`mine=${extra.miningTarget || '—'}`);
  if (extra?.blockId !== undefined) parts.push(`id=${extra.blockId}`);
  if (extra?.hold !== undefined) parts.push(`hold=${extra.hold}`);
  return parts.join(' ');
}
