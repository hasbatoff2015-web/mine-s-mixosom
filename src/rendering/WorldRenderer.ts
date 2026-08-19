import * as THREE from 'three';
import { chunkKey } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { ChunkMesher, type BlockRenderStateResolver } from './ChunkMesher';
import type { TextureAtlas } from './TextureAtlas';

interface ChunkVisual {
  group: THREE.Group;
  faces: number;
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly selection: THREE.LineSegments;
  private readonly chunks = new Map<string, ChunkVisual>();
  private readonly mesher: ChunkMesher;
  private readonly opaqueMaterial: THREE.MeshLambertMaterial;
  private readonly cutoutMaterial: THREE.MeshLambertMaterial;
  private readonly vegetationMaterial: THREE.MeshLambertMaterial;
  private readonly glassMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshLambertMaterial;
  meshSamples = 0;
  meshTotalMs = 0;
  meshMaximumMs = 0;

  constructor(
    private readonly world: VoxelWorld,
    atlas: TextureAtlas,
    resolveState?: BlockRenderStateResolver,
  ) {
    this.group.name = 'voxel-world';
    this.mesher = new ChunkMesher(atlas, resolveState);
    this.opaqueMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
    this.cutoutMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.42,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.vegetationMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.42,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    this.glassMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      alphaTest: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const selectionGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008));
    this.selection = new THREE.LineSegments(selectionGeometry, new THREE.LineBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.95 }));
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.group.add(this.selection);
  }

  get cutoutSide(): THREE.Side {
    return this.cutoutMaterial.side;
  }

  get vegetationSide(): THREE.Side {
    return this.vegetationMaterial.side;
  }

  rebuildDirty(maxChunks = 2, timeBudgetMs = 7): number {
    const start = performance.now();
    let rebuilt = 0;
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.dirty || rebuilt >= maxChunks) continue;
      this.rebuild(chunk);
      rebuilt += 1;
      if (performance.now() - start >= timeBudgetMs) break;
    }
    return rebuilt;
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
    this.chunks.set(key, { group, faces: meshed.faces });
    chunk.dirty = false;
    const meshMilliseconds = performance.now() - meshStart;
    this.meshSamples += 1;
    this.meshTotalMs += meshMilliseconds;
    this.meshMaximumMs = Math.max(this.meshMaximumMs, meshMilliseconds);
  }

  removeChunks(keys: readonly string[]): void {
    for (const key of keys) this.removeChunk(key);
  }

  setTarget(hit?: VoxelHit): void {
    this.selection.visible = hit !== undefined;
    if (hit) this.selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
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
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.opaqueMaterial.dispose();
    this.cutoutMaterial.dispose();
    this.vegetationMaterial.dispose();
    this.glassMaterial.dispose();
    this.waterMaterial.dispose();
  }

  private removeChunk(key: string): void {
    const existing = this.chunks.get(key);
    if (!existing) return;
    this.group.remove(existing.group);
    for (const child of existing.group.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    this.chunks.delete(key);
  }
}
