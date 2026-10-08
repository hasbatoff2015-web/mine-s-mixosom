import { describe, expect, it } from 'vitest';
import { CHAT_CHANNELS, CHAT_TOO_LONG_ERROR } from '../shared/chat';
import { MAX_CHAT_LENGTH, PROTOCOL_VERSION } from '../shared/config';
import {
  DIRECT_MESSAGE_EMPTY_ERROR,
  chatScrollPinnedToBottom,
  chatScrollTopAfterPrepend,
  chatShouldRequestOlder,
  conversationKey,
  createFriendChatComposerLedger,
  directMessageTargetsOpenChat,
  formatDirectMessageClock,
  friendChatDraftRevision,
  friendChatSendAlreadyPending,
  friendsMenuBadgeCount,
  mergeDirectMessagePage,
  normalizeDirectMessageText,
  noteFriendChatDraft,
  participantsFromKey,
  planDirectMessageScroll,
  settleFriendChatSend,
  trackFriendChatSend,
  type FriendChatComposerLedger,
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
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: 'Привет',
      clientRequestId: 'req-1',
    })).toMatchObject({ clientRequestId: 'req-1', text: 'Привет' });
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: 'Привет',
      clientRequestId: 'x'.repeat(65),
    })).toEqual({ error: 'direct_message_action.clientRequestId invalid' });
    expect(parseClientMessage({
      type: 'direct_message_action',
      action: 'send',
      friendId: 'bob',
      text: 'Привет',
      clientRequestId: 12,
    })).toEqual({ error: 'direct_message_action.clientRequestId invalid' });
    expect(parseServerMessage({
      type: 'direct_message',
      event: 'append',
      friendId: 'bob',
      clientRequestId: 'req-1',
      messages: [{
        messageId: 'm',
        seq: 1,
        senderId: 'ada',
        recipientId: 'bob',
        text: 'Привет',
        createdAt: 50,
      }],
    })).toMatchObject({ clientRequestId: 'req-1', event: 'append' });
    expect(parseServerMessage({
      type: 'direct_message',
      event: 'append',
      friendId: 'bob',
      messages: [{
        messageId: 'm',
        seq: 1,
        senderId: 'ada',
        recipientId: 'bob',
        text: 'Привет',
        createdAt: 50,
      }],
    })).toMatchObject({ event: 'append' });
    expect(parseServerMessage({
      type: 'direct_message',
      event: 'error',
      friendId: 'bob',
      error: 'нет',
      clientRequestId: 'y'.repeat(65),
    })).toEqual({ error: 'direct_message.clientRequestId invalid' });
  });
});

