import * as THREE from 'three';
import { getBlockDefinition } from '../blocks';
import type { HorizontalFacing } from '../blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { lightContextReady } from '../world/worldJobs';
import { meshJobSortScore, meshWaitMs } from '../world/streamingScheduler';
import { ChunkMesher, CHEAP_VERTEX_LIGHT_CHEBYSHEV, type BlockRenderStateResolver } from './ChunkMesher';
import { ChestRenderer } from './ChestRenderer';
import { BlockBreakingOverlay, type BreakingOverlaySnapshot } from './BlockBreakingOverlay';
import {
  createSelectionGeometry,
  resolveStairShape,
  selectionBoxesForBlock,
  selectionShapeKey,
} from './specialBlockGeometry';
import type { TextureAtlas } from './TextureAtlas';
import { createWorldChunkMaterial, setWorldDaylight } from './worldLighting';
import { SharedFireTexture } from './fireTexture';

interface ChunkVisual {
  group: THREE.Group;
  faces: number;
  chests: Array<{ x: number; y: number; z: number }>;
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly selection: THREE.LineSegments;
  readonly breaking: BlockBreakingOverlay;
  readonly chests = new ChestRenderer();
  private readonly chunks = new Map<string, ChunkVisual>();
  private readonly mesher: ChunkMesher;
  private readonly resolveState: BlockRenderStateResolver;
  private readonly opaqueMaterial: THREE.MeshBasicMaterial;
  private readonly cutoutMaterial: THREE.MeshBasicMaterial;
  private readonly vegetationMaterial: THREE.MeshBasicMaterial;
  private readonly glassMaterial: THREE.MeshBasicMaterial;
  private readonly waterMaterial: THREE.MeshBasicMaterial;
  private readonly selectionGeometries = new Map<string, THREE.BufferGeometry>();
  private selectionKey = '';
  meshSamples = 0;
  meshTotalMs = 0;
  meshMaximumMs = 0;

