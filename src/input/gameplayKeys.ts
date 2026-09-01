import { BLOCKED_MOVE_INPUT, resolvePlayerMoveInput } from '../core/gameplayModal';
import type { MoveInput } from './MoveInput';

/**
 * Chat (and other text fields) may swallow WASD while focused.
 * After chat closes, a leftover focused INPUT must not keep capturing keys.
 */
export function shouldCaptureGameplayKey(options: {
  readonly typingInField: boolean;
  readonly chatOpen: boolean;
}): boolean {
  if (options.chatOpen && options.typingInField) return false;
  return true;
}

export function shouldBlurStaleTextField(options: {
  readonly typingInField: boolean;
  readonly chatOpen: boolean;
}): boolean {
  return options.typingInField && !options.chatOpen;
}

export function movementAfterChatClose(live: MoveInput, chatOpen: boolean): MoveInput {
  return resolvePlayerMoveInput(chatOpen, live);
}

export function idleMoveInput(): MoveInput {
  return BLOCKED_MOVE_INPUT;
}

export function stepVisualBowUseTicks(current: number, drawing: boolean): number {
  if (!drawing) return 0;
  return current + 1;
}
