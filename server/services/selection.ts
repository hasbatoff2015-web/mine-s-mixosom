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

export interface SelectionCuboidSize {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly blocks: number;
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

export function cuboidSizeOf(volume: SelectionVolume): SelectionCuboidSize {
  const width = volume.maxX - volume.minX + 1;
  const height = volume.maxY - volume.minY + 1;
  const depth = volume.maxZ - volume.minZ + 1;
  return { width, height, depth, blocks: width * height * depth };
}

export function formatCuboidSize(size: SelectionCuboidSize): string {
  return `${size.width} × ${size.height} × ${size.depth}`;
}

export function formatBlockPos(pos: BlockPos): string {
  return `${pos.x} ${pos.y} ${pos.z}`;
}

/**
 * Shared player cuboid selection. Claims/RTP still set pos1/pos2 explicitly.
 * Wand clicks cycle: first click → pos1, second → pos2, next click restarts at pos1.
 */
export class PlayerSelectionService {
  private readonly selections = new Map<string, PlayerSelection>();
  private readonly wandActive = new Set<string>();

  set(playerId: string, slot: 1 | 2, pos: BlockPos): void {
    const current = this.selections.get(playerId) ?? {};
    if (slot === 1) current.pos1 = pos;
    else current.pos2 = pos;
    this.selections.set(playerId, current);
  }

  /**
   * AutoMine-style wand click: first corner, second corner, then a new cycle.
   */
  click(playerId: string, pos: BlockPos): { slot: 1 | 2; volume?: SelectionVolume } {
    const current = this.selections.get(playerId) ?? {};
    const slot: 1 | 2 = !current.pos1 || (current.pos1 && current.pos2) ? 1 : 2;
    if (slot === 1) {
      current.pos1 = pos;
      current.pos2 = undefined;
    } else {
      current.pos2 = pos;
    }
    this.selections.set(playerId, current);
    return { slot, volume: current.pos1 && current.pos2 ? volumeFromCorners(current.pos1, current.pos2) : undefined };
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

  activateWand(playerId: string): void {
    this.wandActive.add(playerId);
  }

  deactivateWand(playerId: string): void {
    this.wandActive.delete(playerId);
  }

  isWandActive(playerId: string): boolean {
    return this.wandActive.has(playerId);
  }

  forget(playerId: string): void {
    this.selections.delete(playerId);
    this.wandActive.delete(playerId);
  }
}
