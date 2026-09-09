/**
 * Shared hologram appearance: fonts, size, style, background, orientation, timer.
 * Used by protocol, server persistence, client renderer, and the editor.
 * Defaults match the historical canvas draw: `bold 36px sans-serif` at scale 1
 * with a separate black background plane sized to the old sprite.
 */

export const HOLOGRAM_FONTS = ['ui', 'display', 'sans'] as const;
export type HologramFont = (typeof HOLOGRAM_FONTS)[number];

export const HOLOGRAM_STYLES = ['normal', 'bold', 'italic', 'bold-italic'] as const;
export type HologramTextStyle = (typeof HOLOGRAM_STYLES)[number];

export const HOLOGRAM_KINDS = ['normal', 'timer'] as const;
export type HologramKind = (typeof HOLOGRAM_KINDS)[number];

export const HOLOGRAM_SIZE_MIN = 0.5;
export const HOLOGRAM_SIZE_MAX = 2.5;
export const HOLOGRAM_SIZE_STEP = 0.1;
export const HOLOGRAM_SIZE_DEFAULT = 1;
export const HOLOGRAM_FONT_DEFAULT: HologramFont = 'sans';
export const HOLOGRAM_STYLE_DEFAULT: HologramTextStyle = 'bold';
export const HOLOGRAM_KIND_DEFAULT: HologramKind = 'normal';
export const HOLOGRAM_MAX_LINES = 8;
export const HOLOGRAM_MAX_LINE_CHARS = 80;
export const HOLOGRAM_MAX_NAME = 32;
export const HOLOGRAM_MAX_RANGE = 128;

/** Text plane world size used by HologramRenderer (scale.x). Independent of background. */
export const HOLOGRAM_SPRITE_WIDTH = 2.6;
export const HOLOGRAM_SPRITE_LINE_HEIGHT = 0.42;
export const HOLOGRAM_SPRITE_BASE_HEIGHT = 0.35;
/** Billboard depth so yaw-independent AABB clicks still hit. */
export const HOLOGRAM_SPRITE_DEPTH = 1.2;

/** Background plane size in the same world units as the text plane. */
export const HOLOGRAM_BG_WIDTH_MIN = 0.5;
export const HOLOGRAM_BG_WIDTH_MAX = Number((HOLOGRAM_SPRITE_WIDTH * HOLOGRAM_SIZE_MAX * 1.25).toFixed(2));
export const HOLOGRAM_BG_HEIGHT_MIN = 0.25;
export const HOLOGRAM_BG_HEIGHT_MAX = Number(
  ((HOLOGRAM_SPRITE_LINE_HEIGHT * HOLOGRAM_MAX_LINES + HOLOGRAM_SPRITE_BASE_HEIGHT) * HOLOGRAM_SIZE_MAX * 1.25).toFixed(2),
);
export const HOLOGRAM_BG_SIZE_STEP = 0.01;
export const HOLOGRAM_BACKGROUND_ENABLED_DEFAULT = true;

export const HOLOGRAM_TIMER_DURATION_MIN = 1;
export const HOLOGRAM_TIMER_DURATION_MAX = 86_400;
export const HOLOGRAM_TIMER_DURATION_DEFAULT = 60;

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

export const HOLOGRAM_KIND_LABELS: Record<HologramKind, string> = {
  normal: 'Обычная',
  timer: 'Таймер',
};

export interface HologramAppearance {
  readonly lines: string[];
  readonly font: HologramFont;
  readonly size: number;
  readonly style: HologramTextStyle;
  readonly kind: HologramKind;
  readonly timerDuration: number;
  readonly backgroundEnabled: boolean;
  readonly backgroundWidth: number;
  readonly backgroundHeight: number;
  readonly billboard: boolean;
}

/** Editor→server extras. Omitted keys keep the current record (legacy packets). */
export interface HologramEditorPatch {
  readonly kind?: HologramKind;
  readonly timerDuration?: number;
  readonly backgroundEnabled?: boolean;
  readonly backgroundWidth?: number;
  readonly backgroundHeight?: number;
  readonly billboard?: boolean;
}

export const DEFAULT_HOLOGRAM_APPEARANCE: HologramAppearance = {
  lines: [],
  font: HOLOGRAM_FONT_DEFAULT,
  size: HOLOGRAM_SIZE_DEFAULT,
  style: HOLOGRAM_STYLE_DEFAULT,
  kind: HOLOGRAM_KIND_DEFAULT,
  timerDuration: HOLOGRAM_TIMER_DURATION_DEFAULT,
  backgroundEnabled: HOLOGRAM_BACKGROUND_ENABLED_DEFAULT,
  backgroundWidth: hologramSpriteWidth(HOLOGRAM_SIZE_DEFAULT),
  backgroundHeight: hologramSpriteHeight(1, HOLOGRAM_SIZE_DEFAULT),
  billboard: true,
};

export function isHologramFont(value: unknown): value is HologramFont {
  return typeof value === 'string' && (HOLOGRAM_FONTS as readonly string[]).includes(value);
}

