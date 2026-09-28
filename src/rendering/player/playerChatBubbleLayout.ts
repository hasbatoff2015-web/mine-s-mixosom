import {
  NAMEPLATE_FADE_START,
  NAMEPLATE_HEIGHT,
  NAMEPLATE_HEIGHT_OFFSET,
  NAMEPLATE_MAX_DISTANCE,
  nameplateOpacity,
} from './PlayerNameplate';

/** Overhead player chat stays up for five seconds, then the next render hides it. */
export const PLAYER_CHAT_BUBBLE_VISIBLE_MS = 5_000;
/** Press Start 2P is nearly monospaced, so a fixed column count wraps deterministically. */
export const PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS = 32;
export const PLAYER_CHAT_BUBBLE_GAP = 0.16;
export const PLAYER_CHAT_BUBBLE_FONT_PX = 28;
export const PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT = 44;
export const PLAYER_CHAT_BUBBLE_PAD_X = 24;
export const PLAYER_CHAT_BUBBLE_PAD_Y = 16;
export const PLAYER_CHAT_BUBBLE_STROKE_WIDTH = 6;
export const PLAYER_CHAT_BUBBLE_COLOR = '#fff7c2';
/** World width of one glyph. 32 columns stay near a long nameplate, not a screen-wide banner. */
export const PLAYER_CHAT_BUBBLE_GLYPH_WORLD = 0.105;
export const PLAYER_CHAT_BUBBLE_LINE_WORLD = 0.34;

export { NAMEPLATE_FADE_START, NAMEPLATE_MAX_DISTANCE, nameplateOpacity };

export function wrapPlayerChatBubbleText(
  text: string,
  maxChars = PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS,
): readonly string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError('Chat bubble wrap width must be a positive integer');
  }
  if (text.length === 0) return [];
  const lines: string[] = [];
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const paragraph of source.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let rest = paragraph;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const space = window.lastIndexOf(' ');
      if (space > 0) {
        lines.push(rest.slice(0, space));
        rest = rest.slice(space + 1);
      } else {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
    }
    lines.push(rest);
  }
  return lines;
}

export interface PlayerChatBubbleLayout {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly centerY: number;
}

/** Bottom of the bubble sits above the nameplate top, including multiline growth. */
export function playerChatBubbleLayout(lines: readonly string[]): PlayerChatBubbleLayout {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const lineCount = Math.max(1, lines.length);
  const logicalWidth = Math.max(
    64,
    longest * PLAYER_CHAT_BUBBLE_FONT_PX + PLAYER_CHAT_BUBBLE_STROKE_WIDTH + PLAYER_CHAT_BUBBLE_PAD_X * 2,
  );
  const logicalHeight = lineCount * PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT + PLAYER_CHAT_BUBBLE_PAD_Y * 2;
  const worldWidth = Math.max(PLAYER_CHAT_BUBBLE_GLYPH_WORLD * 2, longest * PLAYER_CHAT_BUBBLE_GLYPH_WORLD);
  const worldHeight = lineCount * PLAYER_CHAT_BUBBLE_LINE_WORLD;
  const nameplateTop = NAMEPLATE_HEIGHT_OFFSET + NAMEPLATE_HEIGHT / 2;
  const centerY = nameplateTop + PLAYER_CHAT_BUBBLE_GAP + worldHeight / 2;
  return { logicalWidth, logicalHeight, worldWidth, worldHeight, centerY };
}

export function playerChatBubbleNameplateTop(): number {
  return NAMEPLATE_HEIGHT_OFFSET + NAMEPLATE_HEIGHT / 2;
}

/** Timer and wrapped lines for one remote player. Rendering reads this; it does not own Three objects. */
export class PlayerChatBubbleState {
  text = '';
  lines: readonly string[] = [];
  expiresAt = Number.NEGATIVE_INFINITY;

  show(text: string, now: number): void {
    if (text.trim().length === 0) {
      this.clear();
      return;
    }
    this.text = text;
    this.lines = wrapPlayerChatBubbleText(text);
    this.expiresAt = now + PLAYER_CHAT_BUBBLE_VISIBLE_MS;
  }

  clear(): void {
    this.text = '';
    this.lines = [];
    this.expiresAt = Number.NEGATIVE_INFINITY;
  }

  visibleAt(now: number): boolean {
    return this.lines.some((line) => line.length > 0) && now < this.expiresAt;
  }
}

export function presentRemoteChatBubble(
  remotes: ReadonlyMap<string, { showChatBubble(text: string, now?: number): void }> | undefined,
  message: { readonly kind: string; readonly playerId?: string; readonly text: string },
  now: number,
): void {
  if (!remotes || message.kind !== 'player' || !message.playerId) return;
  remotes.get(message.playerId)?.showChatBubble(message.text, now);
}
