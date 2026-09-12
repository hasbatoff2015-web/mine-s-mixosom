import { MAX_CHAT_LENGTH } from '../../shared/config';
import { type ChatChannel } from '../../shared/chat';

export function canSendChatOnTab(tab: ChatChannel, inClan: boolean): boolean {
  return tab !== 'clan' || inClan;
}

export function shouldShowClanEmptyHint(tab: ChatChannel, inClan: boolean): boolean {
  return tab === 'clan' && !inClan;
}

export function outgoingChatText(raw: string, maxLength = MAX_CHAT_LENGTH):
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'ok'; readonly text: string } {
  const text = raw.replace(/\s+$/g, '');
  if (!text) return { kind: 'empty' };
  if (text.length > maxLength) return { kind: 'too-long' };
  return { kind: 'ok', text };
}

export function defaultChatTabOnOpen(): ChatChannel {
  return 'global';
}