export function isHologramStyle(value: unknown): value is HologramTextStyle {
  return typeof value === 'string' && (HOLOGRAM_STYLES as readonly string[]).includes(value);
}

export function isHologramKind(value: unknown): value is HologramKind {
  return typeof value === 'string' && (HOLOGRAM_KINDS as readonly string[]).includes(value);
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

export function hologramSpriteHeight(lineCount: number, size = HOLOGRAM_SIZE_DEFAULT): number {
  const lines = Math.max(1, lineCount);
  return (HOLOGRAM_SPRITE_LINE_HEIGHT * lines + HOLOGRAM_SPRITE_BASE_HEIGHT) * size;
}

export function hologramSpriteWidth(size = HOLOGRAM_SIZE_DEFAULT): number {
  return HOLOGRAM_SPRITE_WIDTH * size;
}

export function clampHologramBackgroundWidth(value: number): number {
  const stepped = Math.round(value / HOLOGRAM_BG_SIZE_STEP) * HOLOGRAM_BG_SIZE_STEP;
  return Math.max(HOLOGRAM_BG_WIDTH_MIN, Math.min(HOLOGRAM_BG_WIDTH_MAX, Number(stepped.toFixed(2))));
}

export function clampHologramBackgroundHeight(value: number): number {
  const stepped = Math.round(value / HOLOGRAM_BG_SIZE_STEP) * HOLOGRAM_BG_SIZE_STEP;
  return Math.max(HOLOGRAM_BG_HEIGHT_MIN, Math.min(HOLOGRAM_BG_HEIGHT_MAX, Number(stepped.toFixed(2))));
}

export function clampHologramTimerDuration(value: number): number {
  if (!Number.isFinite(value)) return HOLOGRAM_TIMER_DURATION_DEFAULT;
  return Math.max(HOLOGRAM_TIMER_DURATION_MIN, Math.min(HOLOGRAM_TIMER_DURATION_MAX, Math.round(value)));
}

export function clampHologramYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const tau = Math.PI * 2;
  let yaw = value % tau;
  if (yaw > Math.PI) yaw -= tau;
  if (yaw < -Math.PI) yaw += tau;
  return yaw;
}

export function defaultHologramBackgroundWidth(size = HOLOGRAM_SIZE_DEFAULT): number {
  return clampHologramBackgroundWidth(hologramSpriteWidth(size));
}

export function defaultHologramBackgroundHeight(lineCount: number, size = HOLOGRAM_SIZE_DEFAULT): number {
  return clampHologramBackgroundHeight(hologramSpriteHeight(lineCount, size));
}

/**
 * Integer countdown including a one-second `00:00` beat, then wrap to full duration.
 * duration=60 → 01:00 … 00:00 → 01:00. Clients joining mid-cycle share the same remaining.
 */
export function hologramTimerRemainingSeconds(
  durationSec: number,
  startedAtMs: number,
  nowMs: number,
): number {
  const duration = clampHologramTimerDuration(durationSec);
  const started = Number.isFinite(startedAtMs) ? startedAtMs : 0;
  const now = Number.isFinite(nowMs) ? nowMs : started;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const period = duration + 1;
  const slot = elapsed % period;
  return duration - slot;
}

