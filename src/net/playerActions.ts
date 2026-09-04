import type {
  ClientActionContext,
  ClientBlockHitIntent,
  ClientBlockUseMessage,
  ClientBowReleaseMessage,
  ClientBreakAbortMessage,
  ClientBreakFinishMessage,
  ClientBreakStartMessage,
  ClientUseItemMessage,
} from '../../shared/protocol';
import type { VoxelHit } from '../world/World';

export interface ClientActionSequence {
  next: number;
}

export function createClientActionSequence(): ClientActionSequence {
  return { next: 0 };
}

export function resetClientActionSequence(sequence: ClientActionSequence): void {
  sequence.next = 0;
}

export function nextActionContext(
  sequence: ClientActionSequence,
  commandSeq: number,
  selectedSlot: number,
): ClientActionContext {
  sequence.next += 1;
  return { actionSeq: sequence.next, commandSeq, selectedSlot };
}

export function captureBlockHitIntent(hit: VoxelHit): ClientBlockHitIntent {
  return {
    targetX: hit.x,
    targetY: hit.y,
    targetZ: hit.z,
    targetBlockId: hit.block,
    faceX: hit.normal.x,
    faceY: hit.normal.y,
    faceZ: hit.normal.z,
    hitX: hit.point.x,
    hitY: hit.point.y,
    hitZ: hit.point.z,
  };
}

export function captureUseAction(
  context: ClientActionContext,
  hit: VoxelHit | undefined,
): ClientBlockUseMessage | ClientUseItemMessage {
  return hit
    ? { type: 'block_use', ...context, ...captureBlockHitIntent(hit) }
    : { type: 'use_item', ...context };
}

export function captureBreakStart(
  context: ClientActionContext,
  hit: VoxelHit,
): ClientBreakStartMessage {
  return { type: 'break_start', ...context, ...captureBlockHitIntent(hit) };
}

export function captureBreakAbort(context: ClientActionContext): ClientBreakAbortMessage {
  return { type: 'break_abort', ...context };
}

export function captureBreakFinish(
  context: ClientActionContext,
  hit: VoxelHit,
): ClientBreakFinishMessage {
  return { type: 'break_finish', ...context, ...captureBlockHitIntent(hit) };
}

export function captureBowRelease(
  context: ClientActionContext,
  yaw: number,
  pitch: number,
): ClientBowReleaseMessage {
  return { type: 'bow_release', ...context, yaw, pitch };
}
