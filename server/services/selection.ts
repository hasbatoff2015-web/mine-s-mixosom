export interface BlockPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SelectionVolume {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

interface PlayerSelection {
  pos1?: BlockPos;
  pos2?: BlockPos;
}

export function volumeFromCorners(a: BlockPos, b: BlockPos): SelectionVolume {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    minZ: Math.min(a.z, b.z),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
    maxZ: Math.max(a.z, b.z),
  };
}

export function volumeContains(volume: SelectionVolume, x: number, y: number, z: number): boolean {
  return x >= volume.minX && x <= volume.maxX
    && y >= volume.minY && y <= volume.maxY
    && z >= volume.minZ && z <= volume.maxZ;
}

export class PlayerSelectionService {
  private readonly selections = new Map<string, PlayerSelection>();

  set(playerId: string, slot: 1 | 2, pos: BlockPos): void {
    const current = this.selections.get(playerId) ?? {};
    if (slot === 1) current.pos1 = pos;
    else current.pos2 = pos;
    this.selections.set(playerId, current);
  }

  get(playerId: string): PlayerSelection {
    return { ...(this.selections.get(playerId) ?? {}) };
  }

  volume(playerId: string): SelectionVolume | undefined {
    const current = this.selections.get(playerId);
    if (!current?.pos1 || !current.pos2) return undefined;
    return volumeFromCorners(current.pos1, current.pos2);
  }

  clear(playerId: string): void {
    this.selections.delete(playerId);
  }
}
