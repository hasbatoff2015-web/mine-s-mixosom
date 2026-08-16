import * as THREE from 'three';
import { BlockId, getBlockDefinition, type BlockDefinition } from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelWorld } from '../world/World';
import type { TextureAtlas } from './TextureAtlas';

interface Face {
  normal: readonly [number, number, number];
  corners: readonly (readonly [number, number, number])[];
  shade: number;
  texture: 'top' | 'bottom' | 'side' | 'front';
}

const FACES: readonly Face[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.82, texture: 'side' },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.72, texture: 'side' },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1, texture: 'top' },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, texture: 'bottom' },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.88, texture: 'side' },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.76, texture: 'front' },
];

interface GeometryBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

const createBuffers = (): GeometryBuffers => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });

export interface MeshedChunk {
  opaque: THREE.BufferGeometry;
  transparent: THREE.BufferGeometry;
  faces: number;
}

export class ChunkMesher {
  constructor(private readonly atlas: TextureAtlas) {}

  build(chunk: Chunk, world: VoxelWorld): MeshedChunk {
    const opaque = createBuffers();
    const transparent = createBuffers();
    let faces = 0;
    for (let y = 0; y < chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE); y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = chunk.get(x, y, z) as BlockId;
          if (block === BlockId.Air) continue;
          const definition = getBlockDefinition(block);
          const worldX = chunk.x * CHUNK_SIZE + x;
          const worldZ = chunk.z * CHUNK_SIZE + z;
          const target = definition.opaque ? opaque : transparent;
          for (const face of FACES) {
            const adjacent = world.getBlock(worldX + face.normal[0], y + face.normal[1], worldZ + face.normal[2], false);
            const adjacentDefinition = getBlockDefinition(adjacent);
            if (adjacent !== BlockId.Air && adjacentDefinition.opaque) continue;
            if (!definition.opaque && adjacent === block) continue;
            this.addFace(target, definition, face, world, worldX, y, worldZ);
            faces += 1;
          }
        }
      }
    }
    return { opaque: this.toGeometry(opaque), transparent: this.toGeometry(transparent), faces };
  }

  private addFace(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    face: Face,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): void {
    const base = buffers.positions.length / 3;
    const textureKey = this.textureForFace(definition, face.texture);
    const tile = this.atlas.tile(textureKey);
    const uv = [[tile.u0, tile.v0], [tile.u1, tile.v0], [tile.u1, tile.v1], [tile.u0, tile.v1]] as const;
    const surface = world.generator.columnAt(x, z).height;
    const caveLight = y + face.normal[1] >= surface - 1 ? 1 : 0.34 + Math.max(0, y / 200);
    const emission = Math.max(0, Math.min(1, (definition.emission ?? 0) / 15));
    const light = Math.max(caveLight, emission) * face.shade;
    const tint = this.tintFor(textureKey, world.biomeAt(x, z));
    for (let index = 0; index < 4; index += 1) {
      const corner = face.corners[index]!;
      buffers.positions.push(x + corner[0], y + corner[1], z + corner[2]);
      buffers.normals.push(...face.normal);
      buffers.uvs.push(...uv[index]!);
      buffers.colors.push(tint[0] * light, tint[1] * light, tint[2] * light);
    }
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private textureForFace(definition: BlockDefinition, face: Face['texture']): string {
    const textures = definition.textures;
    if (face === 'top') return textures.top ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'bottom') return textures.bottom ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'front') return textures.front ?? textures.side ?? textures.all ?? 'block/missing';
    return textures.side ?? textures.all ?? textures.top ?? 'block/missing';
  }

  private tintFor(texture: string, biome: string): readonly [number, number, number] {
    if (!texture.includes('grass_block_top') && !texture.includes('leaves')) return [1, 1, 1];
    if (biome === 'forest') return [0.42, 0.78, 0.36];
    if (biome === 'desert') return [0.74, 0.78, 0.4];
    return [0.54, 0.9, 0.42];
  }

  private toGeometry(buffers: GeometryBuffers): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(buffers.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
