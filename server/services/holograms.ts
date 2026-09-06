import type { NetworkHologram } from '../../shared/protocol';

export interface HologramRecord {
  readonly name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  lines: string[];
  range: number;
  enabled: boolean;
}

export function toNetworkHologram(hologram: HologramRecord): NetworkHologram {
  return {
    name: hologram.name,
    x: hologram.x,
    y: hologram.y,
    z: hologram.z,
    lines: hologram.lines.slice(),
    range: hologram.range,
    enabled: hologram.enabled,
  };
}

/** Server-owned hologram list. WorldInstance broadcasts; plugins do not send packets. */
export class HologramNetwork {
  private holograms: NetworkHologram[] = [];

  constructor(private readonly onChange: (holograms: readonly NetworkHologram[]) => void) {}

  list(): readonly NetworkHologram[] {
    return this.holograms;
  }

  replace(records: readonly HologramRecord[]): void {
    this.holograms = records
      .filter((entry) => entry.enabled)
      .map(toNetworkHologram);
    this.onChange(this.holograms);
  }
}
