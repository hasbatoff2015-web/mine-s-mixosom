export const MAX_CHAT_MESSAGES = 200;
export const CHAT_STICK_THRESHOLD_PX = 32;

export function isChatStuckToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = CHAT_STICK_THRESHOLD_PX,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - thresholdPx;
}

export function shouldAutoScrollChat(stuckToBottom: boolean): boolean {
  return stuckToBottom;
}

/** Keep the same distance from the bottom after messages are added or trimmed. */
export function restoreChatScrollTop(
  previousScrollHeight: number,
  previousScrollTop: number,
  nextScrollHeight: number,
): number {
  return Math.max(0, nextScrollHeight - (previousScrollHeight - previousScrollTop));
}
