import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_MESSAGES,
  ChatLog,
  isChatStuckToBottom,
  restoreChatScrollTop,
  shouldAutoScrollChat,
} from '../../src/chat';

describe('chat history cap and scroll helpers', () => {
  it('keeps at most MAX_CHAT_MESSAGES entries', () => {
    expect(CHAT_MAX_MESSAGES).toBe(200);
    const log = new ChatLog();
    for (let i = 0; i < 205; i += 1) log.push('system', `m${i}`, i);
    expect(log.entries).toHaveLength(200);
    expect(log.entries[0]?.text).toBe('m5');
  });

  it('auto-scrolls only while stuck to the bottom', () => {
    expect(isChatStuckToBottom(80, 120, 40)).toBe(true);
    expect(isChatStuckToBottom(0, 400, 40)).toBe(false);
    expect(shouldAutoScrollChat(true)).toBe(true);
    expect(shouldAutoScrollChat(false)).toBe(false);
    expect(restoreChatScrollTop(200, 40, 240)).toBe(80);
  });
});
