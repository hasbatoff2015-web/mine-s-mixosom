import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chatChromeStyle } from '../src/ui/gameMenuGui';
import {
  CHAT_TAB_HISTORY_LIMIT,
  ChatLog,
  chatScrollTopOnOpen,
  chatVisibilityCaption,
  isChatStuckToBottom,
  restoreChatScrollTop,
  tabHistory,
} from '../src/chat';

const root = dirname(fileURLToPath(import.meta.url));
const GAME_UI = readFileSync(join(root, '../src/ui/GameUI.ts'), 'utf8');
const STYLE = readFileSync(join(root, '../src/style.css'), 'utf8');

function cssRule(selector: string): string {
  const start = STYLE.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = STYLE.indexOf('\n}', start);
  expect(end, `${selector} end`).toBeGreaterThan(start);
  return STYLE.slice(start, end + 2);
}

describe('chat layout and controls', () => {
  it('anchors the chat container top-left in both open and closed CSS', () => {
    const chat = cssRule('#chat');
    expect(GAME_UI).toContain('data-chat-anchor="top-left"');
    expect(chat).toContain('top: 0;');
    expect(chat).toContain('left: 0;');
    expect(chat).toContain('right: auto;');
    expect(chat).toContain('bottom: auto;');
    expect(chat).toContain('width: fit-content;');
    expect(chat).toContain('align-items: flex-start;');
    expect(chat).toContain('justify-content: flex-start;');
    expect(chat).not.toContain('bottom: calc(');
    expect(STYLE).not.toMatch(/#chat \{[^}]*bottom: calc\(max\(10px/);
    expect(GAME_UI).not.toContain('this.chat.style.top');
    expect(GAME_UI).not.toContain('this.chat.style.bottom');
    expect(GAME_UI).not.toContain('this.chat.style.left');
    expect(GAME_UI).not.toContain('this.chat.style.right');
  });

  it('stretches open chat across the available viewport width', () => {
    expect(GAME_UI).toContain('data-chat-open-width="viewport"');
    const open = cssRule('#chat.open');
    expect(open).toContain('right: 0;');
    expect(open).toContain('width: auto;');
    expect(open).toContain('max-width: none;');
    expect(open).toContain('overflow-x: clip;');
    expect(open).toContain('overflow-y: visible;');
    expect(STYLE).not.toContain('--chat-open-width');
    expect(STYLE).not.toContain('min(70vw, 72rem)');
    expect(STYLE).not.toContain('min(92vw, 40rem)');
    expect(cssRule('#chat.open #chat-side')).toContain('margin-left: auto;');
    expect(cssRule('#chat.open #chat-compose')).toContain('width: 100%;');
    expect(cssRule('#chat-form')).toContain('width: 100%;');
    expect(cssRule('#chat-input')).toContain('width: 100%;');
    expect(cssRule('#chat-input')).toContain('flex: 1 1 auto;');
    expect(cssRule('#chat-input')).toContain('min-width: 0;');
  });

  it('hides compose and side controls when closed without an empty open-sized frame', () => {
    expect(cssRule('#chat-compose')).toContain('display: none;');
    expect(cssRule('#chat.open #chat-compose')).toContain('display: flex;');
    expect(cssRule('#chat-side')).toContain('display: none;');
    expect(cssRule('#chat.open #chat-side')).toContain('display: flex;');
    const closed = cssRule('#chat');
    expect(closed).toContain('width: fit-content;');
    expect(closed).not.toContain('right: 0;');
    const closedLog = cssRule('#chat-log');
    expect(closedLog).toContain('height: auto;');
    expect(closedLog).toContain('max-height: min(28vh, 240px);');
    expect(closedLog).not.toContain('min-height: var(--chat-open-log-height);');
  });

  it('uses a large open chat window with a fixed message area', () => {
    const chat = cssRule('#chat');
    expect(chat).toContain('--chat-open-log-height: min(72vh, calc(100dvh - 12rem));');
    const openLog = cssRule('#chat.open #chat-log');
    expect(openLog).toContain('height: var(--chat-open-log-height);');
    expect(openLog).toContain('min-height: var(--chat-open-log-height);');
    expect(openLog).toContain('max-height: var(--chat-open-log-height);');
    expect(STYLE).toContain('@media (max-height: 540px), (max-width: 900px)');
    expect(STYLE).toContain('--hud-scale');
  });

  it('keeps closed chat overlay transparent and uses graphite chrome when open', () => {
    expect(cssRule('#chat')).toContain('background: transparent;');
    expect(cssRule('#chat-main')).toContain('background: transparent;');
    expect(cssRule('#chat-log')).toContain('background: transparent;');
    expect(cssRule('#chat.open #chat-log')).toContain('background: transparent;');
    expect(cssRule('#chat.open #chat-log')).not.toContain('linear-gradient');
    expect(cssRule('#chat.open #chat-log')).toContain('box-shadow: none;');
    expect(STYLE).not.toContain('rgba(28, 31, 36, 0.94)');
    expect(STYLE).not.toContain('background: rgba(0, 0, 0, 0.18);');
    expect(cssRule('.chat-line')).toContain('background: rgba(0, 0, 0, 0.5);');
    expect(STYLE).toContain('.chat-line.channel-nearby::before {\n  background: #f0c400;\n}');
    expect(STYLE).toContain('.chat-line.channel-clan::before {\n  background: #b56bff;\n}');
  });

  it('enlarges chat log message text without changing input, tabs, or side buttons', () => {
    expect(cssRule('.chat-line')).toContain('font: calc(23px * var(--hud-scale))/1.35 var(--font-ui);');
    expect(cssRule('.chat-line')).toContain('word-break: break-word;');
    expect(cssRule('#chat-input')).toContain('font: calc(18px * var(--hud-scale))/1.3 var(--font-ui);');
    expect(cssRule('#chat-send,\n#chat-close,\n#chat-visibility')).toContain('height: calc(52px * var(--hud-scale));');
    expect(GAME_UI).toContain('chat-line-name');
    expect(GAME_UI).toContain("sep.textContent = ': '");
    expect(STYLE).toContain('.chat-line.channel-nearby::before {\n  background: #f0c400;\n}');
    expect(STYLE).toContain('.chat-line.channel-clan::before {\n  background: #b56bff;\n}');
  });

  it('does not move chrome when message counts or tabs change', () => {
    expect(cssRule('#chat-log-inner')).toContain('justify-content: flex-start;');
    expect(STYLE).not.toContain('#chat-log-inner {\n  display: flex;\n  min-height: 100%;');
    expect(GAME_UI).toContain('selectChatTab(tab: ChatChannel)');
    expect(GAME_UI).toContain("button.dataset.chatTab === tab");
    expect(GAME_UI).not.toContain('this.chat.style.top');
    expect(GAME_UI).not.toContain('this.chat.style.bottom');
    expect(CHAT_TAB_HISTORY_LIMIT).toBe(40);

    const log = new ChatLog();
    for (let i = 0; i < 5; i += 1) {
      log.push('player', `g${i}`, i, { channel: 'global', from: 'Ada', id: `g-${i}` });
    }
    for (let i = 0; i < CHAT_TAB_HISTORY_LIMIT; i += 1) {
      log.push('player', `n${i}`, i + 10, { channel: 'nearby', from: 'Ada', id: `n-${i}` });
    }
    expect(tabHistory(log.entries, 'global').length).toBeGreaterThan(5);
    expect(tabHistory(log.entries, 'global')).toHaveLength(40);
    expect(tabHistory(log.entries, 'nearby')).toHaveLength(40);
    expect(tabHistory(log.entries, 'clan')).toHaveLength(0);
  });

  it('uses authored PNG faces for Enter, close, Chat ON/OFF, and channel tabs', () => {
    expect(GAME_UI).toContain('id="chat-input"');
    expect(GAME_UI).toContain('id="chat-send"');
    expect(GAME_UI).toContain('form="chat-form"');
    expect(GAME_UI).toContain('type="submit"');
    expect(GAME_UI).toContain('>ENTER</span>');
    expect(GAME_UI).toContain('chatChromeStyle()');
    expect(GAME_UI).not.toContain('<svg');
    expect(cssRule('#chat-input')).toContain('min-height: calc(52px * var(--hud-scale));');
    expect(STYLE).toContain('#chat-send,\n#chat-close,\n#chat-visibility {');
    expect(cssRule('#chat-send,\n#chat-close,\n#chat-visibility')).toContain('background-size: contain;');
    expect(cssRule('#chat-tabs button')).toContain('background-size: contain;');
    expect(cssRule('#chat-send')).toContain('aspect-ratio: 198 / 96;');
    expect(cssRule('#chat-close')).toContain('aspect-ratio: 102 / 96;');
    expect(STYLE).toContain('aspect-ratio: 106 / 96;');
    expect(STYLE).toContain('aspect-ratio: 104 / 96;');
    expect(cssRule('#chat-send')).toContain('background-image: var(--chat-enter-img);');
    expect(cssRule('#chat-close')).toContain('background-image: var(--chat-close-img);');
    expect(STYLE).toContain('background-image: var(--chat-on-img);');
    expect(cssRule('#chat-visibility.is-off')).toContain('background-image: var(--chat-off-img);');
    expect(cssRule('#chat-tabs button[data-chat-tab="global"]')).toContain('background-image: var(--chat-tab-global);');
    expect(cssRule('#chat-tabs button[data-chat-tab="nearby"]')).toContain('background-image: var(--chat-tab-nearby);');
    expect(cssRule('#chat-tabs button[data-chat-tab="clan"]')).toContain('background-image: var(--chat-tab-clan);');
    expect(cssRule('#chat-tabs button')).toContain('filter: brightness(0.72);');
    expect(cssRule('#chat-tabs button.active')).toContain('filter: none;');
    expect(cssRule('#chat-send:hover:not(:disabled),\n#chat-close:hover,\n#chat-visibility:hover,\n#chat-tabs button:hover,\n#chat-send:focus-visible:not(:disabled),\n#chat-close:focus-visible,\n#chat-visibility:focus-visible,\n#chat-tabs button:focus-visible'))
      .toContain('filter: brightness(1.1);');
    expect(cssRule('#chat-send:active:not(:disabled),\n#chat-close:active,\n#chat-visibility:active,\n#chat-tabs button:active'))
      .toContain('filter: brightness(0.86);');
    const chrome = chatChromeStyle();
    expect(chrome).toContain('ui/chat/tab_global.png');
    expect(chrome).toContain('ui/chat/enter.png');
    expect(chrome).toContain('ui/chat/off.png');
    for (const file of [
      'tab_global.png', 'tab_nearby.png', 'tab_clan.png',
      'close.png', 'on.png', 'enter.png', 'off.png',
    ]) {
      expect(existsSync(join(root, '../public/ui/chat', file)), file).toBe(true);
    }
  });

  it('uses a close sprite with a hidden X and Tab hotkey label', () => {
    expect(GAME_UI).toContain('id="chat-close"');
    expect(GAME_UI).toContain('chat-close-x');
    expect(GAME_UI).toContain('>X</span>');
    expect(GAME_UI).toContain('>TAB</span>');
    expect(GAME_UI).toContain('class="chat-sr"');
    expect(GAME_UI).toContain("this.chatCloseEl.addEventListener('click', () => this.onChatCancel?.())");
    expect(GAME_UI).toContain("event.key === 'Tab'");
    expect(GAME_UI).toContain('this.onChatCancel?.()');
  });

  it('shows an obvious chat on/off speech-bubble state', () => {
    expect(GAME_UI).toContain('id="chat-visibility"');
    expect(GAME_UI).toContain('CHAT ON');
    expect(GAME_UI).toContain('CHAT OFF');
    expect(GAME_UI).toContain('chat-vis-on');
    expect(GAME_UI).toContain('chat-vis-off');
    expect(GAME_UI).not.toContain('M5 19 L19 5');
    expect(GAME_UI).toContain("dataset.chatDisplay = on ? 'on' : 'off'");
    expect(GAME_UI).toContain("this.chatVisibilityEl.classList.toggle('is-off', !on)");
    expect(cssRule('#chat-visibility.is-off .chat-vis-on,\n#chat-visibility.is-off .chat-vis-caption-on'))
      .toContain('display: none;');
    expect(chatVisibilityCaption(true)).toBe('CHAT ON');
    expect(chatVisibilityCaption(false)).toBe('CHAT OFF');
  });

  it('hides the native scrollbar while keeping overflow, wheel, and touch pan', () => {
    const log = cssRule('#chat-log');
    expect(log).toContain('overflow-y: auto;');
    expect(log).toContain('scrollbar-width: none;');
    expect(log).toContain('touch-action: pan-y;');
    expect(log).toContain('overscroll-behavior: contain;');
    expect(STYLE).toContain('#chat-log::-webkit-scrollbar');
    expect(cssRule('#chat-log::-webkit-scrollbar')).toContain('display: none;');
    expect(STYLE).not.toContain('::-webkit-scrollbar-thumb');
    expect(GAME_UI).toContain("this.chatLogEl.addEventListener('wheel'");
    expect(GAME_UI).toContain("this.chatLogEl.addEventListener('touchmove'");
    expect(GAME_UI).toContain('event.stopPropagation()');
    expect(isChatStuckToBottom(80, 120, 40)).toBe(true);
    expect(restoreChatScrollTop(200, 40, 240)).toBe(80);
    expect(chatScrollTopOnOpen(800)).toBe(800);
  });
});
