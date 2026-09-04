import { exactUnitAxisFace } from './playerCommand';

export const ACTION_HISTORY_MAX = 64;

export type PlayerActionKind =
  | 'block_use'
  | 'block_break_start'
  | 'block_break_abort'
  | 'block_break_finish'
  | 'bow_release'
  | 'attack';

export interface BlockTargetIntent {
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  /** Block id observed at capture. Server rejects if the cell changed. */
  readonly targetBlockId: number;
  readonly faceX: number;
  readonly faceY: number;
  readonly faceZ: number;
  readonly hitX: number;
  readonly hitY: number;
  readonly hitZ: number;
}

export interface SequencedAction {
  readonly actionSeq: number;
  readonly commandSeq: number;
  readonly selectedSlot: number;
}

export interface BlockUseAction extends SequencedAction, BlockTargetIntent {
  readonly kind: 'block_use';
}

export interface BlockBreakStartAction extends SequencedAction, BlockTargetIntent {
  readonly kind: 'block_break_start';
}

export interface BlockBreakAbortAction extends SequencedAction {
  readonly kind: 'block_break_abort';
}

export interface BlockBreakFinishAction extends SequencedAction, BlockTargetIntent {
  readonly kind: 'block_break_finish';
}

export interface BowReleaseAction extends SequencedAction {
  readonly kind: 'bow_release';
  readonly yaw: number;
  readonly pitch: number;
}

export interface AttackAction extends SequencedAction {
  readonly kind: 'attack';
  readonly yaw?: number;
  readonly pitch?: number;
}

export type PlayerAction =
  | BlockUseAction
  | BlockBreakStartAction
  | BlockBreakAbortAction
  | BlockBreakFinishAction
  | BowReleaseAction
  | AttackAction;

export type ActionRejectReason =
  | 'dead'
  | 'disconnected'
  | 'duplicate'
  | 'stale'
  | 'bounds'
  | 'face'
  | 'hit'
  | 'empty'
  | 'occupied'
  | 'incompatible'
  | 'reach'
  | 'los'
  | 'slot'
  | 'item'
  | 'inventory'
  | 'gamemode'
  | 'no-draw'
  | 'charge'
  | 'ammo'
  | 'cancelled'
  | 'unbreakable'
  | 'mining'
  | 'collision'
  | 'no-anchor'
  | 'look'
  | 'invalid';

export interface ActionResult {
  readonly ok: boolean;
  readonly actionSeq: number;
  readonly kind: PlayerActionKind | 'break' | 'place';
  readonly reason?: ActionRejectReason | string;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly yaw?: number;
  readonly pitch?: number;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function hasTargetCoordinates(raw: {
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}): boolean {
  return (raw.targetX ?? raw.x) !== undefined
    || (raw.targetY ?? raw.y) !== undefined
    || (raw.targetZ ?? raw.z) !== undefined;
}

/** True when the client sent captured-intent fields (not place/break destination xyz). */
export function hasCapturedBlockIntent(raw: {
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly targetBlockId?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly hitX?: number;
  readonly hitY?: number;
  readonly hitZ?: number;
}): boolean {
  return raw.targetX !== undefined
    || raw.targetY !== undefined
    || raw.targetZ !== undefined
    || raw.targetBlockId !== undefined
    || raw.faceX !== undefined
    || raw.faceY !== undefined
    || raw.faceZ !== undefined
    || raw.hitX !== undefined
    || raw.hitY !== undefined
    || raw.hitZ !== undefined;
}

export function parseBlockTarget(raw: Record<string, unknown>): BlockTargetIntent | { error: string } {
  if (!Number.isInteger(raw.targetX) || !Number.isInteger(raw.targetY) || !Number.isInteger(raw.targetZ)) {
    return { error: 'target coordinates must be integers' };
  }
  if (!isFiniteNumber(raw.targetX) || !isFiniteNumber(raw.targetY) || !isFiniteNumber(raw.targetZ)) {
    return { error: 'target coordinates invalid' };
  }
  if (!Number.isInteger(raw.targetBlockId) || !isFiniteNumber(raw.targetBlockId) || raw.targetBlockId < 0) {
    return { error: 'targetBlockId invalid' };
  }
  if (!isFiniteNumber(raw.faceX) || !isFiniteNumber(raw.faceY) || !isFiniteNumber(raw.faceZ)) {
    return { error: 'face invalid' };
  }
  const face = exactUnitAxisFace(raw.faceX, raw.faceY, raw.faceZ);
  if (!face) return { error: 'face must be a unit axis' };
  if (!isFiniteNumber(raw.hitX) || !isFiniteNumber(raw.hitY) || !isFiniteNumber(raw.hitZ)) {
    return { error: 'hit point invalid' };
  }
  return {
    targetX: raw.targetX,
    targetY: raw.targetY,
    targetZ: raw.targetZ,
    targetBlockId: raw.targetBlockId,
    faceX: face.x,
    faceY: face.y,
    faceZ: face.z,
    hitX: raw.hitX,
    hitY: raw.hitY,
    hitZ: raw.hitZ,
  };
}

export function blockIntentFromFields(raw: {
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly targetBlockId?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly hitX?: number;
  readonly hitY?: number;
  readonly hitZ?: number;
}): BlockTargetIntent | undefined {
  const targetX = raw.targetX ?? raw.x;
  const targetY = raw.targetY ?? raw.y;
  const targetZ = raw.targetZ ?? raw.z;
  if (targetX === undefined || targetY === undefined || targetZ === undefined) return undefined;
  if (raw.targetBlockId === undefined) return undefined;
  if (raw.faceX === undefined || raw.faceY === undefined || raw.faceZ === undefined) return undefined;
  if (raw.hitX === undefined || raw.hitY === undefined || raw.hitZ === undefined) return undefined;
  const parsed = parseBlockTarget({
    targetX,
    targetY,
    targetZ,
    targetBlockId: raw.targetBlockId,
    faceX: raw.faceX,
    faceY: raw.faceY,
    faceZ: raw.faceZ,
    hitX: raw.hitX,
    hitY: raw.hitY,
    hitZ: raw.hitZ,
  });
  if ('error' in parsed) return undefined;
  return parsed;
}

export function angularError(aYaw: number, aPitch: number, bYaw: number, bPitch: number): number {
  const dx = Math.cos(aPitch) * Math.sin(aYaw) - Math.cos(bPitch) * Math.sin(bYaw);
  const dy = Math.sin(aPitch) - Math.sin(bPitch);
  const dz = Math.cos(aPitch) * Math.cos(aYaw) - Math.cos(bPitch) * Math.cos(bYaw);
  const dot = Math.max(-1, Math.min(1, 1 - 0.5 * (dx * dx + dy * dy + dz * dz)));
  return Math.acos(dot);
}