  constructor(
    private readonly world: VoxelWorld,
    atlas: TextureAtlas,
    resolveState: BlockRenderStateResolver = () => undefined,
  ) {
    this.group.name = 'voxel-world';
    this.resolveState = resolveState;
    this.mesher = new ChunkMesher(atlas, resolveState);
    this.opaqueMaterial = createWorldChunkMaterial(atlas);
    this.cutoutMaterial = createWorldChunkMaterial(atlas, {
      alphaTest: 0.42,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.vegetationMaterial = createWorldChunkMaterial(atlas, {
      alphaTest: 0.42,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    this.glassMaterial = createWorldChunkMaterial(atlas, {
      transparent: true,
      opacity: 0.52,
      alphaTest: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.waterMaterial = createWorldChunkMaterial(atlas, {
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cubeKey = selectionShapeKey({ renderShape: 'cube' }, undefined);
    const cubeGeometry = createSelectionGeometry(selectionBoxesForBlock({ renderShape: 'cube' }));
    this.selectionGeometries.set(cubeKey, cubeGeometry);
    this.selectionKey = cubeKey;
    this.selection = new THREE.LineSegments(
      cubeGeometry,
      new THREE.LineBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.95 }),
    );
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.selection.matrixAutoUpdate = false;
    this.breaking = new BlockBreakingOverlay(world, resolveState);
    this.group.add(this.breaking.group);
    this.group.add(this.selection);
    this.group.add(this.chests.group);
  }

  get cutoutSide(): THREE.Side {
    return this.cutoutMaterial.side;
  }

  get vegetationSide(): THREE.Side {
    return this.vegetationMaterial.side;
  }

  rebuildDirty(
    maxChunks = 2,
    timeBudgetMs = 7,
    originX?: number,
    originZ?: number,
    options: {
      meshRadius?: number;
      requireNeighborLight?: boolean;
      allowPendingLighting?: boolean;
      preferKeys?: ReadonlySet<string>;
      counters?: { attempted: number; completed: number; skippedBlocked: number };
      onMeshStart?: (chunk: Chunk) => void;
      onMeshComplete?: (chunk: Chunk) => void;
      dirX?: number;
      dirZ?: number;
    } = {},
  ): number {
    const start = performance.now();
    const centerX = originX === undefined ? this.world.viewChunkX : floorDiv(originX, CHUNK_SIZE);
    const centerZ = originZ === undefined ? this.world.viewChunkZ : floorDiv(originZ, CHUNK_SIZE);
    const meshRadius = options.meshRadius;
    const requireNeighborLight = options.requireNeighborLight === true;
    const allowPendingLighting = options.allowPendingLighting === true;
    const preferKeys = options.preferKeys;
    const counters = options.counters;
    const dirX = options.dirX ?? 0;
    const dirZ = options.dirZ ?? 0;
    const now = performance.now();
    const dirty: Chunk[] = [];
    const candidates = options.preferKeys
      ? preferKeyChunks(this.world, options.preferKeys)
      : this.world.pendingMesh.size > 0
        ? pendingMeshChunks(this.world)
        : this.world.chunks.values();
    for (const chunk of candidates) {
      if (!chunk.dirty && !chunk.lightMeshStale) continue;
      if (preferKeys && !preferKeys.has(chunkKey(chunk.x, chunk.z))) continue;
      if (meshRadius !== undefined) {
        const distance = Math.max(Math.abs(chunk.x - centerX), Math.abs(chunk.z - centerZ));
        if (distance > meshRadius) continue;
      }
      dirty.push(chunk);
    }
    dirty.sort((a, b) => {
      const sa = meshJobSortScore(a.x, a.z, centerX, centerZ, dirX, dirZ, meshWaitMs(a, now));
      const sb = meshJobSortScore(b.x, b.z, centerX, centerZ, dirX, dirZ, meshWaitMs(b, now));
      return sa - sb;
    });
    let rebuilt = 0;
    for (const chunk of dirty) {
      if (rebuilt >= maxChunks) break;
      if (!chunk.lightingReady) {
        if (counters) {
          counters.attempted += 1;
          counters.skippedBlocked += 1;
        }
        continue;
      }
      if (!allowPendingLighting && this.world.hasPendingLighting(chunk)) {
        // Skip blocked head; keep scanning for a later ready chunk.
        if (counters) {
          counters.attempted += 1;
          counters.skippedBlocked += 1;
        }
        continue;
      }
      if (requireNeighborLight && !lightContextReady(
        this.world,
        chunk,
        centerX,
        centerZ,
        this.world.generationRadius,
      )) {
        if (counters) {
          counters.attempted += 1;
          counters.skippedBlocked += 1;
        }
        continue;
      }
      if (rebuilt > 0 && performance.now() - start >= timeBudgetMs) break;
      if (counters) counters.attempted += 1;
      options.onMeshStart?.(chunk);
      this.rebuild(chunk);
      options.onMeshComplete?.(chunk);
      if (counters) counters.completed += 1;
      rebuilt += 1;
    }
    return rebuilt;
  }

  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  rebuild(chunk: Chunk): void {
    const meshStart = performance.now();
    const key = chunkKey(chunk.x, chunk.z);
    this.removeChunk(key);
    const meshed = this.mesher.build(chunk, this.world, {
      cheapVertexLight: chunkChebyshev(chunk, this.world) >= CHEAP_VERTEX_LIGHT_CHEBYSHEV,
    });
    const group = new THREE.Group();
    group.name = `chunk-${key}`;
    group.matrixAutoUpdate = false;
    if (meshed.opaque.getAttribute('position').count > 0) group.add(new THREE.Mesh(meshed.opaque, this.opaqueMaterial));
    else meshed.opaque.dispose();
    if (meshed.cutout.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.cutout, this.cutoutMaterial);
      mesh.renderOrder = 1;
      group.add(mesh);
    } else meshed.cutout.dispose();
    if (meshed.vegetation.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.vegetation, this.vegetationMaterial);
      mesh.renderOrder = 1;
      group.add(mesh);
    } else meshed.vegetation.dispose();
    if (meshed.translucent.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.translucent, this.glassMaterial);
      mesh.renderOrder = 2;
      group.add(mesh);
    } else meshed.translucent.dispose();
    if (meshed.water.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.water, this.waterMaterial);
      mesh.renderOrder = 3;
      group.add(mesh);
    } else meshed.water.dispose();
    if (meshed.fire.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.fire, SharedFireTexture.instance().material);
      mesh.renderOrder = 4;
      group.add(mesh);
    } else meshed.fire.dispose();
    for (const child of group.children) {
      child.matrixAutoUpdate = false;
      child.updateMatrix();
    }
    group.updateMatrix();
    this.group.add(group);
    this.chunks.set(key, { group, faces: meshed.faces, chests: meshed.chests });
    chunk.dirty = false;
    chunk.meshedLightVersion = chunk.lightVersion;
    this.world.acknowledgeMeshed(chunk);
    const meshMilliseconds = performance.now() - meshStart;
    this.meshSamples += 1;
    this.meshTotalMs += meshMilliseconds;
    this.meshMaximumMs = Math.max(this.meshMaximumMs, meshMilliseconds);
  }

  removeChunks(keys: readonly string[]): void {
    for (const key of keys) this.removeChunk(key);
  }

  setDaylight(daylight: number): void {
    setWorldDaylight(daylight);
  }

  setTarget(hit?: VoxelHit): void {
    if (!hit) {
      this.selection.visible = false;
      return;
    }
    const definition = getBlockDefinition(hit.block);
    const state = this.resolveState(hit.x, hit.y, hit.z);
    const stairShape = definition.renderShape === 'stairs'
      ? resolveStairShape(this.world, hit.x, hit.y, hit.z, state)
      : '';
    const key = selectionShapeKey(definition, state, stairShape);
    if (key !== this.selectionKey) {
      let geometry = this.selectionGeometries.get(key);
      if (!geometry) {
        geometry = createSelectionGeometry(
          selectionBoxesForBlock(definition, state, 0, 0, 0, undefined, stairShape || 'straight'),
        );
        this.selectionGeometries.set(key, geometry);
      }
      this.selection.geometry = geometry;
      this.selectionKey = key;
    }
    this.selection.position.set(hit.x, hit.y, hit.z);
    this.selection.updateMatrix();
    this.selection.visible = true;
  }

  /**
   * Local-player crack overlay. Visual only: never remeshes chunks and never
   * writes blocks. Pass a missing hit or progress outside (0, 1) to hide.
   */
  setBreakingProgress(hit?: VoxelHit, progress = 0): void {
    this.breaking.setProgress(hit, progress);
  }

  debugBreakingOverlay(): BreakingOverlaySnapshot {
    return this.breaking.snapshot();
  }

  setOpenChest(key?: string): void {
    this.chests.setOpenTarget(key);
  }

  updateChests(dtSeconds: number): void {
    const cells: Array<{ x: number; y: number; z: number; facing?: HorizontalFacing }> = [];
    for (const visual of this.chunks.values()) {
      for (const chest of visual.chests) {
        cells.push({
          ...chest,
          facing: this.resolveState(chest.x, chest.y, chest.z)?.facing as HorizontalFacing | undefined,
        });
      }
    }
    this.chests.sync(cells, dtSeconds);
  }

  get faceCount(): number {
    let faces = 0;
    for (const chunk of this.chunks.values()) faces += chunk.faces;
    return faces;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get meshAverageMs(): number {
    return this.meshTotalMs / Math.max(1, this.meshSamples);
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.group.remove(this.selection);
    (this.selection.material as THREE.Material).dispose();
    for (const geometry of this.selectionGeometries.values()) geometry.dispose();
    this.selectionGeometries.clear();
    this.group.remove(this.breaking.group);
    this.breaking.dispose();
    this.opaqueMaterial.dispose();
    this.cutoutMaterial.dispose();
    this.vegetationMaterial.dispose();
    this.glassMaterial.dispose();
    this.waterMaterial.dispose();
    this.chests.dispose();
  }

  private removeChunk(key: string): void {
    const existing = this.chunks.get(key);
    if (!existing) return;
    this.group.remove(existing.group);
    for (const child of existing.group.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    this.chunks.delete(key);
  }
}

function chunkChebyshev(chunk: Chunk, world: VoxelWorld): number {
  return Math.max(Math.abs(chunk.x - world.viewChunkX), Math.abs(chunk.z - world.viewChunkZ));
}

function pendingMeshChunks(world: VoxelWorld): Chunk[] {
  const chunks: Chunk[] = [];
  for (const key of world.pendingMesh) {
    const chunk = world.chunks.get(key);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function preferKeyChunks(world: VoxelWorld, keys: ReadonlySet<string>): Chunk[] {
  const chunks: Chunk[] = [];
  for (const key of keys) {
    const chunk = world.chunks.get(key);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}
