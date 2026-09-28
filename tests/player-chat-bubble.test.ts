import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_MESSAGE_TYPES } from '../shared/protocol';
import { ChatLog, CHAT_FADE_MS, CHAT_VISIBLE_MS } from '../src/chat';
import { friendJoinChatText } from '../shared/friends';
import {
  PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS,
  PLAYER_CHAT_BUBBLE_VISIBLE_MS,
  PlayerChatBubbleState,
  presentRemoteChatBubble,
  wrapPlayerChatBubbleText,
} from '../src/rendering/player/playerChatBubbleLayout';

const GAME = readFileSync('src/core/Game.ts', 'utf8');
const PROTOCOL = readFileSync('shared/protocol.ts', 'utf8');
const WORLD = readFileSync('server/WorldInstance.ts', 'utf8');
const STYLE = readFileSync('src/style.css', 'utf8');

function nonSpace(text: string): string {
  return text.replace(/ /g, '');
}

describe('player chat bubble text and lifetime', () => {
  it('stays visible for five seconds and hides at the deadline', () => {
    const bubble = new PlayerChatBubbleState();
    bubble.show('привет', 1_000);
    expect(PLAYER_CHAT_BUBBLE_VISIBLE_MS).toBe(5_000);
    expect(bubble.visibleAt(1_000)).toBe(true);
    expect(bubble.visibleAt(5_999)).toBe(true);
    expect(bubble.visibleAt(6_000)).toBe(false);
    expect(bubble.text).toBe('привет');
    expect(bubble.lines).toEqual(['привет']);
  });

  it('replaces the previous line and restarts the five second timer', () => {
    const bubble = new PlayerChatBubbleState();
    bubble.show('one', 1_000);
    bubble.show('two', 4_000);
    expect(bubble.text).toBe('two');
    expect(bubble.lines).toEqual(['two']);
    expect(bubble.visibleAt(5_999)).toBe(true);
    expect(bubble.visibleAt(8_999)).toBe(true);
    expect(bubble.visibleAt(9_000)).toBe(false);
  });

  it('wraps on spaces, hard-wraps a 128 character token, and keeps every character', () => {
    expect(wrapPlayerChatBubbleText('привет')).toEqual(['привет']);
    const sentence = 'привет всем друзьям на этом сервере анархии сегодня';
    const wrapped = wrapPlayerChatBubbleText(sentence);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.every((line) => line.length <= PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS)).toBe(true);
    expect(nonSpace(wrapped.join(''))).toBe(nonSpace(sentence));
    expect(wrapped.join(' ')).not.toContain('Ada:');
    expect(wrapped.join(' ')).not.toContain('Misha');

    const token = 'я'.repeat(128);
    const hard = wrapPlayerChatBubbleText(token);
    expect(hard.join('')).toBe(token);
    expect(hard.every((line) => line.length <= PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS)).toBe(true);
    expect(hard.length).toBe(Math.ceil(128 / PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS));
    expect(hard.length).toBeLessThanOrEqual(5);
  });

  it('fails closed on empty text', () => {
    const bubble = new PlayerChatBubbleState();
    bubble.show('   ', 1_000);
    expect(bubble.visibleAt(1_000)).toBe(false);
    expect(bubble.lines).toEqual([]);
    expect(wrapPlayerChatBubbleText('')).toEqual([]);
  });
});

describe('server chat routes to a remote bubble without a new packet', () => {
  it('shows a bubble only for a delivered player chat aimed at a known remote', () => {
    const calls: Array<{ text: string; now: number | undefined }> = [];
    const remotes = new Map<string, { showChatBubble(text: string, now?: number): void }>([
      ['bob', { showChatBubble: (text, now) => calls.push({ text, now }) }],
    ]);
    presentRemoteChatBubble(remotes, {
      kind: 'player', playerId: 'bob', text: 'hello',
    }, 50);
    expect(calls).toEqual([{ text: 'hello', now: 50 }]);

    for (const kind of ['system', 'command', 'error'] as const) {
      presentRemoteChatBubble(remotes, { kind, playerId: 'bob', text: 'nope' }, 60);
    }
    presentRemoteChatBubble(remotes, { kind: 'player', playerId: 'missing', text: 'hello' }, 70);
    presentRemoteChatBubble(remotes, { kind: 'player', playerId: 'ada', text: 'self' }, 80);
    expect(calls).toEqual([{ text: 'hello', now: 50 }]);
    expect(() => presentRemoteChatBubble(undefined, { kind: 'player', playerId: 'bob', text: 'hello' }, 90)).not.toThrow();
  });

  it('keeps speech on the existing chat message and out of the protocol type list', () => {
    for (const forbidden of ['chat_bubble', 'speech_bubble', 'player_speech']) {
      expect(SERVER_MESSAGE_TYPES).not.toContain(forbidden);
      expect(PROTOCOL).not.toContain(`'${forbidden}'`);
      expect(WORLD).not.toContain(forbidden);
    }
    expect(GAME).toContain('presentRemoteChatBubble(session.online.remotes, message, performance.now())');
    expect(GAME).toContain('remote.updateNameplate(this.camera, now)');
    expect(STYLE).toContain('.chat-line.kind-system { color: #c8c8c8; }');
  });

  it('accepts a friend-join line as an ordinary system chat row', () => {
    const log = new ChatLog();
    const text = friendJoinChatText('Bob');
    const entry = log.push('system', text, 1_000, { id: 'friend-join' });
    expect(entry).toMatchObject({ kind: 'system', text });
    expect(entry.style).toBeUndefined();
    expect(log.visible(1_000 + CHAT_VISIBLE_MS, false).map((message) => message.text)).toContain(text);
    expect(log.visible(1_000 + CHAT_VISIBLE_MS + CHAT_FADE_MS, false)).toHaveLength(0);
  });
});
