import * as THREE from 'three';
import {
  BlockId,
  getBlockDefinition,
  type BlockDefinition,
  type BlockRenderState,
  type HorizontalFacing,
} from '../blocks';
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

type TextureUvRect = readonly [u0: number, v0: number, u1: number, v1: number];

// The legacy lever tile is a transparent 16x16 sprite; the handle occupies
// logical x=7..9 and y=6..16. Crop that opaque strip before wrapping the cuboid.
const LEVER_HANDLE_UV: TextureUvRect = [7 / 16, 0, 9 / 16, 10 / 16];

interface LayerBuffers {
  opaque: GeometryBuffers;
  cutout: GeometryBuffers;
  translucent: GeometryBuffers;
  water: GeometryBuffers;
}

const createBuffers = (): GeometryBuffers => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });

export interface MeshedChunk {
  opaque: THREE.BufferGeometry;
  cutout: THREE.BufferGeometry;
  translucent: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
  faces: number;
}

export type BlockRenderStateResolver = (x: number, y: number, z: number) => BlockRenderState | undefined;

export function leverHandleAngle(powered: boolean): number {
  return powered ? -Math.PI * 0.28 : Math.PI * 0.28;
}

export class ChunkMesher {
  constructor(
    private readonly atlas: TextureAtlas,
    private readonly resolveState: BlockRenderStateResolver = () => undefined,
  ) {}

