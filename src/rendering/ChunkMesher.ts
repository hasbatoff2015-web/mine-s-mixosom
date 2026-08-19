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
import { getBlockLight, getSkyLight } from '../world/LightEngine';
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
const WHITE_TINT = [1, 1, 1] as const;
const PLAINS_TINT = [0.54, 0.9, 0.42] as const;
const FOREST_TINT = [0.42, 0.78, 0.36] as const;
const DESERT_TINT = [0.74, 0.78, 0.4] as const;

export interface MeshedChunk {
  opaque: THREE.BufferGeometry;
  cutout: THREE.BufferGeometry;
  translucent: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
  faces: number;
}

export interface ChunkMeshProfile {
  readonly scanMs: number;
  readonly geometryMs: number;
}

export type BlockRenderStateResolver = (x: number, y: number, z: number) => BlockRenderState | undefined;

export function leverHandleAngle(powered: boolean): number {
  return powered ? -Math.PI * 0.28 : Math.PI * 0.28;
}

export class ChunkMesher {
  private readonly columnHeights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly columnBiomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly scratchColor: [number, number, number] = [1, 1, 1];
  private columnOriginX = 0;
  private columnOriginZ = 0;
  lastProfile: ChunkMeshProfile = { scanMs: 0, geometryMs: 0 };

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly resolveState: BlockRenderStateResolver = () => undefined,
  ) {}

  build(chunk: Chunk, world: VoxelWorld): MeshedChunk {
    const buildStart = performance.now();
    const layers: LayerBuffers = {
      opaque: createBuffers(),
      cutout: createBuffers(),
      translucent: createBuffers(),
      water: createBuffers(),
    };
    this.cacheColumns(chunk, world);
    let faces = 0;
    const chunkHeight = chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE);
    const blocks = chunk.blocks;
    const eastChunk = world.getChunk(chunk.x + 1, chunk.z, false);
    const westChunk = world.getChunk(chunk.x - 1, chunk.z, false);
    const southChunk = world.getChunk(chunk.x, chunk.z + 1, false);
    const northChunk = world.getChunk(chunk.x, chunk.z - 1, false);
    for (let y = 0; y < chunkHeight; y += 1) {
      const yOffset = y * CHUNK_SIZE * CHUNK_SIZE;
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        const rowOffset = yOffset + z * CHUNK_SIZE;
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const blockIndex = rowOffset + x;
          const block = blocks[blockIndex] as BlockId;
          if (block === BlockId.Air) continue;
          const definition = getBlockDefinition(block);
          const worldX = chunk.x * CHUNK_SIZE + x;
          const worldZ = chunk.z * CHUNK_SIZE + z;
          const target = this.buffersFor(layers, definition);
          if (definition.renderShape !== 'cube') {
            faces += this.addSpecial(target, definition, this.resolveState(worldX, y, worldZ), world, worldX, y, worldZ);
            continue;
          }
          const east = x < CHUNK_SIZE - 1
            ? blocks[blockIndex + 1] as BlockId
            : (eastChunk?.blocks[yOffset + z * CHUNK_SIZE] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(east, block)) {
            this.addCubeFace(target, definition, FACES[0]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const west = x > 0
            ? blocks[blockIndex - 1] as BlockId
            : (westChunk?.blocks[yOffset + z * CHUNK_SIZE + CHUNK_SIZE - 1] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(west, block)) {
            this.addCubeFace(target, definition, FACES[1]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const above = y < chunkHeight - 1 ? blocks[blockIndex + CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Air;
          if (this.faceVisible(above, block)) {
            this.addCubeFace(target, definition, FACES[2]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const below = y > 0 ? blocks[blockIndex - CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Bedrock;
          if (this.faceVisible(below, block)) {
            this.addCubeFace(target, definition, FACES[3]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const south = z < CHUNK_SIZE - 1
            ? blocks[blockIndex + CHUNK_SIZE] as BlockId
            : (southChunk?.blocks[yOffset + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(south, block)) {
            this.addCubeFace(target, definition, FACES[4]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const north = z > 0
            ? blocks[blockIndex - CHUNK_SIZE] as BlockId
            : (northChunk?.blocks[yOffset + (CHUNK_SIZE - 1) * CHUNK_SIZE + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(north, block)) {
            this.addCubeFace(target, definition, FACES[5]!, world, worldX, y, worldZ);
            faces += 1;
          }
        }
      }
    }
    const scanEnd = performance.now();
    const result = {
      opaque: this.toGeometry(layers.opaque),
      cutout: this.toGeometry(layers.cutout),
      translucent: this.toGeometry(layers.translucent),
      water: this.toGeometry(layers.water),
      faces,
    };
    const buildEnd = performance.now();
    this.lastProfile = { scanMs: scanEnd - buildStart, geometryMs: buildEnd - scanEnd };
    return result;
  }

  private faceVisible(adjacent: BlockId, block: BlockId): boolean {
    if (adjacent === BlockId.Air) return true;
    const adjacentDefinition = getBlockDefinition(adjacent);
    return !adjacentDefinition.occludesFaces
      && (adjacent !== block || adjacentDefinition.renderShape !== 'cube');
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
    const textureKey = this.textureForFace(definition, face.texture);
    const color = this.colorFor(world, definition, textureKey, x, y, z, face.normal, face.shade);
    const tile = this.atlas.tile(textureKey);
    const base = buffers.positions.length / 3;
    for (let index = 0; index < 4; index += 1) {
      const corner = face.corners[index]!;
      buffers.positions.push(x + corner[0], y + corner[1], z + corner[2]);
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      buffers.colors.push(color[0], color[1], color[2]);
    }
    buffers.uvs.push(
      tile.u0, tile.v0,
      tile.u1, tile.v0,
      tile.u1, tile.v1,
      tile.u0, tile.v1,
    );
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
      case 'torch': return this.addTorch(buffers, definition, state, world, x, y, z);
      case 'wire': return this.addWire(buffers, definition, state, world, x, y, z);
      case 'lever': return this.addLever(buffers, definition, state, world, x, y, z);
      case 'button': return this.addButton(buffers, definition, state, world, x, y, z);
      case 'pressure_plate': return this.addPressurePlate(buffers, definition, state, world, x, y, z);
      case 'cross': return this.addCrossPlant(buffers, definition, world, x, y, z);
      case 'door': return this.addDoor(buffers, definition, state, world, x, y, z);
      case 'cube': return 0;
    }
  }

  private addCrossPlant(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const color = this.colorFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const inset = 0.08;
    this.addQuad(buffers, texture, [
      [x + inset, y, z + inset], [x + 1 - inset, y, z + 1 - inset],
      [x + 1 - inset, y + 0.9, z + 1 - inset], [x + inset, y + 0.9, z + inset],
    ], [-0.707, 0, 0.707], color);
    this.addQuad(buffers, texture, [
      [x + 1 - inset, y, z + inset], [x + inset, y, z + 1 - inset],
      [x + inset, y + 0.9, z + 1 - inset], [x + 1 - inset, y + 0.9, z + inset],
    ], [0.707, 0, 0.707], color);
    return 2;
  }

  private addTorch(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const color = this.colorFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const attachment = state?.attachment ?? 'floor';
    const facing = state?.facing ?? 'north';
    const tilt = attachment === 'wall' ? 0.38 : 0;
    const wall = attachment === 'wall' ? this.facingVector(facing) : new THREE.Vector3(0, 1, 0);
    const origin = new THREE.Vector3(x + 0.5, y + (attachment === 'wall' ? 0.22 : 0), z + 0.5);
    if (attachment === 'wall') origin.addScaledVector(wall, -0.28);
    const tiltAxis = attachment === 'wall'
      ? new THREE.Vector3().crossVectors(wall, new THREE.Vector3(0, 1, 0)).normalize()
      : new THREE.Vector3(1, 0, 0);
    let faces = 0;
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const matrix = new THREE.Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(tiltAxis, tilt))
        .multiply(new THREE.Matrix4().makeRotationY(angle));
      const local = [
        [-0.28, 0.02, 0], [0.28, 0.02, 0], [0.28, 0.8, 0], [-0.28, 0.8, 0],
      ] as const;
      const corners = local.map((point) => new THREE.Vector3(...point).applyMatrix4(matrix).toArray() as [number, number, number]);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix).toArray() as [number, number, number];
      this.addQuad(buffers, texture, corners, normal, color);
      faces += 1;
    }
    return faces;
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
    const attachment = state?.attachment ?? 'wall';
    const facing = state?.facing ?? 'south';
    const depth = state?.powered ? 0.06 : 0.125;
    const normal = attachment === 'floor'
      ? new THREE.Vector3(0, 1, 0)
      : attachment === 'ceiling'
        ? new THREE.Vector3(0, -1, 0)
        : this.facingVector(facing);
    const localZ = attachment === 'wall' ? new THREE.Vector3(0, 1, 0) : this.facingVector(facing);
    const localX = new THREE.Vector3().crossVectors(normal, localZ);
    if (localX.lengthSq() < 1e-6) localX.set(1, 0, 0);
    localX.normalize();
    const basis = new THREE.Matrix4().makeBasis(localX, normal, localZ);
    const center = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
    const surface = center.clone().addScaledVector(normal, -0.5);
    const buttonCenter = surface.clone().addScaledVector(normal, depth / 2);
    const matrix = new THREE.Matrix4().makeTranslation(buttonCenter.x, buttonCenter.y, buttonCenter.z).multiply(basis);
    return this.addCuboid(
      buffers, 'block/stone', [0.375, depth, 0.22], matrix,
      world, definition, x, y, z,
    );
  }

  private addDoor(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const facing = state?.facing ?? 'north';
    const open = state?.open === true;
    const hinge = state?.hinge ?? 'left';
    const occupied = open
      ? (hinge === 'left'
        ? ({ north: 'west', west: 'south', south: 'east', east: 'north' } as const)[facing]
        : ({ north: 'east', east: 'south', south: 'west', west: 'north' } as const)[facing])
      : facing;
    const texture = state?.half === 'upper'
      ? (definition.textures.top ?? 'block/oak_door_upper')
      : (definition.textures.bottom ?? definition.textures.all ?? 'block/oak_door');
    const color = this.colorFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const thickness = 3 / 16;
    let corners: Array<[number, number, number]>;
    let normal: [number, number, number];
    switch (occupied) {
      case 'north':
        corners = [
          [x, y, z + thickness], [x + 1, y, z + thickness],
          [x + 1, y + 1, z + thickness], [x, y + 1, z + thickness],
        ];
        normal = [0, 0, 1];
        break;
      case 'south':
        corners = [
          [x + 1, y, z + 1 - thickness], [x, y, z + 1 - thickness],
          [x, y + 1, z + 1 - thickness], [x + 1, y + 1, z + 1 - thickness],
        ];
        normal = [0, 0, -1];
        break;
      case 'west':
        corners = [
          [x + thickness, y, z + 1], [x + thickness, y, z],
          [x + thickness, y + 1, z], [x + thickness, y + 1, z + 1],
        ];
        normal = [1, 0, 0];
        break;
      case 'east':
        corners = [
          [x + 1 - thickness, y, z], [x + 1 - thickness, y, z + 1],
          [x + 1 - thickness, y + 1, z + 1], [x + 1 - thickness, y + 1, z],
        ];
        normal = [-1, 0, 0];
        break;
    }
    this.addQuad(buffers, texture, corners, normal, color);
    this.addQuad(buffers, texture, [...corners].reverse() as typeof corners, [-normal[0], 0, -normal[2]] as [number, number, number], color);
    return 2;
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
    const localX = x - this.columnOriginX;
    const localZ = z - this.columnOriginZ;
    const inCachedChunk = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;
    const columnIndex = inCachedChunk ? localZ * CHUNK_SIZE + localX : -1;
    const column = columnIndex >= 0 ? undefined : world.generator.columnAt(x, z);
    const sampleX = x + Math.round(normal[0]);
    const sampleY = y + Math.round(normal[1]);
    const sampleZ = z + Math.round(normal[2]);
    const sky = getSkyLight(world, sampleX, sampleY, sampleZ) / 15;
    const blockLight = getBlockLight(world, sampleX, sampleY, sampleZ) / 15;
    const emission = Math.max(0, Math.min(1, (definition.emission ?? 0) / 15));
    const baked = Math.min(1.15, Math.max(0.16 + sky * 0.72, 0.18 + blockLight * 0.95, emission));
    const light = baked * shade;
    const biome = columnIndex >= 0 ? this.columnBiomes[columnIndex]! : this.biomeCode(column!.biome);
    const tint = this.tintFor(textureKey, biome);
    this.scratchColor[0] = tint[0] * light;
    this.scratchColor[1] = tint[1] * light;
    this.scratchColor[2] = tint[2] * light;
    return this.scratchColor;
  }

  private textureForFace(definition: BlockDefinition, face: Face['texture']): string {
    const textures = definition.textures;
    if (face === 'top') return textures.top ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'bottom') return textures.bottom ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'front') return textures.front ?? textures.side ?? textures.all ?? 'block/missing';
    return textures.side ?? textures.all ?? textures.top ?? 'block/missing';
  }

  private tintFor(texture: string, biome: number): readonly [number, number, number] {
    if (!texture.includes('grass_block_top')
      && !texture.includes('leaves')
      && !texture.includes('tall_grass')
      && !texture.includes('fern')) return WHITE_TINT;
    if (biome === 1) return FOREST_TINT;
    if (biome === 2) return DESERT_TINT;
    return PLAINS_TINT;
  }

  private cacheColumns(chunk: Chunk, world: VoxelWorld): void {
    this.columnOriginX = chunk.x * CHUNK_SIZE;
    this.columnOriginZ = chunk.z * CHUNK_SIZE;
    if (chunk.generated) {
      this.columnHeights.set(chunk.surfaceHeights);
      this.columnBiomes.set(chunk.biomeCodes);
      return;
    }
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const index = z * CHUNK_SIZE + x;
        const column = world.generator.columnAt(this.columnOriginX + x, this.columnOriginZ + z);
        this.columnHeights[index] = column.height;
        this.columnBiomes[index] = this.biomeCode(column.biome);
      }
    }
  }

  private biomeCode(biome: string): number {
    return biome === 'forest' ? 1 : biome === 'desert' ? 2 : 0;
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
