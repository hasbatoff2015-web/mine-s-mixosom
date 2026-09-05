/** Client/server mining coordination for Anarchy block-break. */

export function miningBlockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

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
 * `mining` means the server is not done yet (client is typically one tick ahead).
 * It is not a protection deny and must not lock the block as rejected.
 */
export function isInFlightBreakReject(reason: string | undefined): boolean {
  return reason === 'mining';
}