  build(chunk: Chunk, world: VoxelWorld): MeshedChunk {
    const layers: LayerBuffers = {
      opaque: createBuffers(),
      cutout: createBuffers(),
      translucent: createBuffers(),
      water: createBuffers(),
    };
    let faces = 0;
    for (let y = 0; y < chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE); y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = chunk.get(x, y, z) as BlockId;
          if (block === BlockId.Air) continue;
          const definition = getBlockDefinition(block);
          const worldX = chunk.x * CHUNK_SIZE + x;
          const worldZ = chunk.z * CHUNK_SIZE + z;
          const target = this.buffersFor(layers, definition);
          if (definition.renderShape !== 'cube') {
            faces += this.addSpecial(target, definition, this.resolveState(worldX, y, worldZ), world, worldX, y, worldZ);
            continue;
          }
          for (const face of FACES) {
            const adjacent = world.getBlock(worldX + face.normal[0], y + face.normal[1], worldZ + face.normal[2], false);
            const adjacentDefinition = getBlockDefinition(adjacent);
            if (adjacent !== BlockId.Air && adjacentDefinition.occludesFaces) continue;
            if (adjacent === block && adjacentDefinition.renderShape === 'cube') continue;
            this.addCubeFace(target, definition, face, world, worldX, y, worldZ);
            faces += 1;
          }
        }
      }
    }
    return {
      opaque: this.toGeometry(layers.opaque),
      cutout: this.toGeometry(layers.cutout),
      translucent: this.toGeometry(layers.translucent),
      water: this.toGeometry(layers.water),
      faces,
    };
  }

  private buffersFor(layers: LayerBuffers, definition: BlockDefinition): GeometryBuffers {
    if (definition.renderLayer === 'cutout') return layers.cutout;
    if (definition.renderLayer === 'translucent') {
      return definition.translucentMaterial === 'water' ? layers.water : layers.translucent;
    }
    return layers.opaque;
  }

  private addCubeFace(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    face: Face,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): void {
    const corners = face.corners.map((corner) => [x + corner[0], y + corner[1], z + corner[2]] as const);
    const textureKey = this.textureForFace(definition, face.texture);
    this.addQuad(buffers, textureKey, corners, face.normal, this.colorFor(world, definition, textureKey, x, y, z, face.normal, face.shade));
  }

  private addSpecial(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    switch (definition.renderShape) {
      case 'torch': return this.addTorch(buffers, definition, world, x, y, z);
      case 'wire': return this.addWire(buffers, definition, state, world, x, y, z);
      case 'lever': return this.addLever(buffers, definition, state, world, x, y, z);
      case 'button': return this.addButton(buffers, definition, state, world, x, y, z);
      case 'pressure_plate': return this.addPressurePlate(buffers, definition, state, world, x, y, z);
      case 'cube': return 0;
    }
  }

  private addTorch(buffers: GeometryBuffers, definition: BlockDefinition, world: VoxelWorld, x: number, y: number, z: number): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const color = this.colorFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const matrix = new THREE.Matrix4()
        .makeTranslation(x + 0.5, y, z + 0.5)
        .multiply(new THREE.Matrix4().makeRotationY(angle));
      const local = [
        [-0.28, 0.02, 0], [0.28, 0.02, 0], [0.28, 0.76, 0], [-0.28, 0.76, 0],
      ] as const;
      const corners = local.map((point) => new THREE.Vector3(...point).applyMatrix4(matrix).toArray() as [number, number, number]);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix).toArray() as [number, number, number];
      this.addQuad(buffers, texture, corners, normal, color);
    }
    return 2;
  }

  private addWire(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? 'block/redstone_wire';
    const power = THREE.MathUtils.clamp(state?.power ?? 0, 0, 15) / 15;
    const base = this.colorFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const color = [base[0] * (0.42 + power * 0.58), base[1] * (0.15 + power * 0.15), base[2] * 0.15] as const;
    this.addQuad(buffers, texture, [
      [x + 0.05, y + 0.012, z + 0.95],
      [x + 0.95, y + 0.012, z + 0.95],
      [x + 0.95, y + 0.012, z + 0.05],
      [x + 0.05, y + 0.012, z + 0.05],
    ], [0, 1, 0], color);
    return 1;
  }

  private addLever(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const attachment = state?.attachment ?? 'floor';
    const facing = state?.facing ?? 'north';
    const normal = attachment === 'floor'
      ? new THREE.Vector3(0, 1, 0)
      : attachment === 'ceiling'
        ? new THREE.Vector3(0, -1, 0)
        : this.facingVector(facing);
    const localZ = attachment === 'wall' ? new THREE.Vector3(0, 1, 0) : this.facingVector(facing);
    const localX = new THREE.Vector3().crossVectors(normal, localZ).normalize();
    const basis = new THREE.Matrix4().makeBasis(localX, normal, localZ);
    const center = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
    const surface = center.clone().addScaledVector(normal, -0.5);
    const baseThickness = 0.125;
    const baseCenter = surface.clone().addScaledVector(normal, baseThickness / 2);
    const baseMatrix = new THREE.Matrix4().makeTranslation(baseCenter.x, baseCenter.y, baseCenter.z).multiply(basis);
    let faces = this.addCuboid(
      buffers, 'block/stone', [0.5, baseThickness, 0.375], baseMatrix,
      world, definition, x, y, z,
    );

    const handleLength = 0.625;
    const pivot = surface.clone().addScaledVector(normal, baseThickness);
    const handleMatrix = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(basis)
      .multiply(new THREE.Matrix4().makeRotationX(leverHandleAngle(state?.powered === true)))
      .multiply(new THREE.Matrix4().makeTranslation(0, handleLength / 2, 0));
    faces += this.addCuboid(
      buffers, definition.textures.all ?? 'block/lever', [0.125, handleLength, 0.125], handleMatrix,
      world, definition, x, y, z, LEVER_HANDLE_UV,
    );
    return faces;
  }

  private addButton(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const depth = state?.powered ? 0.06 : 0.11;
    const matrix = new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.5, z + depth / 2);
    return this.addCuboid(
      buffers, 'block/stone', [0.375, 0.22, depth], matrix,
      world, definition, x, y, z,
    );
  }

  private addPressurePlate(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const height = state?.powered ? 0.03125 : 0.0625;
    const matrix = new THREE.Matrix4().makeTranslation(x + 0.5, y + height / 2, z + 0.5);
    return this.addCuboid(
      buffers, 'block/oak_planks', [0.875, height, 0.875], matrix,
      world, definition, x, y, z,
    );
  }

  private addCuboid(
    buffers: GeometryBuffers,
    texture: string,
    size: readonly [number, number, number],
    matrix: THREE.Matrix4,
    world: VoxelWorld,
    definition: BlockDefinition,
    x: number,
    y: number,
    z: number,
    textureUv?: TextureUvRect,
  ): number {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (const face of FACES) {
      const corners = face.corners.map((corner) => new THREE.Vector3(
        (corner[0] - 0.5) * size[0],
        (corner[1] - 0.5) * size[1],
        (corner[2] - 0.5) * size[2],
      ).applyMatrix4(matrix).toArray() as [number, number, number]);
      const normal = new THREE.Vector3(...face.normal).applyMatrix3(normalMatrix).normalize();
      const normalTuple = normal.toArray() as [number, number, number];
      this.addQuad(
        buffers,
        texture,
        corners,
        normalTuple,
        this.colorFor(world, definition, texture, x, y, z, normalTuple, face.shade),
        textureUv,
      );
    }
    return 6;
  }

  private addQuad(
    buffers: GeometryBuffers,
    textureKey: string,
    corners: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
    color: readonly [number, number, number],
    textureUv: TextureUvRect = [0, 0, 1, 1],
  ): void {
    const base = buffers.positions.length / 3;
    const tile = this.atlas.tile(textureKey);
    const u0 = THREE.MathUtils.lerp(tile.u0, tile.u1, textureUv[0]);
    const v0 = THREE.MathUtils.lerp(tile.v0, tile.v1, textureUv[1]);
    const u1 = THREE.MathUtils.lerp(tile.u0, tile.u1, textureUv[2]);
    const v1 = THREE.MathUtils.lerp(tile.v0, tile.v1, textureUv[3]);
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const;
    for (let index = 0; index < 4; index += 1) {
      buffers.positions.push(...corners[index]!);
      buffers.normals.push(...normal);
      buffers.uvs.push(...uv[index]!);
      buffers.colors.push(...color);
    }
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private colorFor(
    world: VoxelWorld,
    definition: BlockDefinition,
    textureKey: string,
    x: number,
    y: number,
    z: number,
    normal: readonly [number, number, number],
    shade: number,
  ): readonly [number, number, number] {
    const surface = world.generator.columnAt(x, z).height;
    const caveLight = y + normal[1] >= surface - 1 ? 1 : 0.34 + Math.max(0, y / 200);
    const emission = Math.max(0, Math.min(1, (definition.emission ?? 0) / 15));
    const light = Math.max(caveLight, emission) * shade;
    const tint = this.tintFor(textureKey, world.biomeAt(x, z));
    return [tint[0] * light, tint[1] * light, tint[2] * light];
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

  private facingVector(facing: HorizontalFacing): THREE.Vector3 {
    switch (facing) {
      case 'north': return new THREE.Vector3(0, 0, -1);
      case 'south': return new THREE.Vector3(0, 0, 1);
      case 'east': return new THREE.Vector3(1, 0, 0);
      case 'west': return new THREE.Vector3(-1, 0, 0);
    }
  }

  private toGeometry(buffers: GeometryBuffers): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(buffers.indices);
    if (buffers.positions.length > 0) geometry.computeBoundingSphere();
    return geometry;
  }
}
