import * as THREE from 'three';
import { getBlockDefinition } from '../blocks';
import type { HorizontalFacing } from '../blocks';
import { CHUNK_SIZE, MESH_SECTION_HEIGHT, chunkKey, floorDiv } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { lightContextReady } from '../world/worldJobs';
import { meshJobSortScore, meshWaitMs } from '../world/streamingScheduler';
import { ChunkMesher, type BlockRenderStateResolver } from './ChunkMesher';
import { ChestRenderer, type ChestRenderCell } from './ChestRenderer';
import { chestTextureKeyForBlock } from './chestModel';
import { BlockBreakingOverlay, type BreakingOverlaySnapshot } from './BlockBreakingOverlay';
import { RemoteBreakingOverlays } from './RemoteBreakingOverlays';
import {
  createSelectionGeometry,
  resolveStairShape,
  selectionBoxesForBlock,
  selectionShapeKey,
} from './specialBlockGeometry';
import type { TextureAtlas } from './TextureAtlas';
import { createWorldChunkMaterial, setWorldDaylight } from './worldLighting';
import { SharedFireTexture } from './fireTexture';
import { SignRenderer } from './SignRenderer';

interface ChunkVisual {
  group: THREE.Group;
  sections: Map<number, THREE.Group>;
  faces: number;
  chests: Array<{ x: number; y: number; z: number }>;
}

interface MeshJob {
  key: string;
  minSection: number;
  maxSection: number;
  nextSection: number;
  partial: boolean;
  revision: string;
  startedAt: number;
  cpuMs: number;
  contentVersion: number;
  lightVersion: number;
  stale: boolean;
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly selection: THREE.LineSegments;
  readonly breaking: BlockBreakingOverlay;
  readonly remoteBreaking: RemoteBreakingOverlays;
  readonly chests = new ChestRenderer();
  readonly signs: SignRenderer;
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
  meshSectionSamples = 0;
  meshSectionTotalMs = 0;
  meshSectionMaximumMs = 0;
  meshJobMaximumMs = 0;
  lastRebuildSections = 0;
  private readonly meshJobs = new Map<string, MeshJob>();

