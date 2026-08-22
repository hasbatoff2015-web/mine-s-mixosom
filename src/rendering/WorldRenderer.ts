import * as THREE from 'three';
import { getBlockDefinition } from '../blocks';
import type { HorizontalFacing } from '../blocks';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { ChunkMesher, type BlockRenderStateResolver } from './ChunkMesher';
import { ChestRenderer } from './ChestRenderer';
import {
  createSelectionGeometry,
  resolveStairShape,
  selectionBoxesForBlock,
  selectionShapeKey,
} from './specialBlockGeometry';
import type { TextureAtlas } from './TextureAtlas';
import { createWorldChunkMaterial, setWorldDaylight } from './worldLighting';

interface ChunkVisual {
  group: THREE.Group;
  faces: number;
  chests: Array<{ x: number; y: number; z: number }>;
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly selection: THREE.LineSegments;
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
    this.group.add(this.selection);
    this.group.add(this.chests.group);
  }

  get cutoutSide(): THREE.Side {
    return this.cutoutMaterial.side;
  }

  get vegetationSide(): THREE.Side {
    return this.vegetationMaterial.side;
  }

  rebuildDirty(maxChunks = 2, timeBudgetMs = 7, originX?: number, originZ?: number): number {
    const start = performance.now();
    const dirty: Chunk[] = [];
    for (const chunk of this.world.chunks.values()) {
      if (chunk.dirty) dirty.push(chunk);
    }
    if (originX !== undefined && originZ !== undefined) {
      const cx = floorDiv(originX, CHUNK_SIZE);
      const cz = floorDiv(originZ, CHUNK_SIZE);
      dirty.sort((a, b) => {
        const da = (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz);
        const db = (b.x - cx) * (b.x - cx) + (b.z - cz) * (b.z - cz);
        return da - db;
      });
    }
    let rebuilt = 0;
    for (const chunk of dirty) {
      if (rebuilt >= maxChunks) break;
      if (!chunk.skyReady || !chunk.blockLightReady) continue;
      if (rebuilt > 0 && performance.now() - start >= timeBudgetMs) break;
      this.rebuild(chunk);
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
    const meshed = this.mesher.build(chunk, this.world);
    const group = new THREE.Group();
    group.name = `chunk-${key}`;
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
    this.group.add(group);
    this.chunks.set(key, { group, faces: meshed.faces, chests: meshed.chests });
    chunk.dirty = false;
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
