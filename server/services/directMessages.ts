import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkDirectMessage } from '../../shared/protocol';
import {
  DIRECT_MESSAGE_BURST,
  DIRECT_MESSAGE_LIMIT,
  DIRECT_MESSAGE_NOT_FRIEND_ERROR,
  DIRECT_MESSAGE_PAGE,
  DIRECT_MESSAGE_RATE_LIMIT_ERROR,
  DIRECT_MESSAGE_REFILL_MS,
  DIRECT_MESSAGE_SCHEMA_VERSION,
  DIRECT_MESSAGE_STORAGE_DIR,
  conversationKey,
  normalizeDirectMessageText,
  participantsFromKey,
} from '../../shared/directMessages';
import type { JsonFileStore } from './jsonStore';

const MISSING = Symbol('missing-direct-message');

/**
 * One conversation file per pair, under the same plugin-data scope as friends.
 * The public methods are the storage boundary: protocol and UI do not see paths.
 * A later SQLite backend can replace `readRaw` / `write` / `refreshIndex` only.
 */
export interface DirectMessageSendOptions {
  /** When the recipient currently has this exact chat open, mark it read in the same write. */
  readonly markReadFor?: string;
}

export type DirectMessageSendResult =
  | { readonly ok: true; readonly message: NetworkDirectMessage }
  | { readonly ok: false; readonly error: string };

export type DirectMessageHistoryResult =
  | { readonly ok: true; readonly messages: readonly NetworkDirectMessage[]; readonly hasMore: boolean }
  | { readonly ok: false; readonly error: string };

interface StoredMessage {
  messageId: string;
  seq: number;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: number;
}

