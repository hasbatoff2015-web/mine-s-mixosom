import { CHUNK_SIZE, MESH_SECTION_HEIGHT, WORLD_HEIGHT } from '../core/constants';

export class Chunk {
  readonly blocks = new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  /** Stored sky through each column's materialized extent; higher sky is implicit 15. Use skyLightAtIndex. */
  readonly skyLight = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  /** Packed 0–15 block light from emissive sources. */
  readonly blockLight = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  /** Highest sky filter + 1 per column; frontier scans skip uniformly open sky above it. */
  readonly skyFilterHeights = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  /** Stored sky extent per column. Zero means not filled; growth by transparent blocks keeps upper sky implicit. */
  readonly skyStoredHeights = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  /** Generation-time terrain column cache reused by meshing and biome tint. */
  readonly surfaceHeights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  /** 0 plains, 1 forest, 2 desert, 3 snowy_plains. */
  readonly biomeCodes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  /**
   * Highest non-air Y written into this chunk (conservative: never shrinks).
   * Sky/emitter/fluid/mesh scans use this instead of walking empty Y=85..255.
   */
  occupancyTop = 0;
  /** Conservative high-water mark of block light, including spill above occupied geometry. */
  blockLightTop = 0;
  dirty = true;
  generated = false;
  skyReady = false;
  skyLateralReady = false;
  blockLightReady = false;
  /** In-place light work may not be baked into a mesh until its job commits. */
  lightPending = false;
  /** Boundary readers affected by the last committed light change (eight neighbor bits). */
  changedLightBorders = 0;
  /** Incremented once per lighting job that changes this chunk's light arrays. */
  lightVersion = 0;
  /** Light version baked into the current mesh. `-1` = never meshed. */
  meshedLightVersion = -1;
  /** 0..256 column cursor for resumable sky fill. */
  skyFillCursor = 0;
  /** 0..256 column cursor for resumable block-light emitter scan. */
  blockScanCursor = 0;
  lastTouched = performance.now();
  /** Monotonic time when this chunk became ready-to-mesh while still dirty. 0 = unset. */
  readyToMeshAt = 0;
  /**
   * Inclusive dirty Y range for partial remesh. When `meshDirtyAllY` is true the
   * next rebuild covers the occupied column (generation, light rebake, unknown Y).
   */
  meshDirtyMinY = 0;
  meshDirtyMaxY = WORLD_HEIGHT - 1;
  meshDirtyAllY = true;
  /**
   * Monotonic counter of mesh-relevant content changes (block ID, render
   * state, light-driven remesh marks). Independent of the dirty Y range so a
   * mutation inside an already-queued range cannot reuse a stale MeshJob.
   */
  meshContentVersion = 0;

  constructor(readonly x: number, readonly z: number) {}

  static index(x: number, y: number, z: number): number {
    return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
  }

  static yFromIndex(index: number): number {
    return Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
  }

  /** Inclusive Y to scan for occupied cells. Empty sky above this is implicit air. */
  scanMaxY(): number {
    return Math.min(WORLD_HEIGHT - 1, Math.max(0, this.occupancyTop));
  }

  skyLightAtIndex(index: number): number {
    const columns = CHUNK_SIZE * CHUNK_SIZE;
    const height = this.skyStoredHeights[index % columns] || this.occupancyTop + 1;
    return index >= height * columns ? 15 : this.skyLight[index]!;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[Chunk.index(x, y, z)] ?? 0;
  }

  set(x: number, y: number, z: number, block: number): void {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    this.writeIndex(Chunk.index(x, y, z), block);
  }

  writeIndex(index: number, block: number): void {
    this.blocks[index] = block;
    if (block !== 0) {
      const y = Chunk.yFromIndex(index);
      if (y > this.occupancyTop) this.occupancyTop = y;
    }
    this.dirty = true;
  }

  get lightingReady(): boolean {
    return this.skyReady && this.skyLateralReady && this.blockLightReady;
  }

  get lightMeshStale(): boolean {
    return this.meshedLightVersion !== this.lightVersion;
  }

  bumpLightVersion(): void {
    this.lightVersion += 1;
  }

  bumpMeshContentVersion(): void {
    this.meshContentVersion += 1;
  }

  noteMeshDirtyY(y: number): void {
    if (this.meshDirtyAllY) return;
    const clamped = Math.min(WORLD_HEIGHT - 1, Math.max(0, y | 0));
    if (this.meshDirtyMaxY < this.meshDirtyMinY) {
      this.meshDirtyMinY = clamped;
      this.meshDirtyMaxY = clamped;
      return;
    }
    this.meshDirtyMinY = Math.min(this.meshDirtyMinY, clamped);
    this.meshDirtyMaxY = Math.max(this.meshDirtyMaxY, clamped);
  }

  noteMeshDirtyAllY(): void {
    this.meshDirtyAllY = true;
    this.meshDirtyMinY = 0;
    this.meshDirtyMaxY = WORLD_HEIGHT - 1;
  }

  clearMeshDirtyRange(): void {
    this.meshDirtyAllY = false;
    this.meshDirtyMinY = WORLD_HEIGHT;
    this.meshDirtyMaxY = -1;
  }

  meshSectionRange(maxY = this.scanMaxY()): { minSection: number; maxSection: number; partial: boolean } {
    if (this.meshDirtyAllY || this.meshDirtyMaxY < this.meshDirtyMinY) {
      return {
        minSection: 0,
        maxSection: Math.floor(Math.max(0, maxY) / MESH_SECTION_HEIGHT),
        partial: false,
      };
    }
    const minY = Math.max(0, this.meshDirtyMinY - 1);
    const maxDirty = Math.min(maxY, this.meshDirtyMaxY + 1);
    return {
      minSection: Math.floor(minY / MESH_SECTION_HEIGHT),
      maxSection: Math.floor(Math.max(minY, maxDirty) / MESH_SECTION_HEIGHT),
      partial: true,
    };
  }
}
