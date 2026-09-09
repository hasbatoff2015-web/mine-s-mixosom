/**
 * Shared hologram appearance: fonts, size, style, line limits.
 * Used by protocol, server persistence, client renderer, and the editor.
 * Defaults match the historical canvas draw: `bold 36px sans-serif` at scale 1.
 */

export const HOLOGRAM_FONTS = ['ui', 'display', 'sans'] as const;
export type HologramFont = (typeof HOLOGRAM_FONTS)[number];

export const HOLOGRAM_STYLES = ['normal', 'bold', 'italic', 'bold-italic'] as const;
export type HologramTextStyle = (typeof HOLOGRAM_STYLES)[number];

export const HOLOGRAM_SIZE_MIN = 0.5;
export const HOLOGRAM_SIZE_MAX = 2.5;
export const HOLOGRAM_SIZE_STEP = 0.1;
export const HOLOGRAM_SIZE_DEFAULT = 1;
export const HOLOGRAM_FONT_DEFAULT: HologramFont = 'sans';
export const HOLOGRAM_STYLE_DEFAULT: HologramTextStyle = 'bold';
export const HOLOGRAM_MAX_LINES = 8;
export const HOLOGRAM_MAX_LINE_CHARS = 80;
export const HOLOGRAM_MAX_NAME = 32;
export const HOLOGRAM_MAX_RANGE = 128;

/** Sprite world size used by HologramRenderer (scale.x). */
export const HOLOGRAM_SPRITE_WIDTH = 2.6;
export const HOLOGRAM_SPRITE_LINE_HEIGHT = 0.42;
export const HOLOGRAM_SPRITE_BASE_HEIGHT = 0.35;
/** Billboard depth so yaw-independent AABB clicks still hit. */
export const HOLOGRAM_SPRITE_DEPTH = 1.2;

export const HOLOGRAM_FONT_CSS: Record<HologramFont, string> = {
  ui: '"Inter", system-ui, sans-serif',
  display: '"Press Start 2P", "Arial Black", sans-serif',
  sans: 'sans-serif',
};

export const HOLOGRAM_FONT_LABELS: Record<HologramFont, string> = {
  ui: 'Игровой',
  display: 'Пиксельный',
  sans: 'Классический',
};

export interface HologramAppearance {
  readonly lines: string[];
  readonly font: HologramFont;
  readonly size: number;
  readonly style: HologramTextStyle;
}

export const DEFAULT_HOLOGRAM_APPEARANCE: HologramAppearance = {
  lines: [],
  font: HOLOGRAM_FONT_DEFAULT,
  size: HOLOGRAM_SIZE_DEFAULT,
  style: HOLOGRAM_STYLE_DEFAULT,
};

export function isHologramFont(value: unknown): value is HologramFont {
  return typeof value === 'string' && (HOLOGRAM_FONTS as readonly string[]).includes(value);
}

export function isHologramStyle(value: unknown): value is HologramTextStyle {
  return typeof value === 'string' && (HOLOGRAM_STYLES as readonly string[]).includes(value);
}

export function clampHologramSize(value: number): number {
  const stepped = Math.round(value / HOLOGRAM_SIZE_STEP) * HOLOGRAM_SIZE_STEP;
  return Math.max(HOLOGRAM_SIZE_MIN, Math.min(HOLOGRAM_SIZE_MAX, Number(stepped.toFixed(1))));
}

export function hologramStyleFlags(style: HologramTextStyle): { bold: boolean; italic: boolean } {
  return {
    bold: style === 'bold' || style === 'bold-italic',
    italic: style === 'italic' || style === 'bold-italic',
  };
}

