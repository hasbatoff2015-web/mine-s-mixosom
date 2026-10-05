import { MAX_CHAT_LENGTH } from './config';
import { CHAT_TOO_LONG_ERROR, normalizeOutgoingChatText } from './chat';
import { normalizeNotificationCount } from './notifications';

/** Retained messages per conversation. `nextSeq` keeps climbing after trim. */
export const DIRECT_MESSAGE_LIMIT = 200;

/** Latest or older page size. A full conversation is at most four pages. */
export const DIRECT_MESSAGE_PAGE = 50;

export const DIRECT_MESSAGE_SCHEMA_VERSION = 1;

/** Plugin-data directory, same world scope as `friends/friends.json`. */
export const DIRECT_MESSAGE_STORAGE_DIR = 'friends/messages';

export const DIRECT_MESSAGE_NOT_FRIEND_ERROR = 'Игрок больше не находится у вас в друзьях.';
export const DIRECT_MESSAGE_RATE_LIMIT_ERROR = 'Слишком много сообщений. Подождите немного.';
export const DIRECT_MESSAGE_EMPTY_ERROR = 'Введите сообщение.';
export const DIRECT_MESSAGE_EMPTY_HISTORY = 'Сообщений пока нет. Напишите первым.';

/** Burst, then about one accepted message per second. Not persisted. */
export const DIRECT_MESSAGE_BURST = 5;
export const DIRECT_MESSAGE_REFILL_MS = 1000;

export const DM_SCROLL_TOP_THRESHOLD = 8;
export const DM_NEAR_BOTTOM_PX = 28;

const CONTROL_CHARS = /[\u0000-\u001F\u007F\u2028\u2029]/g;

export interface DirectMessageText {
  readonly ok: true;
  readonly text: string;
}

export interface DirectMessageTextError {
  readonly ok: false;
  readonly error: string;
}

/**
 * Single-line DM body. Trailing whitespace matches world chat.
 * Control characters and line breaks are removed, then empty and 128 are rejected.
 * A leading slash is ordinary text, not a command.
 */
export function normalizeDirectMessageText(raw: string): DirectMessageText | DirectMessageTextError {
  const stripped = raw.replace(CONTROL_CHARS, '');
  const text = normalizeOutgoingChatText(stripped);
  if (text.length === 0) return { ok: false, error: DIRECT_MESSAGE_EMPTY_ERROR };
  if (text.length > MAX_CHAT_LENGTH) return { ok: false, error: CHAT_TOO_LONG_ERROR };
  return { ok: true, text };
}

/** Canonical A↔B key. Sorted by player id, then hex-encoded so the file name is stable. */
export function conversationKey(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `${encodeParticipant(left)}--${encodeParticipant(right)}`;
}

export function participantsFromKey(key: string): readonly [string, string] | undefined {
  const parts = key.split('--');
  if (parts.length !== 2) return undefined;
  const left = decodeParticipant(parts[0] ?? '');
  const right = decodeParticipant(parts[1] ?? '');
  if (!left || !right || left === right) return undefined;
  if (conversationKey(left, right) !== key) return undefined;
  return left < right ? [left, right] : [right, left];
}

export function friendsMenuBadgeCount(friendNotifications: number, directUnread: number): number {
  const notes = normalizeNotificationCount(friendNotifications);
  const unread = typeof directUnread === 'number' && Number.isFinite(directUnread) && directUnread > 0
    ? Math.min(1_000_000, Math.floor(directUnread))
    : 0;
  return notes + unread;
}

