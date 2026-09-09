import type { NetworkHologram } from '../../shared/protocol';
import {
  HOLOGRAM_FONT_DEFAULT,
  HOLOGRAM_MAX_NAME,
  HOLOGRAM_SIZE_DEFAULT,
  HOLOGRAM_STYLE_DEFAULT,
  parseHologramAppearanceLenient,
  parseHologramLinesLenient,
  type HologramAppearance,
  type HologramFont,
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
  });
  const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : 0;
  const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0;
  const z = typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : 0;
  const range = typeof raw.range === 'number' && Number.isFinite(raw.range)
    ? Math.max(1, Math.min(128, raw.range))
    : 48;
  const worldId = typeof raw.worldId === 'string' && raw.worldId.length > 0 ? raw.worldId : fallbackWorldId;
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
  return {
    name: input.name.trim().toLowerCase().slice(0, HOLOGRAM_MAX_NAME),
    worldId: input.worldId,
    x: input.x,
    y: input.y,
    z: input.z,
    lines: parseHologramLinesLenient(input.lines ?? [input.name]),
    range: Math.max(1, Math.min(128, input.range ?? 48)),
    enabled: true,
    font: HOLOGRAM_FONT_DEFAULT,
    size: HOLOGRAM_SIZE_DEFAULT,
    style: HOLOGRAM_STYLE_DEFAULT,
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
  };
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

  updateAppearance(name: string, appearance: HologramAppearance): HologramRecord | undefined {
    const hologram = this.get(name);
    if (!hologram) return undefined;
    hologram.lines = appearance.lines.slice();
    hologram.font = appearance.font;
    hologram.size = appearance.size;
    hologram.style = appearance.style;
    this.emit();
    this.persist?.(this.records);
    return hologram;
  }

  private emit(): void {
    this.onChange(this.list());
  }
}
