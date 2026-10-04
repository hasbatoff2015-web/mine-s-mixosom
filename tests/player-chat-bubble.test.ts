import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { HOLOGRAM_BACKGROUND_OPACITY, hologramTextCanvasScale } from '../shared/hologramStyle';
import { SERVER_MESSAGE_TYPES } from '../shared/protocol';
import { ChatLog, CHAT_FADE_MS, CHAT_VISIBLE_MS } from '../src/chat';
import { friendJoinChatText, friendLeaveChatText } from '../shared/friends';
import { PlayerChatBubble } from '../src/rendering/player/PlayerChatBubble';
import {
  PLAYER_CHAT_BUBBLE_FONT_PX,
  PLAYER_CHAT_BUBBLE_GAP,
  PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT,
  PLAYER_CHAT_BUBBLE_PAD_X,
  PLAYER_CHAT_BUBBLE_PAD_Y,
  PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS,
  PLAYER_CHAT_BUBBLE_VISIBLE_MS,
  PlayerChatBubbleState,
  playerChatBubbleGlyphWorld,
  playerChatBubbleLayout,
  playerChatBubbleNameplateTop,
  playerChatBubbleNicknameVisualTop,
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
    expect(friendJoinChatText('Игрок1234')).toBe('Игрок1234 зашел в игру.');
    expect(friendJoinChatText('Bob')).not.toContain('Друг');
    const leave = friendLeaveChatText('Игрок1234');
    expect(leave).toBe('Игрок1234 вышел из игры.');
    const leaveEntry = log.push('system', leave, 1_000, { id: 'friend-leave' });
    expect(leaveEntry.style).toBeUndefined();
    expect(log.visible(1_000 + CHAT_VISIBLE_MS, false).map((message) => message.text)).toContain(leave);
  });
});

class FakeContext {
  readonly fillTexts: string[] = [];
  readonly strokeTexts: string[] = [];
  readonly fillRects: Array<{ x: number; y: number; w: number; h: number; fillStyle: string }> = [];
  readonly order: string[] = [];
  font = '';
  fillStyle = '';
  setTransform(): void {}
  clearRect(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push({ x, y, w, h, fillStyle: this.fillStyle });
    this.order.push('fillRect');
  }
  strokeText(text: string): void {
    this.strokeTexts.push(text);
    this.order.push('strokeText');
  }
  fillText(text: string): void {
    this.fillTexts.push(text);
    this.order.push('fillText');
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeContext();
  getContext(): FakeContext {
    return this.context;
  }
}

function installCanvasDocument(): { canvas: FakeCanvas; restore: () => void } {
  const previous = globalThis.document;
  const canvas = new FakeCanvas();
  globalThis.document = {
    createElement: () => canvas,
  } as unknown as Document;
  return {
    canvas,
    restore() {
      if (previous === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        globalThis.document = previous;
      }
    },
  };
}

function bubbleMap(bubble: PlayerChatBubble): THREE.Texture {
  return (bubble.sprite.material as THREE.SpriteMaterial).map!;
}

describe('player chat bubble canvas upload', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('replaces the GPU texture when a longer line resizes the canvas', () => {
    const installed = installCanvasDocument();
    restore = installed.restore;
    const bubble = new PlayerChatBubble();
    const sprite = bubble.sprite;
    const material = bubble.sprite.material;

    bubble.show('ку', 1_000);
    const short = playerChatBubbleLayout(bubble.lines);
    const scale = hologramTextCanvasScale();
    const first = bubbleMap(bubble);
    expect(bubble.text).toBe('ку');
    expect(bubble.lines).toEqual(['ку']);
    expect(installed.canvas.width).toBe(short.logicalWidth * scale);
    expect(installed.canvas.height).toBe(short.logicalHeight * scale);
    expect(first.version).toBeGreaterThan(0);
    expect(installed.canvas.context.fillTexts.at(-1)).toBe('ку');

    let disposed = false;
    first.addEventListener('dispose', () => {
      disposed = true;
    });
    bubble.show('привет', 2_000);
    const tall = playerChatBubbleLayout(bubble.lines);
    const second = bubbleMap(bubble);
    expect(bubble.text).toBe('привет');
    expect(bubble.lines).toEqual(['привет']);
    expect(bubble.lines.join('')).not.toContain('ку');
    expect(installed.canvas.width).toBe(tall.logicalWidth * scale);
    expect(installed.canvas.width).toBeGreaterThan(short.logicalWidth * scale);
    expect(second).not.toBe(first);
    expect(disposed).toBe(true);
    expect(bubble.sprite).toBe(sprite);
    expect(bubble.sprite.material).toBe(material);
    expect(installed.canvas.context.fillTexts.at(-1)).toBe('привет');
    expect(installed.canvas.context.strokeTexts.at(-1)).toBe('привет');
    const panel = installed.canvas.context.fillRects.at(-1);
    expect(panel?.fillStyle).toBe(`rgba(0, 0, 0, ${HOLOGRAM_BACKGROUND_OPACITY})`);
    expect(panel?.w).toBe(tall.logicalWidth);
    expect(panel?.h).toBe(tall.logicalHeight);
    const lastPanel = installed.canvas.context.order.lastIndexOf('fillRect');
    const lastText = installed.canvas.context.order.lastIndexOf('fillText');
    expect(lastPanel).toBeGreaterThanOrEqual(0);
    expect(lastText).toBeGreaterThan(lastPanel);
    bubble.dispose();
  });

  it('redraws the same texture when the next line does not resize the canvas', () => {
    const installed = installCanvasDocument();
    restore = installed.restore;
    const bubble = new PlayerChatBubble();
    bubble.show('ку', 1_000);
    const first = bubbleMap(bubble);
    const version = first.version;
    const width = installed.canvas.width;
    bubble.show('да', 2_000);
    expect(bubble.text).toBe('да');
    expect(bubble.lines).toEqual(['да']);
    expect(installed.canvas.width).toBe(width);
    expect(bubbleMap(bubble)).toBe(first);
    expect(first.version).toBe(version + 1);
    expect(installed.canvas.context.fillTexts.at(-1)).toBe('да');
    expect(installed.canvas.context.fillTexts.filter((text) => text === 'да')).toHaveLength(1);
    bubble.dispose();
  });

  it('font readiness repaints the current line, not the first one', async () => {
    const installed = installCanvasDocument();
    restore = installed.restore;
    let releaseFonts: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      releaseFonts = resolve;
    });
    Object.assign(globalThis.document, {
      fonts: {
        load: () => Promise.resolve(),
        ready,
      },
    });
    const bubble = new PlayerChatBubble();
    bubble.show('ку', 1_000);
    bubble.show('привет', 1_500);
    releaseFonts();
    await ready;
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
    expect(installed.canvas.context.fillTexts.at(-1)).toBe('привет');
    expect(bubble.text).toBe('привет');
    bubble.dispose();
  });
});

