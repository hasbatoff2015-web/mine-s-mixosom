import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';

export class Chunk {
  readonly blocks = new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  /** Generation-time terrain column cache reused by meshing and biome tint. */
  readonly surfaceHeights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  /** 0 plains, 1 forest, 2 desert. */
  readonly biomeCodes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  dirty = true;
  generated = false;
  lastTouched = performance.now();

  constructor(readonly x: number, readonly z: number) {}

  static index(x: number, y: number, z: number): number {
    return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[Chunk.index(x, y, z)] ?? 0;
  }

  set(x: number, y: number, z: number, block: number): void {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[Chunk.index(x, y, z)] = block;
    this.dirty = true;
  }
}
