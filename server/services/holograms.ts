import type { ClientHologramUpdateMessage, NetworkHologram } from '../../shared/protocol';
import {
  HOLOGRAM_FONT_DEFAULT,
  HOLOGRAM_KIND_DEFAULT,
  HOLOGRAM_MAX_NAME,
  HOLOGRAM_SIZE_DEFAULT,
  HOLOGRAM_STYLE_DEFAULT,
  HOLOGRAM_TIMER_DURATION_DEFAULT,
  clampHologramYaw,
  parseHologramAppearanceLenient,
  parseHologramLinesLenient,
  type HologramFont,
  type HologramKind,
  type HologramTextStyle,
} from '../../shared/hologramStyle';

export interface HologramRecord {
  readonly name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  lines: string[];
  range: number;
  enabled: boolean;
  font: HologramFont;
  size: number;
  style: HologramTextStyle;
  kind: HologramKind;
  timerDuration: number;
  timerStartedAt: number;
  backgroundEnabled: boolean;
  backgroundWidth: number;
  backgroundHeight: number;
  billboard: boolean;
  yaw: number;
}

export interface HologramEditorContext {
  readonly playerYaw: number;
  readonly nowMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeHologramRecord(raw: unknown, fallbackWorldId = 'anarchy'): HologramRecord | undefined {
  if (!isRecord(raw) || typeof raw.name !== 'string') return undefined;
  const name = raw.name.trim().toLowerCase().slice(0, HOLOGRAM_MAX_NAME);
  if (!name) return undefined;
  const appearance = parseHologramAppearanceLenient({
    lines: raw.lines,
    font: raw.font,
    size: raw.size,
    style: raw.style,
    kind: raw.kind,
    timerDuration: raw.timerDuration,
    backgroundEnabled: raw.backgroundEnabled,
    backgroundWidth: raw.backgroundWidth,
    backgroundHeight: raw.backgroundHeight,
    billboard: raw.billboard,
  });
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : 0;
  const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0;
  const z = typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : 0;
  const range = typeof raw.range === 'number' && Number.isFinite(raw.range)
    ? Math.max(1, Math.min(128, raw.range))
    : 48;
  const worldId = typeof raw.worldId === 'string' && raw.worldId.length > 0 ? raw.worldId : fallbackWorldId;
  const timerStartedAt = typeof raw.timerStartedAt === 'number' && Number.isFinite(raw.timerStartedAt)
    ? raw.timerStartedAt
    : 0;
  const yaw = typeof raw.yaw === 'number' && Number.isFinite(raw.yaw) ? clampHologramYaw(raw.yaw) : 0;
  return {
    name,
    worldId,
    x,
    y,
    z,
    lines: appearance.lines.length > 0 ? appearance.lines : parseHologramLinesLenient([name]),
    range,
    enabled: raw.enabled !== false,
    font: appearance.font,
    size: appearance.size,
    style: appearance.style,
    kind: appearance.kind,
    timerDuration: appearance.timerDuration,
    timerStartedAt,
    backgroundEnabled: appearance.backgroundEnabled,
    backgroundWidth: appearance.backgroundWidth,
    backgroundHeight: appearance.backgroundHeight,
    billboard: appearance.billboard,
    yaw,
  };
}

export function createHologramRecord(input: {
  name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  lines?: readonly string[];
  range?: number;
}): HologramRecord {
  const appearance = parseHologramAppearanceLenient({
    lines: input.lines ?? [input.name],
    font: HOLOGRAM_FONT_DEFAULT,
    size: HOLOGRAM_SIZE_DEFAULT,
    style: HOLOGRAM_STYLE_DEFAULT,
  });
  return {
    name: input.name.trim().toLowerCase().slice(0, HOLOGRAM_MAX_NAME),
    worldId: input.worldId,
    x: input.x,
    y: input.y,
    z: input.z,
    lines: appearance.lines,
    range: Math.max(1, Math.min(128, input.range ?? 48)),
    enabled: true,
    font: appearance.font,
    size: appearance.size,
    style: appearance.style,
    kind: HOLOGRAM_KIND_DEFAULT,
    timerDuration: HOLOGRAM_TIMER_DURATION_DEFAULT,
    timerStartedAt: 0,
    backgroundEnabled: appearance.backgroundEnabled,
    backgroundWidth: appearance.backgroundWidth,
    backgroundHeight: appearance.backgroundHeight,
    billboard: true,
    yaw: 0,
  };
}

export function toNetworkHologram(hologram: HologramRecord): NetworkHologram {
  const appearance = parseHologramAppearanceLenient(hologram);
  return {
    name: hologram.name,
    x: hologram.x,
    y: hologram.y,
    z: hologram.z,
    lines: appearance.lines.slice(),
    range: hologram.range,
    enabled: hologram.enabled,
    font: appearance.font,
    size: appearance.size,
    style: appearance.style,
    kind: appearance.kind,
    timerDuration: appearance.timerDuration,
    timerStartedAt: hologram.timerStartedAt,
    backgroundEnabled: appearance.backgroundEnabled,
    backgroundWidth: appearance.backgroundWidth,
    backgroundHeight: appearance.backgroundHeight,
    billboard: appearance.billboard,
    yaw: hologram.yaw,
  };
}

function applyEditorUpdate(
  hologram: HologramRecord,
  message: ClientHologramUpdateMessage,
  context: HologramEditorContext,
): void {
  hologram.lines = message.lines.slice();
  hologram.font = message.font;
  hologram.size = message.size;
  hologram.style = message.style;
  if (message.backgroundEnabled !== undefined) hologram.backgroundEnabled = message.backgroundEnabled;
  if (message.backgroundWidth !== undefined) hologram.backgroundWidth = message.backgroundWidth;
  if (message.backgroundHeight !== undefined) hologram.backgroundHeight = message.backgroundHeight;

  const nextBillboard = message.billboard ?? hologram.billboard;
  if (hologram.billboard && !nextBillboard) {
    hologram.yaw = clampHologramYaw(context.playerYaw);
  }
  hologram.billboard = nextBillboard;

  const nextKind = message.kind ?? hologram.kind;
  const nextDuration = message.timerDuration ?? hologram.timerDuration;
  const becomingTimer = nextKind === 'timer' && hologram.kind !== 'timer';
  const durationChanged = nextKind === 'timer' && hologram.kind === 'timer' && nextDuration !== hologram.timerDuration;
  hologram.kind = nextKind;
  if (nextKind === 'timer') {
    hologram.timerDuration = nextDuration;
    if (becomingTimer || durationChanged) hologram.timerStartedAt = context.nowMs;
  }
}

/** Server-owned hologram list. WorldInstance broadcasts; plugins do not send packets. */
export class HologramNetwork {
  private records: HologramRecord[] = [];
  private persist?: (records: readonly HologramRecord[]) => void;

