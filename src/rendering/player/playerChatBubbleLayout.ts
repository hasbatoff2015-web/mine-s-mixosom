import {
  NAMEPLATE_FADE_START,
  NAMEPLATE_HEIGHT,
  NAMEPLATE_HEIGHT_OFFSET,
  NAMEPLATE_MAX_DISTANCE,
  NAMEPLATE_NAME_FONT_PX,
  NAMEPLATE_STROKE_WIDTH,
  NAMEPLATE_TEXT_LOGICAL_HEIGHT,
  nameplateOpacity,
} from './PlayerNameplate';

/** Overhead player chat stays up for five seconds, then the next render hides it. */
export const PLAYER_CHAT_BUBBLE_VISIBLE_MS = 5_000;
/** Press Start 2P is nearly monospaced, so a fixed column count wraps deterministically. */
export const PLAYER_CHAT_BUBBLE_MAX_LINE_CHARS = 32;
/**
 * World gap from the painted nickname top to the bubble panel.
 * Small enough that the chat glyphs sit about as far above the nick
 * as the nick sits above the HP line, and large enough that the panel
 * does not touch the nick.
 */
export const PLAYER_CHAT_BUBBLE_GAP = 0.02;
export const PLAYER_CHAT_BUBBLE_FONT_PX = 40;
export const PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT = 56;
export const PLAYER_CHAT_BUBBLE_PAD_X = 16;
export const PLAYER_CHAT_BUBBLE_PAD_Y = 8;
export const PLAYER_CHAT_BUBBLE_STROKE_WIDTH = 6;
export const PLAYER_CHAT_BUBBLE_COLOR = '#fff7c2';
/**
 * One logical pixel in world units. 40px Press Start 2P then matches the
 * nameplate nick glyph (~0.18). Width and height share this scale.
 */
export const PLAYER_CHAT_BUBBLE_WORLD_PER_PX = 0.0045;

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

/** World size of one chat glyph. Matches the nameplate nickname, not a tiny caption. */
export function playerChatBubbleGlyphWorld(): number {
  return PLAYER_CHAT_BUBBLE_FONT_PX * PLAYER_CHAT_BUBBLE_WORLD_PER_PX;
}

/**
 * World Y of the painted top of the nickname glyphs.
 * The nameplate sprite is taller than the ink: the nick sits in the first third.
 */
export function playerChatBubbleNicknameVisualTop(): number {
  const spriteTop = playerChatBubbleNameplateTop();
  const glyphTop = NAMEPLATE_TEXT_LOGICAL_HEIGHT / 3
    - NAMEPLATE_NAME_FONT_PX / 2
    - NAMEPLATE_STROKE_WIDTH / 2;
  return spriteTop - (glyphTop / NAMEPLATE_TEXT_LOGICAL_HEIGHT) * NAMEPLATE_HEIGHT;
}

export function playerChatBubbleNameplateTop(): number {
  return NAMEPLATE_HEIGHT_OFFSET + NAMEPLATE_HEIGHT / 2;
}

/** Bottom stays on the nickname gap. Extra lines grow upward. */
export function playerChatBubbleLayout(lines: readonly string[]): PlayerChatBubbleLayout {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const lineCount = Math.max(1, lines.length);
  const logicalWidth = Math.max(
    64,
    longest * PLAYER_CHAT_BUBBLE_FONT_PX + PLAYER_CHAT_BUBBLE_STROKE_WIDTH + PLAYER_CHAT_BUBBLE_PAD_X * 2,
  );
  const logicalHeight = lineCount * PLAYER_CHAT_BUBBLE_LINE_LOGICAL_HEIGHT + PLAYER_CHAT_BUBBLE_PAD_Y * 2;
  const worldWidth = logicalWidth * PLAYER_CHAT_BUBBLE_WORLD_PER_PX;
  const worldHeight = logicalHeight * PLAYER_CHAT_BUBBLE_WORLD_PER_PX;
  const bottom = playerChatBubbleNicknameVisualTop() + PLAYER_CHAT_BUBBLE_GAP;
  const centerY = bottom + worldHeight / 2;
  return { logicalWidth, logicalHeight, worldWidth, worldHeight, centerY };
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