  constructor(
    private readonly world: VoxelWorld,
    atlas: TextureAtlas,
    resolveState: BlockRenderStateResolver = () => undefined,
  ) {
    this.group.name = 'voxel-world';
    this.resolveState = resolveState;
    this.signs = new SignRenderer(world, (key) => this.chunks.has(key));
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
    this.remoteBreaking = new RemoteBreakingOverlays(world, this.breaking, resolveState,
      (x, z) => this.chunks.has(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))));
    this.group.add(this.remoteBreaking.group);
    this.group.add(this.breaking.group);
    this.group.add(this.selection);
    this.group.add(this.chests.group);
    this.group.add(this.signs.group);
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
      counters?: { attempted: number; completed: number; skippedBlocked: number; sections?: number };
      onMeshStart?: (chunk: Chunk) => void;
      onMeshComplete?: (chunk: Chunk) => void;
      dirX?: number;
      dirZ?: number;
      maxSections?: number;
      now?: () => number;
      onSectionWork?: () => void;
    } = {},
  ): number {
    const nowFn = options.now ?? (() => performance.now());
    const start = nowFn();
    const centerX = originX === undefined ? this.world.viewChunkX : floorDiv(originX, CHUNK_SIZE);
    const centerZ = originZ === undefined ? this.world.viewChunkZ : floorDiv(originZ, CHUNK_SIZE);
    const meshRadius = options.meshRadius;
    const requireNeighborLight = options.requireNeighborLight === true;
    const allowPendingLighting = options.allowPendingLighting === true;
    const preferKeys = options.preferKeys;
    const counters = options.counters;
    const dirX = options.dirX ?? 0;
    const dirZ = options.dirZ ?? 0;
    const now = nowFn();
    if (meshRadius !== undefined) this.cancelObsoleteMeshJobs(centerX, centerZ, meshRadius);
    const dirty: Chunk[] = [];
    for (const chunk of this.world.chunks.values()) {
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
    let sectionsThisFrame = 0;
    this.lastRebuildSections = 0;
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
      if (sectionsThisFrame > 0 && nowFn() - start >= timeBudgetMs) break;
      if (counters) counters.attempted += 1;
      const visual = this.ensureVisual(chunk);
      const job = this.ensureMeshJob(chunk, visual);
      if (job.nextSection === job.minSection && job.cpuMs === 0) options.onMeshStart?.(chunk);
      while (job.nextSection <= job.maxSection) {
        if (sectionsThisFrame > 0 && nowFn() - start >= timeBudgetMs) break;
        if (options.maxSections !== undefined && sectionsThisFrame >= options.maxSections) break;
        options.onSectionWork?.();
        const sectionStart = performance.now();
        this.rebuildSection(chunk, visual, job.nextSection);
        const sectionMs = performance.now() - sectionStart;
        this.meshSectionSamples += 1;
        this.meshSectionTotalMs += sectionMs;
        this.meshSectionMaximumMs = Math.max(this.meshSectionMaximumMs, sectionMs);
        job.cpuMs += sectionMs;
        job.nextSection += 1;
        sectionsThisFrame += 1;
        this.lastRebuildSections += 1;
        if (counters && counters.sections !== undefined) counters.sections += 1;
        this.refreshVisualMeta(visual);
      }
      if (job.nextSection <= job.maxSection) break;
      this.finalizeMeshJob(chunk, visual, job);
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
    this.lastRebuildSections = 0;
    const visual = this.ensureVisual(chunk);
    const job = this.ensureMeshJob(chunk, visual);
    while (job.nextSection <= job.maxSection) {
      const sectionStart = performance.now();
      this.rebuildSection(chunk, visual, job.nextSection);
      job.cpuMs += performance.now() - sectionStart;
      job.nextSection += 1;
      this.lastRebuildSections += 1;
    }
    this.finalizeMeshJob(chunk, visual, job);
  }

  meshJobDebug(key: string): {
    minSection: number;
    maxSection: number;
    nextSection: number;
    stale: boolean;
    contentVersion: number;
  } | undefined {
    const job = this.meshJobs.get(key);
    if (!job) return undefined;
    return {
      minSection: job.minSection,
      maxSection: job.maxSection,
      nextSection: job.nextSection,
      stale: job.stale,
      contentVersion: job.contentVersion,
    };
  }

  sectionChests(key: string, section: number): Array<{ x: number; y: number; z: number }> {
    const chests = this.chunks.get(key)?.sections.get(section)?.userData.chests;
    return Array.isArray(chests) ? chests as Array<{ x: number; y: number; z: number }> : [];
  }

  get pendingMeshJobCount(): number {
    return this.meshJobs.size;
  }

  get meshSectionAverageMs(): number {
    return this.meshSectionTotalMs / Math.max(1, this.meshSectionSamples);
  }

  cancelObsoleteMeshJobs(centerChunkX: number, centerChunkZ: number, meshRadius: number): number {
    let removed = 0;
    for (const [key, job] of [...this.meshJobs]) {
      const comma = key.indexOf(',');
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      const wanted = Math.max(Math.abs(cx - centerChunkX), Math.abs(cz - centerChunkZ)) <= meshRadius;
      if (wanted) continue;
      this.meshJobs.delete(key);
      removed += 1;
      void job;
    }
    return removed;
  }

  private meshRevision(chunk: Chunk, minSection: number, maxSection: number, partial: boolean): string {
    return [
      chunk.lightVersion,
      chunk.dirty ? 1 : 0,
      chunk.meshDirtyAllY ? 1 : 0,
      chunk.meshDirtyMinY,
      chunk.meshDirtyMaxY,
      minSection,
      maxSection,
      partial ? 1 : 0,
    ].join(':');
  }

  private ensureVisual(chunk: Chunk): ChunkVisual {
    const key = chunkKey(chunk.x, chunk.z);
    let visual = this.chunks.get(key);
    if (visual) return visual;
    visual = {
      group: new THREE.Group(),
      sections: new Map(),
      faces: 0,
      chests: [],
    };
    visual.group.name = `chunk-${key}`;
    this.group.add(visual.group);
    this.chunks.set(key, visual);
    return visual;
  }

  private ensureMeshJob(chunk: Chunk, visual: ChunkVisual): MeshJob {
    const key = chunkKey(chunk.x, chunk.z);
    const maxY = chunk.scanMaxY();
    const lightRebake = chunk.lightMeshStale && !chunk.dirty;
    const range = lightRebake || !visual.sections.size
      ? { minSection: 0, maxSection: Math.floor(Math.max(0, maxY) / MESH_SECTION_HEIGHT), partial: false }
      : chunk.meshSectionRange(maxY);
    const revision = this.meshRevision(chunk, range.minSection, range.maxSection, range.partial);
    const existing = this.meshJobs.get(key);
    if (existing && existing.nextSection <= existing.maxSection) {
      if (range.maxSection > existing.maxSection) existing.maxSection = range.maxSection;
      if (range.minSection < existing.minSection) existing.stale = true;
      if (chunk.meshContentVersion !== existing.contentVersion) existing.stale = true;
      if (chunk.lightVersion !== existing.lightVersion) existing.stale = true;
      existing.partial = existing.partial && range.partial;
      existing.revision = revision;
      return existing;
    }
    const job: MeshJob = {
      key,
      minSection: range.minSection,
      maxSection: range.maxSection,
      nextSection: range.minSection,
      partial: range.partial,
      revision,
      startedAt: performance.now(),
      cpuMs: 0,
      contentVersion: chunk.meshContentVersion,
      lightVersion: chunk.lightVersion,
      stale: false,
    };
    this.meshJobs.set(key, job);
    return job;
  }

  private finalizeMeshJob(chunk: Chunk, visual: ChunkVisual, job: MeshJob): void {
    if (!job.partial) {
      for (const [section, group] of [...visual.sections.entries()]) {
        if (section < job.minSection || section > job.maxSection) {
          this.disposeSection(visual, section, group);
        }
      }
    }
    this.refreshVisualMeta(visual);
    this.signs.invalidateVisibility();
    const stale = job.stale
      || chunk.meshContentVersion !== job.contentVersion
      || chunk.lightVersion !== job.lightVersion;
    const jobMs = job.cpuMs;
    this.meshJobMaximumMs = Math.max(this.meshJobMaximumMs, jobMs);
    this.meshSamples += 1;
    this.meshTotalMs += jobMs;
    this.meshMaximumMs = Math.max(this.meshMaximumMs, jobMs);
    this.meshJobs.delete(job.key);
    if (stale) {
      chunk.dirty = true;
      return;
    }
    chunk.dirty = false;
    chunk.meshedLightVersion = chunk.lightVersion;
    this.world.acknowledgeMeshed(chunk);
  }

  private refreshVisualMeta(visual: ChunkVisual): void {
    visual.faces = 0;
    visual.chests = [];
    for (const group of visual.sections.values()) {
      visual.faces += (group.userData.faces as number) ?? 0;
      const chests = group.userData.chests as Array<{ x: number; y: number; z: number }> | undefined;
      if (chests) visual.chests.push(...chests);
    }
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
    this.remoteBreaking.update(performance.now());
  }

  debugBreakingOverlay(): BreakingOverlaySnapshot {
    return this.breaking.snapshot();
  }

  setOpenChest(key?: string): void {
    this.chests.setOpenTarget(key);
  }

  updateChests(dtSeconds: number): void {
    this.signs.sync();
    const cells: ChestRenderCell[] = [];
    for (const visual of this.chunks.values()) {
      for (const chest of visual.chests) {
        cells.push({
          ...chest,
          facing: this.resolveState(chest.x, chest.y, chest.z)?.facing as HorizontalFacing | undefined,
          textureKey: chestTextureKeyForBlock(this.world.getBlock(chest.x, chest.y, chest.z, false)),
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

  sectionCount(key: string): number {
    return this.chunks.get(key)?.sections.size ?? 0;
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.meshJobs.clear();
    this.group.remove(this.selection);
    (this.selection.material as THREE.Material).dispose();
    for (const geometry of this.selectionGeometries.values()) geometry.dispose();
    this.selectionGeometries.clear();
    this.group.remove(this.breaking.group);
    this.breaking.dispose();
    this.remoteBreaking.dispose();
    this.opaqueMaterial.dispose();
    this.cutoutMaterial.dispose();
    this.vegetationMaterial.dispose();
    this.glassMaterial.dispose();
    this.waterMaterial.dispose();
    this.chests.dispose();
    this.signs.dispose();
  }

  private removeChunk(key: string): void {
    this.meshJobs.delete(key);
    const existing = this.chunks.get(key);
    if (!existing) return;
    this.group.remove(existing.group);
    for (const section of existing.sections.values()) this.disposeObject3D(section);
    this.disposeObject3D(existing.group);
    this.chunks.delete(key);
    this.signs.invalidateVisibility();
  }

  private rebuildSection(chunk: Chunk, visual: ChunkVisual, section: number): void {
    const minY = section * MESH_SECTION_HEIGHT;
    const maxY = minY + MESH_SECTION_HEIGHT - 1;
    const meshed = this.mesher.build(chunk, this.world, { minY, maxY });
    const group = new THREE.Group();
    group.name = `chunk-section-${chunk.x},${chunk.z}:${section}`;
    this.attachLayer(group, meshed.opaque, this.opaqueMaterial, 0);
    this.attachLayer(group, meshed.cutout, this.cutoutMaterial, 1);
    this.attachLayer(group, meshed.vegetation, this.vegetationMaterial, 1);
    this.attachLayer(group, meshed.translucent, this.glassMaterial, 2);
    this.attachLayer(group, meshed.water, this.waterMaterial, 3);
    this.attachLayer(group, meshed.fire, SharedFireTexture.instance().material, 4);
    group.userData.faces = meshed.faces;
    group.userData.chests = meshed.chests;
    const existing = visual.sections.get(section);
    visual.group.add(group);
    visual.sections.set(section, group);
    if (existing) this.disposeSection(visual, section, existing, false);
  }

  private attachLayer(
    group: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    renderOrder: number,
  ): void {
    if (geometry.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = renderOrder;
      group.add(mesh);
      return;
    }
    geometry.dispose();
  }

  private disposeSection(visual: ChunkVisual, section: number, group: THREE.Group, removeFromMap = true): void {
    visual.group.remove(group);
    this.disposeObject3D(group);
    if (removeFromMap && visual.sections.get(section) === group) visual.sections.delete(section);
  }

  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
  }
}