describe('player chat bubble size and nickname gap', () => {
  function bottom(lines: readonly string[]): number {
    const layout = playerChatBubbleLayout(lines);
    return layout.centerY - layout.worldHeight / 2;
  }

  it('keeps a readable glyph and the canvas aspect on short and long lines', () => {
    expect(PLAYER_CHAT_BUBBLE_FONT_PX).toBeGreaterThanOrEqual(36);
    expect(playerChatBubbleGlyphWorld()).toBeGreaterThan(0.16);
    expect(playerChatBubbleGlyphWorld()).toBeLessThanOrEqual(0.2);
    const samples = [
      wrapPlayerChatBubbleText('ку'),
      wrapPlayerChatBubbleText('Привет'),
      wrapPlayerChatBubbleText('Привет всем'),
      wrapPlayerChatBubbleText(`${'длинное сообщение '.repeat(6)}конец`),
    ];
    const anchor = playerChatBubbleNicknameVisualTop() + PLAYER_CHAT_BUBBLE_GAP;
    for (const lines of samples) {
      const layout = playerChatBubbleLayout(lines);
      expect(layout.worldWidth / layout.worldHeight).toBeCloseTo(layout.logicalWidth / layout.logicalHeight);
      expect(bottom(lines)).toBeCloseTo(anchor);
      expect(PLAYER_CHAT_BUBBLE_GAP).toBeGreaterThan(0);
      expect(PLAYER_CHAT_BUBBLE_GAP).toBeLessThan(0.06);
      expect(bottom(lines)).toBeGreaterThan(playerChatBubbleNicknameVisualTop());
      expect(bottom(lines)).toBeLessThan(playerChatBubbleNicknameVisualTop() + 0.06);
      expect(bottom(lines)).toBeLessThan(playerChatBubbleNameplateTop());
      expect(layout.logicalWidth).toBeGreaterThan(PLAYER_CHAT_BUBBLE_PAD_X * 2);
      expect(layout.logicalHeight).toBe(
        lines.length * PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT + PLAYER_CHAT_BUBBLE_PAD_Y * 2,
      );
      expect(lines.every((line) => line.length <= PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS)).toBe(true);
    }
    const shortLines = wrapPlayerChatBubbleText('ку');
    const tallLines = wrapPlayerChatBubbleText('я'.repeat(128));
    const short = playerChatBubbleLayout(shortLines);
    const tall = playerChatBubbleLayout(tallLines);
    expect(tall.worldHeight).toBeGreaterThan(short.worldHeight);
    expect(bottom(tallLines)).toBeCloseTo(bottom(shortLines));
    expect(tall.centerY).toBeGreaterThan(short.centerY);
  });
});
