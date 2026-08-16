import * as THREE from 'three';
import { chunkKey } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { ChunkMesher } from './ChunkMesher';
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
  private readonly transparentMaterial: THREE.MeshLambertMaterial;

  constructor(private readonly world: VoxelWorld, atlas: TextureAtlas) {
    this.group.name = 'voxel-world';
    this.mesher = new ChunkMesher(atlas);
    this.opaqueMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.1 });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.76,
      alphaTest: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const selectionGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008));
    this.selection = new THREE.LineSegments(selectionGeometry, new THREE.LineBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.95 }));
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.group.add(this.selection);
  }

  rebuildDirty(maxChunks = 2): number {
    let rebuilt = 0;
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.dirty || rebuilt >= maxChunks) continue;
      this.rebuild(chunk);
      rebuilt += 1;
    }
    return rebuilt;
  }

  rebuild(chunk: Chunk): void {
    const key = chunkKey(chunk.x, chunk.z);
    this.removeChunk(key);
    const meshed = this.mesher.build(chunk, this.world);
    const group = new THREE.Group();
    group.name = `chunk-${key}`;
    if (meshed.opaque.getAttribute('position').count > 0) group.add(new THREE.Mesh(meshed.opaque, this.opaqueMaterial));
    else meshed.opaque.dispose();
    if (meshed.transparent.getAttribute('position').count > 0) {
      const mesh = new THREE.Mesh(meshed.transparent, this.transparentMaterial);
      mesh.renderOrder = 2;
      group.add(mesh);
    } else meshed.transparent.dispose();
    this.group.add(group);
    this.chunks.set(key, { group, faces: meshed.faces });
    chunk.dirty = false;
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

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
  }

  private removeChunk(key: string): void {
    const existing = this.chunks.get(key);
    if (!existing) return;
    this.group.remove(existing.group);
    for (const child of existing.group.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    this.chunks.delete(key);
  }
}
