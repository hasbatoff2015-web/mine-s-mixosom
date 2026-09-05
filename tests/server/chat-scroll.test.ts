import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_MESSAGES,
  ChatLog,
  chatScrollTopOnOpen,
  isChatStuckToBottom,
  restoreChatScrollTop,
  shouldAutoScrollChat,
} from '../../src/chat';
import { shouldBlurStaleTextField } from '../../src/input/gameplayKeys';

const GAME_UI = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/GameUI.ts'),
  'utf8',
);

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

  it('pins scroll to the latest messages when chat opens', () => {
    expect(chatScrollTopOnOpen(480)).toBe(480);
    expect(chatScrollTopOnOpen(0)).toBe(0);
    expect(GAME_UI).toContain('this.revealChatLines()');
    expect(GAME_UI).toContain('this.scheduleScrollChatToBottom(token)');
    expect(GAME_UI).toContain('queueMicrotask(run)');
    expect(GAME_UI).toContain('requestAnimationFrame');
    expect(GAME_UI).not.toContain('if (this.chatPinnedToBottom) this.scrollChatToBottom()');
  });
});