export function hologramStyleFromFlags(bold: boolean, italic: boolean): HologramTextStyle {
  if (bold && italic) return 'bold-italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/** Canvas `context.font` string. Inter 700 is a real face; italic is canvas synthesis. */
export function hologramCanvasFont(
  font: HologramFont,
  style: HologramTextStyle,
  px = 36,
): string {
  const { bold, italic } = hologramStyleFlags(style);
  const italicPrefix = italic ? 'italic ' : '';
  const family = HOLOGRAM_FONT_CSS[font];
  if (font === 'ui') {
    return `${italicPrefix}${bold ? '700' : '400'} ${px}px ${family}`;
  }
  if (font === 'display') {
    return `${italicPrefix}${bold ? 'bold' : '400'} ${px}px ${family}`;
  }
  return `${italicPrefix}${bold ? 'bold' : 'normal'} ${px}px ${family}`;
}

export function hologramTextFromLines(lines: readonly string[]): string {
  return lines.join('\n');
}

export function sanitizeHologramLines(lines: readonly string[]): string[] {
  const next = lines
    .slice(0, HOLOGRAM_MAX_LINES)
    .map((line) => line.replace(/\r/g, '').slice(0, HOLOGRAM_MAX_LINE_CHARS));
  return next.length > 0 ? next : [''];
}

export function linesFromHologramText(text: string): string[] {
  return sanitizeHologramLines(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseHologramLinesLenient(value: unknown): string[] {
  if (typeof value === 'string') return linesFromHologramText(value);
  if (!Array.isArray(value)) return [''];
  return sanitizeHologramLines(value.filter((line): line is string => typeof line === 'string'));
}

export function parseHologramLinesStrict(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const lines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length > HOLOGRAM_MAX_LINES) return undefined;
    if (lines.some((line) => line.length > HOLOGRAM_MAX_LINE_CHARS)) return undefined;
    return sanitizeHologramLines(lines);
  }
  if (!Array.isArray(value)) return undefined;
  if (value.length > HOLOGRAM_MAX_LINES) return undefined;
  const lines: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return undefined;
    if (entry.length > HOLOGRAM_MAX_LINE_CHARS) return undefined;
    lines.push(entry.replace(/\r/g, ''));
  }
  return sanitizeHologramLines(lines);
}

export function parseHologramAppearanceLenient(raw: unknown): HologramAppearance {
  const record = isRecord(raw) ? raw : {};
  const size = typeof record.size === 'number' && Number.isFinite(record.size)
    ? clampHologramSize(record.size)
    : HOLOGRAM_SIZE_DEFAULT;
  return {
    lines: parseHologramLinesLenient(record.lines),
    font: isHologramFont(record.font) ? record.font : HOLOGRAM_FONT_DEFAULT,
    size,
    style: isHologramStyle(record.style) ? record.style : HOLOGRAM_STYLE_DEFAULT,
  };
}

export function parseHologramAppearanceStrict(
  raw: unknown,
): { ok: true; value: HologramAppearance } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'hologram appearance invalid' };
  if (!isHologramFont(raw.font)) return { ok: false, error: 'hologram font invalid' };
  if (!isHologramStyle(raw.style)) return { ok: false, error: 'hologram style invalid' };
  if (typeof raw.size !== 'number' || !Number.isFinite(raw.size)) {
    return { ok: false, error: 'hologram size invalid' };
  }
  if (raw.size < HOLOGRAM_SIZE_MIN || raw.size > HOLOGRAM_SIZE_MAX) {
    return { ok: false, error: 'hologram size invalid' };
  }
  const lines = parseHologramLinesStrict(raw.lines);
  if (!lines) return { ok: false, error: 'hologram lines invalid' };
  return {
    ok: true,
    value: {
      lines,
      font: raw.font,
      size: clampHologramSize(raw.size),
      style: raw.style,
    },
  };
}

export function hologramSpriteHeight(lineCount: number, size = HOLOGRAM_SIZE_DEFAULT): number {
  const lines = Math.max(1, lineCount);
  return (HOLOGRAM_SPRITE_LINE_HEIGHT * lines + HOLOGRAM_SPRITE_BASE_HEIGHT) * size;
}

export function hologramSpriteWidth(size = HOLOGRAM_SIZE_DEFAULT): number {
  return HOLOGRAM_SPRITE_WIDTH * size;
}