export function formatHologramCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (seconds >= 3600) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(minutes)}:${pad(secs)}`;
}

export function hologramDisplayLineCount(kind: HologramKind, lines: readonly string[]): number {
  if (kind === 'timer') return 1;
  return Math.max(1, lines.length);
}

export function hologramDisplayLines(
  hologram: {
    readonly kind: HologramKind;
    readonly lines: readonly string[];
    readonly timerDuration: number;
    readonly timerStartedAt: number;
  },
  nowMs: number,
): string[] {
  if (hologram.kind === 'timer') {
    return [formatHologramCountdown(
      hologramTimerRemainingSeconds(hologram.timerDuration, hologram.timerStartedAt, nowMs),
    )];
  }
  return hologram.lines.length > 0 ? [...hologram.lines] : [' '];
}

export function hologramWorldSize(hologram: {
  readonly lines: readonly string[];
  readonly size?: number;
  readonly kind?: HologramKind;
  readonly backgroundEnabled?: boolean;
  readonly backgroundWidth?: number;
  readonly backgroundHeight?: number;
}): { width: number; height: number; depth: number } {
  const size = hologram.size ?? HOLOGRAM_SIZE_DEFAULT;
  const kind = hologram.kind ?? HOLOGRAM_KIND_DEFAULT;
  const lineCount = hologramDisplayLineCount(kind, hologram.lines);
  const textW = hologramSpriteWidth(size);
  const textH = hologramSpriteHeight(lineCount, size);
  const bgOn = hologram.backgroundEnabled !== false;
  const bgW = bgOn ? (hologram.backgroundWidth ?? defaultHologramBackgroundWidth(size)) : 0;
  const bgH = bgOn ? (hologram.backgroundHeight ?? defaultHologramBackgroundHeight(lineCount, size)) : 0;
  return {
    width: Math.max(textW, bgW),
    height: Math.max(textH, bgH),
    depth: Math.max(HOLOGRAM_SPRITE_DEPTH, 1.3 * size),
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseHologramAppearanceLenient(raw: unknown): HologramAppearance {
  const record = isRecord(raw) ? raw : {};
  const size = typeof record.size === 'number' && Number.isFinite(record.size)
    ? clampHologramSize(record.size)
    : HOLOGRAM_SIZE_DEFAULT;
  const lines = parseHologramLinesLenient(record.lines);
  const kind = isHologramKind(record.kind) ? record.kind : HOLOGRAM_KIND_DEFAULT;
  const widthRaw = optionalFinite(record.backgroundWidth);
  const heightRaw = optionalFinite(record.backgroundHeight);
  const durationRaw = optionalFinite(record.timerDuration);
  return {
    lines,
    font: isHologramFont(record.font) ? record.font : HOLOGRAM_FONT_DEFAULT,
    size,
    style: isHologramStyle(record.style) ? record.style : HOLOGRAM_STYLE_DEFAULT,
    kind,
    timerDuration: durationRaw !== undefined
      ? clampHologramTimerDuration(durationRaw)
      : HOLOGRAM_TIMER_DURATION_DEFAULT,
    backgroundEnabled: record.backgroundEnabled !== false,
    backgroundWidth: widthRaw !== undefined
      ? clampHologramBackgroundWidth(widthRaw)
      : hologramSpriteWidth(size),
    backgroundHeight: heightRaw !== undefined
      ? clampHologramBackgroundHeight(heightRaw)
      : hologramSpriteHeight(Math.max(1, lines.length), size),
    billboard: record.billboard !== false,
  };
}

export function parseHologramAppearanceStrict(
  raw: unknown,
): { ok: true; value: Pick<HologramAppearance, 'lines' | 'font' | 'size' | 'style'> } | { ok: false; error: string } {
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

export function parseHologramEditorPatch(
  raw: unknown,
): { ok: true; value: HologramEditorPatch } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'hologram appearance invalid' };
  const patch: {
    kind?: HologramKind;
    timerDuration?: number;
    backgroundEnabled?: boolean;
    backgroundWidth?: number;
    backgroundHeight?: number;
    billboard?: boolean;
  } = {};
  if (raw.kind !== undefined) {
    if (!isHologramKind(raw.kind)) return { ok: false, error: 'hologram kind invalid' };
    patch.kind = raw.kind;
  }
  if (raw.timerDuration !== undefined) {
    if (typeof raw.timerDuration !== 'number' || !Number.isFinite(raw.timerDuration) || !Number.isInteger(raw.timerDuration)) {
      return { ok: false, error: 'hologram timerDuration invalid' };
    }
    if (raw.timerDuration < HOLOGRAM_TIMER_DURATION_MIN || raw.timerDuration > HOLOGRAM_TIMER_DURATION_MAX) {
      return { ok: false, error: 'hologram timerDuration invalid' };
    }
    patch.timerDuration = raw.timerDuration;
  }
  if (raw.backgroundEnabled !== undefined) {
    const enabled = optionalBoolean(raw.backgroundEnabled);
    if (enabled === undefined) return { ok: false, error: 'hologram backgroundEnabled invalid' };
    patch.backgroundEnabled = enabled;
  }
  if (raw.backgroundWidth !== undefined) {
    if (typeof raw.backgroundWidth !== 'number' || !Number.isFinite(raw.backgroundWidth)) {
      return { ok: false, error: 'hologram backgroundWidth invalid' };
    }
    if (raw.backgroundWidth < HOLOGRAM_BG_WIDTH_MIN || raw.backgroundWidth > HOLOGRAM_BG_WIDTH_MAX) {
      return { ok: false, error: 'hologram backgroundWidth invalid' };
    }
    patch.backgroundWidth = clampHologramBackgroundWidth(raw.backgroundWidth);
  }
  if (raw.backgroundHeight !== undefined) {
    if (typeof raw.backgroundHeight !== 'number' || !Number.isFinite(raw.backgroundHeight)) {
      return { ok: false, error: 'hologram backgroundHeight invalid' };
    }
    if (raw.backgroundHeight < HOLOGRAM_BG_HEIGHT_MIN || raw.backgroundHeight > HOLOGRAM_BG_HEIGHT_MAX) {
      return { ok: false, error: 'hologram backgroundHeight invalid' };
    }
    patch.backgroundHeight = clampHologramBackgroundHeight(raw.backgroundHeight);
  }
  if (raw.billboard !== undefined) {
    const billboard = optionalBoolean(raw.billboard);
    if (billboard === undefined) return { ok: false, error: 'hologram billboard invalid' };
    patch.billboard = billboard;
  }
  if (patch.kind === 'timer' && patch.timerDuration === undefined) {
    return { ok: false, error: 'hologram timerDuration invalid' };
  }
  return { ok: true, value: patch };
}
