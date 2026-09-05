import { MAX_CHAT_MESSAGES } from './chatScroll';

export type ChatMessageKind = 'system' | 'player' | 'command' | 'death' | 'error';

export interface ChatMessage {
  readonly kind: ChatMessageKind;
  readonly text: string;
  readonly createdAtMs: number;
}

export const CHAT_VISIBLE_MS = 8_000;
export const CHAT_FADE_MS = 2_000;
export const CHAT_MAX_MESSAGES = MAX_CHAT_MESSAGES;
export const CHAT_HISTORY_LIMIT = 40;

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

export class ChatLog {
  private readonly messages: ChatMessage[] = [];
  private readonly typed: string[] = [];

  get entries(): readonly ChatMessage[] {
    return this.messages;
  }

  get history(): readonly string[] {
    return this.typed;
  }

  clear(): void {
    this.messages.length = 0;
    this.typed.length = 0;
  }

  push(kind: ChatMessageKind, text: string, nowMs = performance.now()): ChatMessage {
    const message: ChatMessage = { kind, text, createdAtMs: nowMs };
    this.messages.push(message);
    if (this.messages.length > CHAT_MAX_MESSAGES) this.messages.splice(0, this.messages.length - CHAT_MAX_MESSAGES);
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
}
