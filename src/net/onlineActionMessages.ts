import type {
  ClientActionMessage,
  ClientBowReleaseMessage,
  ClientInteractMessage,
} from '../../shared/protocol';
import type {
  BlockBreakAbortAction,
  BlockBreakFinishAction,
  BlockBreakStartAction,
  BlockUseAction,
  BowReleaseAction,
} from '../../shared/playerActions';

export function interactMessageFromUse(action: BlockUseAction): ClientInteractMessage {
  return {
    type: 'interact',
    actionSeq: action.actionSeq,
    commandSeq: action.commandSeq,
    selectedSlot: action.selectedSlot,
    targetX: action.targetX,
    targetY: action.targetY,
    targetZ: action.targetZ,
    faceX: action.faceX,
    faceY: action.faceY,
    faceZ: action.faceZ,
    hitX: action.hitX,
    hitY: action.hitY,
    hitZ: action.hitZ,
  };
}

export function actionMessageFromBreakStart(action: BlockBreakStartAction): ClientActionMessage {
  return {
    type: 'action',
    kind: 'block_break_start',
    actionSeq: action.actionSeq,
    commandSeq: action.commandSeq,
    selectedSlot: action.selectedSlot,
    targetX: action.targetX,
    targetY: action.targetY,
    targetZ: action.targetZ,
    faceX: action.faceX,
    faceY: action.faceY,
    faceZ: action.faceZ,
    hitX: action.hitX,
    hitY: action.hitY,
    hitZ: action.hitZ,
  };
}

export function actionMessageFromBreakAbort(action: BlockBreakAbortAction): ClientActionMessage {
  return {
    type: 'action',
    kind: 'block_break_abort',
    actionSeq: action.actionSeq,
    commandSeq: action.commandSeq,
    selectedSlot: action.selectedSlot,
  };
}

export function actionMessageFromBreakFinish(action: BlockBreakFinishAction): ClientActionMessage {
  return {
    type: 'action',
    kind: 'block_break_finish',
    actionSeq: action.actionSeq,
    commandSeq: action.commandSeq,
    selectedSlot: action.selectedSlot,
    targetX: action.targetX,
    targetY: action.targetY,
    targetZ: action.targetZ,
    x: action.targetX,
    y: action.targetY,
    z: action.targetZ,
    faceX: action.faceX,
    faceY: action.faceY,
    faceZ: action.faceZ,
    hitX: action.hitX,
    hitY: action.hitY,
    hitZ: action.hitZ,
  };
}

export function bowReleaseMessage(action: BowReleaseAction): ClientBowReleaseMessage {
  return {
    type: 'bow_release',
    actionSeq: action.actionSeq,
    commandSeq: action.commandSeq,
    yaw: action.yaw,
    pitch: action.pitch,
    selectedSlot: action.selectedSlot,
  };
}