/** Local clock label. The server stores `createdAt` only. */
export function formatDirectMessageClock(createdAt: number): string {
  if (!Number.isFinite(createdAt)) return '';
  const date = new Date(createdAt);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function chatScrollPinnedToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = DM_NEAR_BOTTOM_PX,
): boolean {
  if (scrollHeight <= clientHeight + 1) return true;
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

export function chatShouldRequestOlder(scrollTop: number, threshold = DM_SCROLL_TOP_THRESHOLD): boolean {
  return scrollTop <= threshold;
}

export function chatScrollTopAfterPrepend(
  oldScrollTop: number,
  oldScrollHeight: number,
  newScrollHeight: number,
): number {
  return oldScrollTop + (newScrollHeight - oldScrollHeight);
}

export function planDirectMessageScroll(input: {
  readonly reason: 'replace' | 'append' | 'prepend' | 'restore';
  readonly pinnedToBottom: boolean;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly nextScrollHeight: number;
}): number {
  if (input.reason === 'replace') return input.nextScrollHeight;
  if (input.reason === 'append') {
    return input.pinnedToBottom ? input.nextScrollHeight : input.scrollTop;
  }
  if (input.reason === 'prepend') {
    return chatScrollTopAfterPrepend(input.scrollTop, input.scrollHeight, input.nextScrollHeight);
  }
  if (input.pinnedToBottom) return input.nextScrollHeight;
  return Math.max(0, Math.min(input.scrollTop, input.nextScrollHeight));
}

export function mergeDirectMessagePage<T extends { readonly messageId: string; readonly seq: number }>(
  current: readonly T[],
  incoming: readonly T[],
  mode: 'replace' | 'prepend' | 'append',
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const push = (message: T): void => {
    if (seen.has(message.messageId)) return;
    seen.add(message.messageId);
    out.push(message);
  };
  if (mode === 'append') {
    for (const message of current) push(message);
    for (const message of incoming) push(message);
  } else if (mode === 'prepend') {
    for (const message of incoming) push(message);
    for (const message of current) push(message);
  } else {
    for (const message of incoming) push(message);
  }
  out.sort((left, right) => left.seq - right.seq);
  return out;
}

export interface PendingFriendChatSend {
  readonly friendId: string;
  readonly draftRevision: number;
}

/**
 * Composer correlation. Draft text is not an id: the server may normalize it,
 * and the player may type the same words again as a new intent.
 */
export interface FriendChatComposerLedger {
  readonly drafts: Map<string, string>;
  readonly revisions: Map<string, number>;
  readonly pending: Map<string, PendingFriendChatSend>;
}

export type FriendChatSendSettlement =
  | { readonly kind: 'untracked' }
  | { readonly kind: 'accepted'; readonly friendId: string; readonly clearDraft: boolean }
  | { readonly kind: 'rejected'; readonly friendId: string };

export function createFriendChatComposerLedger(): FriendChatComposerLedger {
  return {
    drafts: new Map(),
    revisions: new Map(),
    pending: new Map(),
  };
}

export function friendChatDraftRevision(ledger: FriendChatComposerLedger, friendId: string): number {
  return ledger.revisions.get(friendId) ?? 0;
}

/** A real edit. The same string does not start a new revision. */
export function noteFriendChatDraft(ledger: FriendChatComposerLedger, friendId: string, text: string): number {
  const previous = ledger.drafts.get(friendId);
  if (previous === text && ledger.revisions.has(friendId)) return ledger.revisions.get(friendId) ?? 0;
  const revision = (ledger.revisions.get(friendId) ?? 0) + 1;
  ledger.revisions.set(friendId, revision);
  ledger.drafts.set(friendId, text);
  return revision;
}

export function friendChatSendAlreadyPending(ledger: FriendChatComposerLedger, friendId: string): boolean {
  const revision = friendChatDraftRevision(ledger, friendId);
  for (const pending of ledger.pending.values()) {
    if (pending.friendId === friendId && pending.draftRevision === revision) return true;
  }
  return false;
}

export function trackFriendChatSend(
  ledger: FriendChatComposerLedger,
  friendId: string,
  clientRequestId: string,
): void {
  ledger.pending.set(clientRequestId, {
    friendId,
    draftRevision: friendChatDraftRevision(ledger, friendId),
  });
}

/**
 * Close one send. Success clears the draft only when the player has not edited
 * since that submit. The authoritative message text is not an input.
 */
export function settleFriendChatSend(
  ledger: FriendChatComposerLedger,
  clientRequestId: string | undefined,
  friendId: string,
  outcome: 'accepted' | 'rejected',
): FriendChatSendSettlement {
  if (!clientRequestId) return { kind: 'untracked' };
  const pending = ledger.pending.get(clientRequestId);
  if (!pending || pending.friendId !== friendId) return { kind: 'untracked' };
  ledger.pending.delete(clientRequestId);
  if (outcome === 'rejected') return { kind: 'rejected', friendId };
  const clearDraft = friendChatDraftRevision(ledger, friendId) === pending.draftRevision;
  if (clearDraft) {
    ledger.drafts.delete(friendId);
    ledger.revisions.set(friendId, pending.draftRevision + 1);
  }
  return { kind: 'accepted', friendId, clearDraft };
}

/** An error or append is painted only while that exact conversation is open. */
export function directMessageTargetsOpenChat(
  screen: string | undefined,
  activeFriendId: string | undefined,
  friendId: string,
): boolean {
  return screen === 'friend-chat' && activeFriendId === friendId;
}

function encodeParticipant(id: string): string {
  const bytes = new TextEncoder().encode(id);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function decodeParticipant(hex: string): string | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const text = new TextDecoder().decode(bytes);
  if (text.length === 0) return undefined;
  if (encodeParticipant(text) !== hex) return undefined;
  return text;
}