describe('friend chat send correlation', () => {
  function send(ledger: FriendChatComposerLedger, friendId: string, clientRequestId: string): void {
    expect(friendChatSendAlreadyPending(ledger, friendId)).toBe(false);
    trackFriendChatSend(ledger, friendId, clientRequestId);
  }

  it('clears an unchanged draft on success, including after server whitespace normalization', () => {
    const ledger = createFriendChatComposerLedger();
    noteFriendChatDraft(ledger, 'bob', 'Привет');
    send(ledger, 'bob', 'A');
    expect(settleFriendChatSend(ledger, 'A', 'bob', 'accepted')).toEqual({
      kind: 'accepted',
      friendId: 'bob',
      clearDraft: true,
    });
    expect(ledger.drafts.has('bob')).toBe(false);
    expect(ledger.pending.has('A')).toBe(false);

    const spaced = createFriendChatComposerLedger();
    noteFriendChatDraft(spaced, 'bob', 'Привет   ');
    send(spaced, 'bob', 'A');
    expect(normalizeDirectMessageText('Привет   ')).toEqual({ ok: true, text: 'Привет' });
    expect(settleFriendChatSend(spaced, 'A', 'bob', 'accepted').kind).toBe('accepted');
    expect(spaced.drafts.has('bob')).toBe(false);
  });

  it('keeps a newer revision when the ack arrives, even if the text matches again', () => {
    const edited = createFriendChatComposerLedger();
    noteFriendChatDraft(edited, 'bob', 'Первое');
    send(edited, 'bob', 'A');
    noteFriendChatDraft(edited, 'bob', 'Второе');
    expect(settleFriendChatSend(edited, 'A', 'bob', 'accepted')).toMatchObject({ clearDraft: false });
    expect(edited.drafts.get('bob')).toBe('Второе');
    expect(edited.pending.has('A')).toBe(false);

    const sameWords = createFriendChatComposerLedger();
    noteFriendChatDraft(sameWords, 'bob', 'Привет');
    const first = friendChatDraftRevision(sameWords, 'bob');
    send(sameWords, 'bob', 'A');
    noteFriendChatDraft(sameWords, 'bob', 'Привет ');
    noteFriendChatDraft(sameWords, 'bob', 'Привет');
    expect(friendChatDraftRevision(sameWords, 'bob')).toBeGreaterThan(first);
    expect(settleFriendChatSend(sameWords, 'A', 'bob', 'accepted')).toMatchObject({ clearDraft: false });
    expect(sameWords.drafts.get('bob')).toBe('Привет');
  });

  it('keeps the current draft on error, including an edit made after submit', () => {
    const ledger = createFriendChatComposerLedger();
    noteFriendChatDraft(ledger, 'bob', 'Привет');
    send(ledger, 'bob', 'A');
    expect(settleFriendChatSend(ledger, 'A', 'bob', 'rejected')).toEqual({ kind: 'rejected', friendId: 'bob' });
    expect(ledger.drafts.get('bob')).toBe('Привет');

    const edited = createFriendChatComposerLedger();
    noteFriendChatDraft(edited, 'bob', 'Привет');
    send(edited, 'bob', 'A');
    noteFriendChatDraft(edited, 'bob', 'Второе');
    settleFriendChatSend(edited, 'A', 'bob', 'rejected');
    expect(edited.drafts.get('bob')).toBe('Второе');
    expect(edited.pending.size).toBe(0);
  });

  it('settles a closed chat without restoring a successful draft or painting another friend error', () => {
    const success = createFriendChatComposerLedger();
    noteFriendChatDraft(success, 'bob', 'Привет');
    send(success, 'bob', 'A');
    expect(directMessageTargetsOpenChat('friends', undefined, 'bob')).toBe(false);
    settleFriendChatSend(success, 'A', 'bob', 'accepted');
    expect(success.pending.has('A')).toBe(false);
    expect(success.drafts.has('bob')).toBe(false);

    const failure = createFriendChatComposerLedger();
    noteFriendChatDraft(failure, 'bob', 'Привет');
    noteFriendChatDraft(failure, 'cara', 'другой');
    send(failure, 'bob', 'A');
    expect(directMessageTargetsOpenChat('friend-chat', 'cara', 'bob')).toBe(false);
    expect(directMessageTargetsOpenChat('friend-chat', 'bob', 'bob')).toBe(true);
    settleFriendChatSend(failure, 'A', 'bob', 'rejected');
    expect(failure.drafts.get('bob')).toBe('Привет');
    expect(failure.drafts.get('cara')).toBe('другой');
  });

  it('blocks a second submit of the same revision and allows a newer one while the first is pending', () => {
    const ledger = createFriendChatComposerLedger();
    noteFriendChatDraft(ledger, 'bob', 'Привет');
    send(ledger, 'bob', 'A');
    expect(friendChatSendAlreadyPending(ledger, 'bob')).toBe(true);

    noteFriendChatDraft(ledger, 'bob', 'Как дела?');
    expect(friendChatSendAlreadyPending(ledger, 'bob')).toBe(false);
    send(ledger, 'bob', 'B');
    expect(ledger.pending.size).toBe(2);

    settleFriendChatSend(ledger, 'A', 'bob', 'accepted');
    expect(ledger.drafts.get('bob')).toBe('Как дела?');
    expect(settleFriendChatSend(ledger, 'B', 'bob', 'accepted')).toMatchObject({ clearDraft: true });
    expect(ledger.drafts.has('bob')).toBe(false);

    const reversed = createFriendChatComposerLedger();
    noteFriendChatDraft(reversed, 'bob', 'Первое');
    send(reversed, 'bob', 'A');
    noteFriendChatDraft(reversed, 'bob', 'Второе');
    send(reversed, 'bob', 'B');
    expect(settleFriendChatSend(reversed, 'B', 'bob', 'accepted')).toMatchObject({ clearDraft: true });
    expect(reversed.drafts.has('bob')).toBe(false);
    expect(settleFriendChatSend(reversed, 'A', 'bob', 'accepted')).toMatchObject({ clearDraft: false });
    expect(reversed.drafts.has('bob')).toBe(false);
    expect(reversed.pending.size).toBe(0);
  });

  it('does not clear a draft when the recipient append has no request id', () => {
    const ledger = createFriendChatComposerLedger();
    noteFriendChatDraft(ledger, 'bob', 'мой черновик');
    const parsed = parseServerMessage({
      type: 'direct_message',
      event: 'append',
      friendId: 'bob',
      messages: [{
        messageId: 'from-bob',
        seq: 4,
        senderId: 'bob',
        recipientId: 'ada',
        text: 'ответ',
        createdAt: 9,
      }],
    });
    expect(parsed).toMatchObject({ type: 'direct_message', event: 'append' });
    if (!parsed || !('type' in parsed) || parsed.type !== 'direct_message') return;
    expect(parsed.clientRequestId).toBeUndefined();
    expect(settleFriendChatSend(ledger, parsed.clientRequestId, parsed.friendId, 'accepted')).toEqual({ kind: 'untracked' });
    expect(ledger.drafts.get('bob')).toBe('мой черновик');
  });
});
