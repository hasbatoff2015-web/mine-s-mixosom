import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_CHAT_LENGTH } from '../shared/config';
import {
  CHAT_NO_CLAN_HINT,
  CHAT_TAB_HISTORY_LIMIT,
  CHAT_TOO_LONG_ERROR,
  formatPlayerChatLine,
  isWithinNearbyChatRange,
  NEARBY_CHAT_RADIUS,
} from '../shared/chat';
import { parseClientMessage } from '../shared/protocol';
import {
  ChatLog,
  canSendChatOnTab,
  defaultChatTabOnOpen,
  outgoingChatText,
  shouldShowClanEmptyHint,
  tabHistory,
} from '../src/chat';

const root = dirname(fileURLToPath(import.meta.url));
const GAME_UI = readFileSync(join(root, '../src/ui/GameUI.ts'), 'utf8');
const GAME = readFileSync(join(root, '../src/core/Game.ts'), 'utf8');
const INPUT = readFileSync(join(root, '../src/input/InputManager.ts'), 'utf8');
const WORLD = readFileSync(join(root, '../server/WorldInstance.ts'), 'utf8');

describe('chat channel helpers', () => {
  it('uses inclusive 3D nearby range of 20 blocks', () => {
    expect(NEARBY_CHAT_RADIUS).toBe(20);
    expect(isWithinNearbyChatRange(0, 70, 0, 20, 70, 0)).toBe(true);
    expect(isWithinNearbyChatRange(0, 70, 0, 20.0001, 70, 0)).toBe(false);
    expect(isWithinNearbyChatRange(0, 70, 0, 21, 70, 0)).toBe(false);
    expect(isWithinNearbyChatRange(0, 70, 0, 0, 90, 0)).toBe(true);
    expect(isWithinNearbyChatRange(0, 70, 0, 0, 91, 0)).toBe(false);
    expect(isWithinNearbyChatRange(0, 0, 0, 10, 10, 10)).toBe(true);
    expect(isWithinNearbyChatRange(0, 0, 0, 12, 12, 12)).toBe(false);
  });

  it('formats player lines without angle brackets', () => {
    expect(formatPlayerChatLine('Ada', 'привет')).toBe('Ada: привет');
    expect(MAX_CHAT_LENGTH).toBe(128);
    expect(outgoingChatText('')).toEqual({ kind: 'empty' });
    expect(outgoingChatText('   ')).toEqual({ kind: 'empty' });
    expect(outgoingChatText('a'.repeat(128))).toEqual({ kind: 'ok', text: 'a'.repeat(128) });
    expect(outgoingChatText('a'.repeat(129))).toEqual({ kind: 'too-long' });
    expect(CHAT_TOO_LONG_ERROR).toContain('128');
  });

  it('disables clan send without membership and shows the empty hint', () => {
    expect(defaultChatTabOnOpen()).toBe('global');
    expect(canSendChatOnTab('global', false)).toBe(true);
    expect(canSendChatOnTab('nearby', false)).toBe(true);
    expect(canSendChatOnTab('clan', false)).toBe(false);
    expect(canSendChatOnTab('clan', true)).toBe(true);
    expect(shouldShowClanEmptyHint('clan', false)).toBe(true);
    expect(shouldShowClanEmptyHint('clan', true)).toBe(false);
    expect(shouldShowClanEmptyHint('global', false)).toBe(false);
    expect(CHAT_NO_CLAN_HINT).toBe('Вы не состоите в клане.');
  });
});

