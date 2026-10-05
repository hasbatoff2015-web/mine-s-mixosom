import { describe, expect, it } from 'vitest';
import { CHAT_CHANNELS, CHAT_TOO_LONG_ERROR } from '../shared/chat';
import { MAX_CHAT_LENGTH, PROTOCOL_VERSION } from '../shared/config';
import {
  DIRECT_MESSAGE_EMPTY_ERROR,
  chatScrollPinnedToBottom,
  chatScrollTopAfterPrepend,
  chatShouldRequestOlder,
  conversationKey,
  formatDirectMessageClock,
  friendsMenuBadgeCount,
  mergeDirectMessagePage,
  normalizeDirectMessageText,
  participantsFromKey,
  planDirectMessageScroll,
} from '../shared/directMessages';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';

describe('direct message helpers', () => {
  it('uses one canonical player-id key in either direction', () => {
    expect(conversationKey('ada', 'bob')).toBe(conversationKey('bob', 'ada'));
    expect(conversationKey('bob', 'ada')).not.toBe(conversationKey('ada', 'cara'));
    const key = conversationKey('Игрок', 'bob');
    expect(participantsFromKey(key)).toEqual(['bob', 'Игрок'].sort());
    expect(conversationKey('ada', 'bob')).not.toContain('Ada');
  });

  it('normalizes a single line and keeps slash text', () => {
    expect(normalizeDirectMessageText('  /home  \n')).toEqual({ ok: true, text: '  /home' });
    expect(normalizeDirectMessageText('a\u0000b\r\nc')).toEqual({ ok: true, text: 'abc' });
    expect(normalizeDirectMessageText('   \n')).toEqual({ ok: false, error: DIRECT_MESSAGE_EMPTY_ERROR });
    expect(normalizeDirectMessageText('я'.repeat(MAX_CHAT_LENGTH)).ok).toBe(true);
    expect(normalizeDirectMessageText('я'.repeat(MAX_CHAT_LENGTH + 1))).toEqual({
      ok: false,
      error: CHAT_TOO_LONG_ERROR,
    });
  });

  it('adds friend notifications and DM unread without mixing them into one store', () => {
    expect(friendsMenuBadgeCount(1, 5)).toBe(6);
    expect(friendsMenuBadgeCount(0, 2)).toBe(2);
    expect(friendsMenuBadgeCount(-3, Number.NaN)).toBe(0);
  });

  it('formats the server timestamp as local HH:mm', () => {
    const createdAt = Date.UTC(2026, 0, 2, 15, 4);
    const date = new Date(createdAt);
    const expected = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    expect(formatDirectMessageClock(createdAt)).toBe(expected);
  });

  it('plans scroll so prepend keeps the viewport and duplicates are ignored', () => {
    expect(chatScrollPinnedToBottom(0, 100, 100)).toBe(true);
    expect(chatScrollPinnedToBottom(70, 200, 100)).toBe(false);
    expect(chatScrollPinnedToBottom(80, 200, 100)).toBe(true);
    expect(chatShouldRequestOlder(8)).toBe(true);
    expect(chatShouldRequestOlder(9)).toBe(false);
    expect(chatScrollTopAfterPrepend(12, 80, 140)).toBe(72);
    expect(planDirectMessageScroll({
      reason: 'replace',
      pinnedToBottom: false,
      scrollTop: 4,
      scrollHeight: 40,
      nextScrollHeight: 90,
    })).toBe(90);
    expect(planDirectMessageScroll({
      reason: 'append',
      pinnedToBottom: true,
      scrollTop: 40,
      scrollHeight: 80,
      nextScrollHeight: 110,
    })).toBe(110);
    expect(planDirectMessageScroll({
      reason: 'append',
      pinnedToBottom: false,
      scrollTop: 10,
      scrollHeight: 200,
      nextScrollHeight: 240,
    })).toBe(10);
    expect(planDirectMessageScroll({
      reason: 'prepend',
      pinnedToBottom: false,
      scrollTop: 12,
      scrollHeight: 80,
      nextScrollHeight: 140,
    })).toBe(72);
    expect(planDirectMessageScroll({
      reason: 'restore',
      pinnedToBottom: false,
      scrollTop: 15,
      scrollHeight: 80,
      nextScrollHeight: 80,
    })).toBe(15);

    const first = { messageId: 'a', seq: 2, text: 'new' };
    const older = { messageId: 'b', seq: 1, text: 'old' };
    const merged = mergeDirectMessagePage([first], [older, first], 'prepend');
    expect(merged.map((message) => message.messageId)).toEqual(['b', 'a']);
    expect(mergeDirectMessagePage([first], [first], 'append')).toHaveLength(1);
  });

  it('parses DM actions without trusting a client sender and leaves protocol v4', () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(CHAT_CHANNELS).toEqual(['global', 'nearby', 'clan']);
    const parsed = parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: '/home',
      senderId: 'forged',
      senderName: 'Eve',
      createdAt: 1,
    });
    expect(parsed).toEqual({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: '/home',
    });
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: 'я'.repeat(129),
    })).toMatchObject({ action: 'send', text: 'я'.repeat(129) });
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: 'я'.repeat(513),
    })).toEqual({ error: 'direct_message_action.text too long' });
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'history',
      friendId: 'bob',
      beforeSeq: 21,
    })).toEqual({
      type: 'direct_message_action',
      action: 'history',
      friendId: 'bob',
      beforeSeq: 21,
    });
    expect(parseClientMessage({
      type: 'menu_action',
      action: 'friends_chat',
      playerId: 'bob',
    })).toMatchObject({ action: 'friends_chat', playerId: 'bob' });
    expect(parseClientMessage({
      type: 'menu_action',
      action: 'open',
      screen: 'friend-chat',
    })).toMatchObject({ action: 'open', screen: 'friend-chat' });

    const hostile = '<img src=x onerror=alert(1)>';
    const server = parseServerMessage({
      type: 'direct_message',
      event: 'append',
      friendId: 'bob',
      messages: [{
        messageId: 'm',
        seq: 1,
        senderId: 'ada',
        recipientId: 'bob',
        text: hostile,
        createdAt: 50,
      }],
    });
    expect(server).toMatchObject({
      type: 'direct_message',
      event: 'append',
      messages: [{ text: hostile }],
    });
    expect(parseServerMessage({
      type: 'direct_message',
      event: 'history',
      friendId: 'bob',
      messages: Array.from({ length: 51 }, (_, index) => ({
        messageId: `m${index}`,
        seq: index + 1,
        senderId: 'ada',
        recipientId: 'bob',
        text: 'x',
        createdAt: index,
      })),
    })).toEqual({ error: 'direct_message.messages invalid' });
  });
});