interface ConversationFile {
  version: number;
  participants: [string, string];
  nextSeq: number;
  lastReadSeq: Record<string, number>;
  messages: StoredMessage[];
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export class DirectMessageService {
  private readonly conversations = new Map<string, ConversationFile>();
  private readonly knownKeys = new Set<string>();
  private readonly preservedKeys = new Set<string>();
  private readonly buckets = new Map<string, TokenBucket>();
  private indexed = false;

  constructor(
    private readonly files: JsonFileStore,
    private readonly isFriend: (a: string, b: string) => boolean,
    private readonly options: {
      readonly now?: () => number;
      readonly createId?: () => string;
    } = {},
  ) {}

  load(): void {
    this.conversations.clear();
    this.knownKeys.clear();
    this.preservedKeys.clear();
    this.indexed = false;
    this.refreshIndex();
  }

  send(senderId: string, friendId: string, rawText: string, extra?: DirectMessageSendOptions): DirectMessageSendResult {
    if (!senderId || !friendId || senderId === friendId || !this.isFriend(senderId, friendId)) {
      return { ok: false, error: DIRECT_MESSAGE_NOT_FRIEND_ERROR };
    }
    const normalized = normalizeDirectMessageText(rawText);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const now = this.now();
    if (!this.allowSend(senderId, now)) {
      return { ok: false, error: DIRECT_MESSAGE_RATE_LIMIT_ERROR };
    }
    const loaded = this.loadConversation(senderId, friendId);
    if (loaded === 'preserve') {
      return { ok: false, error: 'Не удалось сохранить сообщение.' };
    }
    const conversation = loaded ?? this.createConversation(senderId, friendId);
    const seq = conversation.nextSeq;
    const message: StoredMessage = {
      messageId: this.createId(),
      seq,
      senderId,
      recipientId: friendId,
      text: normalized.text,
      createdAt: now,
    };
    conversation.nextSeq = seq + 1;
    conversation.messages.push(message);
    if (conversation.messages.length > DIRECT_MESSAGE_LIMIT) {
      conversation.messages.splice(0, conversation.messages.length - DIRECT_MESSAGE_LIMIT);
    }
    if (extra?.markReadFor && (extra.markReadFor === senderId || extra.markReadFor === friendId)) {
      const previous = conversation.lastReadSeq[extra.markReadFor] ?? 0;
      conversation.lastReadSeq[extra.markReadFor] = Math.max(previous, seq);
    }
    this.write(conversation);
    return { ok: true, message: toNetwork(message) };
  }

  history(viewerId: string, friendId: string, beforeSeq?: number): DirectMessageHistoryResult {
    if (!viewerId || !friendId || viewerId === friendId || !this.isFriend(viewerId, friendId)) {
      return { ok: false, error: DIRECT_MESSAGE_NOT_FRIEND_ERROR };
    }
    const loaded = this.loadConversation(viewerId, friendId);
    if (loaded === 'preserve' || !loaded) {
      return { ok: true, messages: [], hasMore: false };
    }
    const ordered = loaded.messages;
    const eligible = beforeSeq === undefined
      ? ordered
      : ordered.filter((message) => message.seq < beforeSeq);
    const page = eligible.slice(-DIRECT_MESSAGE_PAGE);
    const oldest = page[0]?.seq;
    const hasMore = oldest !== undefined && ordered.some((message) => message.seq < oldest);
    return { ok: true, messages: page.map(toNetwork), hasMore };
  }

  markReadThroughLatest(viewerId: string, friendId: string): void {
    if (!viewerId || !friendId || !this.isFriend(viewerId, friendId)) return;
    const loaded = this.loadConversation(viewerId, friendId);
    if (!loaded || loaded === 'preserve') return;
    const latest = loaded.messages.length > 0 ? loaded.messages[loaded.messages.length - 1]!.seq : 0;
    const previous = loaded.lastReadSeq[viewerId] ?? 0;
    const next = Math.max(previous, latest);
    if (next === previous) return;
    loaded.lastReadSeq[viewerId] = next;
    this.write(loaded);
  }

  unreadCount(viewerId: string, friendId: string): number {
    if (!viewerId || !friendId || !this.isFriend(viewerId, friendId)) return 0;
    const loaded = this.loadConversation(viewerId, friendId);
    if (!loaded || loaded === 'preserve') return 0;
    return countUnread(loaded, viewerId);
  }

  /** Unread across current mutual friends. Unfriended files stay on disk and do not add to the badge. */
  totalUnread(viewerId: string): number {
    if (!viewerId) return 0;
    this.refreshIndex();
    let total = 0;
    for (const key of this.knownKeys) {
      const participants = participantsFromKey(key);
      if (!participants || !participants.includes(viewerId)) continue;
      const other = participants[0] === viewerId ? participants[1] : participants[0];
      total += this.unreadCount(viewerId, other);
    }
    return total;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private createId(): string {
    return this.options.createId?.() ?? crypto.randomUUID();
  }

  private allowSend(playerId: string, now: number): boolean {
    const bucket = this.buckets.get(playerId) ?? { tokens: DIRECT_MESSAGE_BURST, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt);
    const refilled = Math.min(DIRECT_MESSAGE_BURST, bucket.tokens + elapsed / DIRECT_MESSAGE_REFILL_MS);
    if (refilled < 1) {
      this.buckets.set(playerId, { tokens: refilled, updatedAt: now });
      return false;
    }
    this.buckets.set(playerId, { tokens: refilled - 1, updatedAt: now });
    return true;
  }

  private refreshIndex(): void {
    if (this.indexed) return;
    this.indexed = true;
    let names: string[] = [];
    try {
      names = readdirSync(join(this.files.directory, 'friends', 'messages'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
      const key = name.slice(0, -'.json'.length);
      if (!participantsFromKey(key)) continue;
      this.knownKeys.add(key);
    }
  }

  private loadConversation(a: string, b: string): ConversationFile | 'preserve' | undefined {
    const key = conversationKey(a, b);
    if (this.preservedKeys.has(key)) return 'preserve';
    const cached = this.conversations.get(key);
    if (cached) return cached;
    this.refreshIndex();
    const raw = this.readRaw(key);
    if (raw === undefined) return undefined;
    const parsed = parseConversation(raw, a, b);
    if (parsed.kind === 'preserve') {
      this.preservedKeys.add(key);
      this.knownKeys.add(key);
      return 'preserve';
    }
    if (parsed.kind !== 'ok') return undefined;
    this.conversations.set(key, parsed.conversation);
    this.knownKeys.add(key);
    if (parsed.dirty) this.write(parsed.conversation);
    return parsed.conversation;
  }

  private createConversation(a: string, b: string): ConversationFile {
    const [left, right] = a < b ? [a, b] : [b, a];
    const created: ConversationFile = {
      version: DIRECT_MESSAGE_SCHEMA_VERSION,
      participants: [left, right],
      nextSeq: 1,
      lastReadSeq: { [left]: 0, [right]: 0 },
      messages: [],
    };
    this.conversations.set(conversationKey(a, b), created);
    return created;
  }

  private readRaw(key: string): unknown {
    try {
      const value = this.files.load<unknown>(`${DIRECT_MESSAGE_STORAGE_DIR}/${key}`, MISSING);
      if (value === MISSING) return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  private write(conversation: ConversationFile): void {
    const key = conversationKey(conversation.participants[0], conversation.participants[1]);
    this.files.save(`${DIRECT_MESSAGE_STORAGE_DIR}/${key}`, conversation);
    this.conversations.set(key, conversation);
    this.knownKeys.add(key);
    this.preservedKeys.delete(key);
    this.indexed = true;
  }
}

function toNetwork(message: StoredMessage): NetworkDirectMessage {
  return {
    messageId: message.messageId,
    seq: message.seq,
    senderId: message.senderId,
    recipientId: message.recipientId,
    text: message.text,
    createdAt: message.createdAt,
  };
}

function countUnread(conversation: ConversationFile, playerId: string): number {
  const read = conversation.lastReadSeq[playerId] ?? 0;
  let count = 0;
  for (const message of conversation.messages) {
    if (message.senderId !== playerId && message.seq > read) count += 1;
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConversation(
  raw: unknown,
  a: string,
  b: string,
): { kind: 'ok'; conversation: ConversationFile; dirty: boolean } | { kind: 'missing' | 'preserve' } {
  if (!isRecord(raw)) return { kind: 'missing' };
  if (typeof raw.version === 'number' && raw.version !== DIRECT_MESSAGE_SCHEMA_VERSION) {
    return { kind: 'preserve' };
  }
  if (raw.version !== DIRECT_MESSAGE_SCHEMA_VERSION) return { kind: 'missing' };
  const [left, right] = a < b ? [a, b] : [b, a];
  if (!Array.isArray(raw.participants) || raw.participants.length !== 2) return { kind: 'missing' };
  const first = raw.participants[0];
  const second = raw.participants[1];
  if (typeof first !== 'string' || typeof second !== 'string') return { kind: 'missing' };
  if (!samePair(first, second, left, right)) return { kind: 'missing' };
  let dirty = first !== left || second !== right;
  const messages: StoredMessage[] = [];
  const seenSeq = new Set<number>();
  const seenId = new Set<string>();
  const source = Array.isArray(raw.messages) ? raw.messages : [];
  if (!Array.isArray(raw.messages)) dirty = true;
  for (const entry of source) {
    const message = parseMessage(entry, left, right);
    if (!message) {
      dirty = true;
      continue;
    }
    if (seenSeq.has(message.seq) || seenId.has(message.messageId)) {
      dirty = true;
      continue;
    }
    seenSeq.add(message.seq);
    seenId.add(message.messageId);
    messages.push(message);
  }
  messages.sort((one, two) => one.seq - two.seq);
  if (messages.length > DIRECT_MESSAGE_LIMIT) {
    messages.splice(0, messages.length - DIRECT_MESSAGE_LIMIT);
    dirty = true;
  }
  const maxSeq = messages.reduce((max, message) => Math.max(max, message.seq), 0);
  let nextSeq = typeof raw.nextSeq === 'number' && Number.isInteger(raw.nextSeq) && raw.nextSeq > 0
    ? raw.nextSeq
    : 1;
  if (nextSeq <= maxSeq) {
    nextSeq = maxSeq + 1;
    dirty = true;
  }
  const lastReadSeq: Record<string, number> = {
    [left]: readSeq(raw.lastReadSeq, left),
    [right]: readSeq(raw.lastReadSeq, right),
  };
  if (!isRecord(raw.lastReadSeq)) dirty = true;
  return {
    kind: 'ok',
    dirty,
    conversation: {
      version: DIRECT_MESSAGE_SCHEMA_VERSION,
      participants: [left, right],
      nextSeq,
      lastReadSeq,
      messages,
    },
  };
}

function samePair(first: string, second: string, left: string, right: string): boolean {
  return (first === left && second === right) || (first === right && second === left);
}

function readSeq(raw: unknown, playerId: string): number {
  if (!isRecord(raw)) return 0;
  const value = raw[playerId];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseMessage(raw: unknown, left: string, right: string): StoredMessage | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.messageId !== 'string' || raw.messageId.length === 0 || raw.messageId.length > 80) return undefined;
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) return undefined;
  if (typeof raw.senderId !== 'string' || typeof raw.recipientId !== 'string') return undefined;
  if (!samePair(raw.senderId, raw.recipientId, left, right)) return undefined;
  if (raw.senderId === raw.recipientId) return undefined;
  if (typeof raw.text !== 'string' || raw.text.length === 0 || raw.text.length > 128) return undefined;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt) || raw.createdAt < 0) return undefined;
  return {
    messageId: raw.messageId,
    seq: raw.seq,
    senderId: raw.senderId,
    recipientId: raw.recipientId,
    text: raw.text,
    createdAt: raw.createdAt,
  };
}
