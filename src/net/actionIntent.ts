import type { VoxelHit } from '../world/World';
import type {
  AttackAction,
  BlockBreakAbortAction,
  BlockBreakFinishAction,
  BlockBreakStartAction,
  BlockTargetIntent,
  BlockUseAction,
  BowReleaseAction,
} from '../../shared/playerActions';
import { snapUnitAxisFace } from '../../shared/playerCommand';

export const MAX_PENDING_ACTIONS = 32;

export interface ActionSeqSource {
  actionSeq: number;
  inputSeq: number;
  selectedSlot: number;
}

export type BowReleaseBoundaryMode = 'current-use-false' | 'next-after-use-true';

export interface BowReleaseWireState {
  readonly currentInputSeq: number;
  readonly lastSentInputSeq: number;
  readonly lastSentUse: boolean;
}

export interface BowReleaseCommandBoundary {
  readonly commandSeq: number;
  readonly mode: BowReleaseBoundaryMode;
}

export function nextActionSeq(source: ActionSeqSource): number {
  source.actionSeq += 1;
  return source.actionSeq;
}

export function faceFromHit(hit: VoxelHit): { x: number; y: number; z: number } {
  return snapUnitAxisFace(hit.normal.x, hit.normal.y, hit.normal.z) ?? { x: 0, y: 1, z: 0 };
}

export function blockTargetFromHit(hit: VoxelHit) {
  const face = faceFromHit(hit);
  return {
    targetX: hit.x,
    targetY: hit.y,
    targetZ: hit.z,
    targetBlockId: hit.block,
    faceX: face.x,
    faceY: face.y,
    faceZ: face.z,
    hitX: hit.point.x,
    hitY: hit.point.y,
    hitZ: hit.point.z,
  };
}

export function captureBlockUse(source: ActionSeqSource, hit: VoxelHit): BlockUseAction {
  return {
    kind: 'block_use',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    ...blockTargetFromHit(hit),
  };
}

export function captureBlockBreakStart(source: ActionSeqSource, hit: VoxelHit): BlockBreakStartAction {
  return {
    kind: 'block_break_start',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    ...blockTargetFromHit(hit),
  };
}

export function captureBlockBreakFinish(source: ActionSeqSource, hit: VoxelHit): BlockBreakFinishAction {
  return {
    kind: 'block_break_finish',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    ...blockTargetFromHit(hit),
  };
}

/**
 * Keep the voxel identity from `block_break_start` so finish cannot retarget a
 * neighbor, but never reuse the start `commandSeq`. Oak planks/log take 60
 * ticks; `ACTION_POSE_HISTORY_MAX` is 64. Spreading the start pose onto finish
 * makes `resolveActionEye` return `stale` once that seq falls out of history
 * (or was never the applied seq). Locked mining skips LOS; a wiped
 * `miningTarget` re-validates finish with that dead seq and rejects.
 */
export function composeOnlineBreakFinish(
  fresh: BlockBreakFinishAction,
  captured?: BlockTargetIntent & { readonly commandSeq?: number },
): BlockBreakFinishAction {
  if (!captured) return fresh;
  return {
    ...fresh,
    targetX: captured.targetX,
    targetY: captured.targetY,
    targetZ: captured.targetZ,
    targetBlockId: captured.targetBlockId,
    faceX: captured.faceX,
    faceY: captured.faceY,
    faceZ: captured.faceZ,
    hitX: captured.hitX,
    hitY: captured.hitY,
    hitZ: captured.hitZ,
  };
}

export function captureBlockBreakAbort(source: ActionSeqSource): BlockBreakAbortAction {
  return {
    kind: 'block_break_abort',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
  };
}

export function captureBowRelease(
  source: ActionSeqSource,
  look: { readonly yaw: number; readonly pitch: number },
  renderTick?: number,
  boundaryCommandSeq = source.inputSeq,
): BowReleaseAction {
  return {
    kind: 'bow_release',
    actionSeq: nextActionSeq(source),
    commandSeq: boundaryCommandSeq,
    selectedSlot: source.selectedSlot,
    yaw: look.yaw,
    pitch: look.pitch,
    ...(renderTick !== undefined ? { renderTick } : {}),
  };
}

/**
 * Resolves the first wire command whose `use=false` represents this render-frame release.
 * This never increments the input sequence or delays captured release aim.
 */
export function resolveBowReleaseCommandSeq(state: BowReleaseWireState): BowReleaseCommandBoundary {
  if (state.lastSentInputSeq === state.currentInputSeq && !state.lastSentUse) {
    return { commandSeq: state.currentInputSeq, mode: 'current-use-false' };
  }
  return { commandSeq: state.currentInputSeq + 1, mode: 'next-after-use-true' };
}

/** Selects an already-rendered remote timeline without sampling any interpolation buffer. */
export function selectBowRenderTick(
  directRenderTick: number | undefined,
  activeRenderTicks: readonly number[],
): number | undefined {
  if (directRenderTick !== undefined && Number.isFinite(directRenderTick)) return directRenderTick;
  const sorted = activeRenderTicks.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1]! + sorted[middle]!) * 0.5;
}

export function captureAttack(
  source: ActionSeqSource,
  look?: { readonly yaw: number; readonly pitch: number },
  target?: { readonly id: string; readonly renderTick: number },
): AttackAction {
  return {
    kind: 'attack',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    ...(look ? { yaw: look.yaw, pitch: look.pitch } : {}),
    ...(target ? { targetId: target.id, targetRenderTick: target.renderTick } : {}),
  };
}
