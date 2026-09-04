import type { VoxelHit } from '../world/World';
import type {
  AttackAction,
  BlockBreakAbortAction,
  BlockBreakFinishAction,
  BlockBreakStartAction,
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
): BowReleaseAction {
  return {
    kind: 'bow_release',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    yaw: look.yaw,
    pitch: look.pitch,
  };
}

export function captureAttack(
  source: ActionSeqSource,
  look?: { readonly yaw: number; readonly pitch: number },
): AttackAction {
  return {
    kind: 'attack',
    actionSeq: nextActionSeq(source),
    commandSeq: source.inputSeq,
    selectedSlot: source.selectedSlot,
    ...(look ? { yaw: look.yaw, pitch: look.pitch } : {}),
  };
}
