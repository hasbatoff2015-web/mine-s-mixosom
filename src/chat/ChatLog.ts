import { MAX_CHAT_MESSAGES } from './chatScroll';
import {
  CHAT_TAB_HISTORY_LIMIT,
  type ChatChannel,
} from '../../shared/chat';

export type ChatMessageKind = 'system' | 'player' | 'command' | 'death' | 'error';

export interface ChatMessage {
  readonly id: string;
  readonly kind: ChatMessageKind;
  readonly text: string;
  readonly createdAtMs: number;
  readonly channel?: ChatChannel;
  readonly from?: string;
}

export const CHAT_VISIBLE_MS = 8_000;
export const CHAT_FADE_MS = 2_000;
export const CHAT_MAX_MESSAGES = MAX_CHAT_MESSAGES;
export const CHAT_HISTORY_LIMIT = 40;
export { CHAT_TAB_HISTORY_LIMIT };

export function chatLineOpacity(ageMs: number): number {
  if (ageMs <= CHAT_VISIBLE_MS) return 1;
  if (ageMs >= CHAT_VISIBLE_MS + CHAT_FADE_MS) return 0;
  return 1 - (ageMs - CHAT_VISIBLE_MS) / CHAT_FADE_MS;
}

export type HistoryStep =
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'draft' }
  | { readonly kind: 'unchanged' };

/** Up starts history from the newest line; Down is a no-op until browsing has started. */
export function stepTypedHistoryIndex(
  currentIndex: number,
  direction: -1 | 1,
  historyLength: number,
): HistoryStep {
  if (historyLength <= 0) return { kind: 'unchanged' };
  if (currentIndex < 0) {
    if (direction > 0) return { kind: 'unchanged' };
    return { kind: 'index', index: historyLength - 1 };
  }
  const next = currentIndex + direction;
  if (next < 0) return { kind: 'unchanged' };
  if (next >= historyLength) return { kind: 'draft' };
  return { kind: 'index', index: next };
}

export interface ChatPushOptions {
  readonly nowMs?: number;
  readonly channel?: ChatChannel;
  readonly from?: string;
  readonly id?: string;
}

export function chatMessageMatchesTab(message: ChatMessage, tab: ChatChannel): boolean {
  if (tab === 'global') return true;
  return message.channel === tab;
}

export function tabHistory(messages: readonly ChatMessage[], tab: ChatChannel, limit = CHAT_TAB_HISTORY_LIMIT): ChatMessage[] {
  const filtered = messages.filter((message) => chatMessageMatchesTab(message, tab));
  return filtered.length > limit ? filtered.slice(filtered.length - limit) : [...filtered];
}

export class ChatLog {
  private readonly messages: ChatMessage[] = [];
  private readonly typed: string[] = [];
  private nextLocalId = 1;
  private readonly seenIds = new Set<string>();

  get entries(): readonly ChatMessage[] {
    return this.messages;
  }

  get history(): readonly string[] {
    return this.typed;
  }

  clear(): void {
    this.messages.length = 0;
    this.typed.length = 0;
    this.seenIds.clear();
    this.nextLocalId = 1;
  }

  push(kind: ChatMessageKind, text: string, nowMs = performance.now(), options: ChatPushOptions = {}): ChatMessage {
    const id = options.id ?? `local-${this.nextLocalId++}`;
    if (this.seenIds.has(id)) {
      return this.messages.find((entry) => entry.id === id) ?? {
        id,
        kind,
        text,
        createdAtMs: options.nowMs ?? nowMs,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.from ? { from: options.from } : {}),
      };
    }
    const message: ChatMessage = {
      id,
      kind,
      text,
      createdAtMs: options.nowMs ?? nowMs,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.from ? { from: options.from } : {}),
    };
    this.seenIds.add(id);
    this.messages.push(message);
    while (this.messages.length > CHAT_MAX_MESSAGES) {
      const removed = this.messages.shift();
      if (removed) this.seenIds.delete(removed.id);
    }
    return message;
  }

  rememberInput(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (this.typed[this.typed.length - 1] === trimmed) return;
    this.typed.push(trimmed);
    if (this.typed.length > CHAT_HISTORY_LIMIT) this.typed.splice(0, this.typed.length - CHAT_HISTORY_LIMIT);
  }

  visible(nowMs: number, open: boolean): readonly ChatMessage[] {
    if (open) return this.messages;
    return this.messages.filter((message) => chatLineOpacity(nowMs - message.createdAtMs) > 0.02);
  }

  forTab(tab: ChatChannel): ChatMessage[] {
    return tabHistory(this.messages, tab);
  }
}