describe('chat protocol intent', () => {
  it('accepts channel intent and strips forged sender/recipients/clan fields', () => {
    expect(parseClientMessage({ type: 'chat', text: 'hello anarchy' })).toEqual({
      type: 'chat',
      text: 'hello anarchy',
      channel: 'global',
    });
    expect(parseClientMessage({
      type: 'chat',
      text: 'hi',
      channel: 'nearby',
      from: 'Admin',
      playerId: 'forged',
      recipients: ['a', 'b'],
      clanId: 'abc',
      x: 1,
      y: 2,
      z: 3,
    })).toEqual({ type: 'chat', text: 'hi', channel: 'nearby' });
    expect(parseClientMessage({ type: 'chat', text: 'hi', channel: 'not-a-channel' }))
      .toEqual({ error: 'chat.channel invalid' });
    expect(parseClientMessage({ type: 'chat', text: 'a'.repeat(128), channel: 'clan' })).toMatchObject({
      type: 'chat',
      channel: 'clan',
    });
    expect(parseClientMessage({ type: 'chat', text: 'a'.repeat(129) })).toEqual({ error: 'chat.text too long' });
    expect(parseClientMessage({ type: 'chat', text: '   ' })).toEqual({ error: 'chat.text empty' });
  });
});

describe('ChatLog tab history', () => {
  it('keeps one copy per message id and last 40 per tab', () => {
    const log = new ChatLog();
    log.push('player', 'g', 1, { channel: 'global', from: 'Ada', id: 'm-global' });
    log.push('player', 'n', 2, { channel: 'nearby', from: 'Ada', id: 'm-near' });
    log.push('player', 'c', 3, { channel: 'clan', from: 'Ada', id: 'm-clan' });
    log.push('player', 'n', 4, { channel: 'nearby', from: 'Ada', id: 'm-near' });
    expect(log.entries.filter((entry) => entry.id === 'm-near')).toHaveLength(1);
    expect(log.forTab('global').map((entry) => entry.channel)).toEqual(['global', 'nearby', 'clan']);
    expect(log.forTab('nearby').map((entry) => entry.id)).toEqual(['m-near']);
    expect(log.forTab('clan').map((entry) => entry.id)).toEqual(['m-clan']);

    for (let i = 0; i < CHAT_TAB_HISTORY_LIMIT + 5; i += 1) {
      log.push('player', `n${i}`, i + 10, { channel: 'nearby', from: 'Ada', id: `near-${i}` });
    }
    const nearby = log.forTab('nearby');
    expect(nearby).toHaveLength(CHAT_TAB_HISTORY_LIMIT);
    expect(nearby[0]?.text).toBe('n5');
    expect(tabHistory(log.entries, 'nearby')).toHaveLength(CHAT_TAB_HISTORY_LIMIT);
  });
});

describe('chat UI source contracts', () => {
  it('opens on T with General selected, keeps chat open after Enter, and closes on Tab/X', () => {
    expect(INPUT).toContain('event.code === \'KeyT\'');
    expect(GAME_UI).toContain('selectChatTab(\'global\')');
    expect(GAME_UI).toContain('data-chat-tab="global"');
    expect(GAME_UI).toContain('data-chat-tab="nearby"');
    expect(GAME_UI).toContain('data-chat-tab="clan"');
    expect(GAME_UI).toContain('id="chat-send"');
    expect(GAME_UI).toContain('id="chat-close"');
    expect(GAME_UI).toContain('id="chat-visibility"');
    expect(GAME_UI).toContain(`maxlength="\${MAX_CHAT_LENGTH}"`);
    expect(GAME_UI).toContain('event.key === \'Tab\'');
    expect(GAME_UI).toContain('this.onChatCancel?.()');
    expect(GAME_UI).toContain('toggleChatDisplay');
    expect(GAME_UI).toContain('channel-nearby');
    expect(GAME_UI).toContain('channel-clan');
    expect(GAME_UI).toContain('display-off');
    expect(GAME).toContain('channel');
    expect(GAME).toContain('this.ui.clearChatDraft()');
    expect(GAME).not.toContain('this.closeChatAndResumeLook();\n      return;\n    }\n    const dispatched');
    expect(WORLD).toContain('this.clan.playerClan');
    expect(WORLD).not.toContain('chatMembers');
    expect(WORLD).not.toContain('clanMembershipCache');
  });
});