  constructor(private readonly onChange: (holograms: readonly NetworkHologram[]) => void) {}

  setPersist(persist: (records: readonly HologramRecord[]) => void): void {
    this.persist = persist;
  }

  list(): readonly NetworkHologram[] {
    return this.records.filter((entry) => entry.enabled).map(toNetworkHologram);
  }

  listRecords(): readonly HologramRecord[] {
    return this.records;
  }

  get(name: string): HologramRecord | undefined {
    const key = name.trim().toLowerCase().slice(0, HOLOGRAM_MAX_NAME);
    return this.records.find((entry) => entry.name === key);
  }

  replace(records: readonly HologramRecord[]): void {
    const next: HologramRecord[] = [];
    for (const entry of records) {
      const normalized = normalizeHologramRecord(entry, entry.worldId);
      if (normalized) next.push(normalized);
    }
    this.records = next;
    this.emit();
  }

  updateAppearance(
    name: string,
    message: ClientHologramUpdateMessage,
    context: HologramEditorContext,
  ): HologramRecord | undefined {
    const hologram = this.get(name);
    if (!hologram) return undefined;
    applyEditorUpdate(hologram, message, context);
    this.emit();
    this.persist?.(this.records);
    return hologram;
  }

  resetTimer(name: string, nowMs = Date.now()): 'ok' | 'missing' | 'not-timer' {
    const hologram = this.get(name);
    if (!hologram) return 'missing';
    if (hologram.kind !== 'timer') return 'not-timer';
    hologram.timerStartedAt = nowMs;
    this.emit();
    this.persist?.(this.records);
    return 'ok';
  }

  private emit(): void {
    this.onChange(this.list());
  }
}
