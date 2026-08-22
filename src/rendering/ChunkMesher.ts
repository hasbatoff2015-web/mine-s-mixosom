import * as THREE from 'three';
import {
  BlockId,
  blockLightingMode,
  getBlockDefinition,
  occupiedDoorFacing,
  type BlockDefinition,
  type BlockRenderState,
  type HorizontalFacing,
} from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelWorld } from '../world/World';
import { getBlockLight, getSkyLight, smoothFaceCornerLight } from '../world/LightEngine';
import type { TextureAtlas } from './TextureAtlas';
import {
  blockOccludesFaces,
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  DOOR_THICKNESS,
  doorFaceTextureUv,
  doorHalfTexture,
  facingVector as facingVectorFrom,
  ladderPlaneLocal,
  leverHandleAngle,
  resolveStairShape,
  slabLocalBoxes,
  stairLocalBoxes,
  TORCH_HEIGHT,
  TORCH_TEXTURE_UV,
  TORCH_WIDTH,
  torchLocalMatrix,
  type DoorFaceRole,
  type LocalBox,
  type TextureUvRect,
} from './specialBlockGeometry';

export { leverHandleAngle } from './specialBlockGeometry';
export { bakedVertexLight } from './worldLighting';

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
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.58, texture: 'bottom' },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.88, texture: 'side' },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.76, texture: 'front' },
];

function localFaceUv(face: Face, box: LocalBox): TextureUvRect {
  const nx = face.normal[0];
  const ny = face.normal[1];
  const nz = face.normal[2];
  if (nx > 0) return [box.maxZ, box.minY, box.minZ, box.maxY];
  if (nx < 0) return [box.minZ, box.minY, box.maxZ, box.maxY];
  if (ny > 0) return [box.minX, box.maxZ, box.maxX, box.minZ];
  if (ny < 0) return [box.minX, box.minZ, box.maxX, box.maxZ];
  if (nz > 0) return [box.minX, box.minY, box.maxX, box.maxY];
  return [box.maxX, box.minY, box.minX, box.maxY];
}

interface GeometryBuffers {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
  skyLights: number[];
  blockLights: number[];
  faceShades: number[];
  emissions: number[];
}

interface VertexLighting {
  readonly tint: readonly [number, number, number];
  readonly sky: number;
  readonly block: number;
  readonly emission: number;
  readonly shade: number;
}

// The legacy lever tile is a transparent 16x16 sprite; the handle occupies
// logical x=7..9 and y=6..16. Crop that opaque strip before wrapping the cuboid.
const LEVER_HANDLE_UV: TextureUvRect = [7 / 16, 0, 9 / 16, 10 / 16];

interface LayerBuffers {
  opaque: GeometryBuffers;
  cutout: GeometryBuffers;
  vegetation: GeometryBuffers;
  translucent: GeometryBuffers;
  water: GeometryBuffers;
}

const createBuffers = (): GeometryBuffers => ({
  positions: [], normals: [], colors: [], uvs: [], indices: [],
  skyLights: [], blockLights: [], faceShades: [], emissions: [],
});
const WHITE_TINT = [1, 1, 1] as const;
const PLAINS_TINT = [0.54, 0.9, 0.42] as const;
const FOREST_TINT = [0.42, 0.78, 0.36] as const;
const DESERT_TINT = [0.74, 0.78, 0.4] as const;

/** Lighting normal written into vegetation quads so they sample/share the grass-top profile. */
export const VEGETATION_LIGHTING_NORMAL = [0, 1, 0] as const;

interface DoorMeshFace {
  readonly role: DoorFaceRole;
  readonly corners: readonly (readonly [number, number, number])[];
  readonly normal: readonly [number, number, number];
}

function doorCuboidFaces(
  x: number,
  y: number,
  z: number,
  occupied: HorizontalFacing,
  thickness: number,
): readonly DoorMeshFace[] {
  let minX = x;
  let maxX = x + 1;
  let minZ = z;
  let maxZ = z + 1;
  if (occupied === 'west') maxX = x + thickness;
  else if (occupied === 'east') minX = x + 1 - thickness;
  else if (occupied === 'north') maxZ = z + thickness;
  else minZ = z + 1 - thickness;
  const minY = y;
  const maxY = y + 1;
  const role = (
    face: HorizontalFacing | 'up' | 'down',
  ): DoorFaceRole => {
    if (face === occupied) return 'outer';
    if (
      (occupied === 'west' && face === 'east')
      || (occupied === 'east' && face === 'west')
      || (occupied === 'north' && face === 'south')
      || (occupied === 'south' && face === 'north')
    ) return 'inner';
    return 'edge';
  };
  return [
    {
      role: role('west'),
      normal: [-1, 0, 0],
      corners: [[minX, minY, maxZ], [minX, minY, minZ], [minX, maxY, minZ], [minX, maxY, maxZ]],
    },
    {
      role: role('east'),
      normal: [1, 0, 0],
      corners: [[maxX, minY, minZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ]],
    },
    {
      role: role('north'),
      normal: [0, 0, -1],
      corners: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]],
    },
    {
      role: role('south'),
      normal: [0, 0, 1],
      corners: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]],
    },
    {
      role: 'edge',
      normal: [0, 1, 0],
      corners: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]],
    },
    {
      role: 'edge',
      normal: [0, -1, 0],
      corners: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]],
    },
  ];
}

function ladderFrontCorners(
  x: number,
  y: number,
  z: number,
  facing: HorizontalFacing,
): { corners: Array<[number, number, number]>; normal: [number, number, number] } {
  const plane = ladderPlaneLocal(facing);
  const px = x + (plane.axis === 'x' ? plane.plane : 0);
  const pz = z + (plane.axis === 'z' ? plane.plane : 0);
  switch (facing) {
    case 'east':
      return {
        normal: [1, 0, 0],
        corners: [[px, y, z + 1], [px, y, z], [px, y + 1, z], [px, y + 1, z + 1]],
      };
    case 'west':
      return {
        normal: [-1, 0, 0],
        corners: [[px, y, z], [px, y, z + 1], [px, y + 1, z + 1], [px, y + 1, z]],
      };
    case 'south':
      return {
        normal: [0, 0, 1],
        corners: [[x, y, pz], [x + 1, y, pz], [x + 1, y + 1, pz], [x, y + 1, pz]],
      };
    case 'north':
      return {
        normal: [0, 0, -1],
        corners: [[x + 1, y, pz], [x, y, pz], [x, y + 1, pz], [x + 1, y + 1, pz]],
      };
  }
}

export function biomeGrassTint(biome: number): readonly [number, number, number] {
  if (biome === 1) return FOREST_TINT;
  if (biome === 2) return DESERT_TINT;
  return PLAINS_TINT;
}

export interface MeshedChunk {
  opaque: THREE.BufferGeometry;
  cutout: THREE.BufferGeometry;
  vegetation: THREE.BufferGeometry;
  translucent: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
  faces: number;
}

export interface ChunkMeshProfile {
  readonly scanMs: number;
  readonly geometryMs: number;
}

export type BlockRenderStateResolver = (x: number, y: number, z: number) => BlockRenderState | undefined;

export class ChunkMesher {
  private readonly columnHeights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly columnBiomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
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
      vegetation: createBuffers(),
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
          const state = this.resolveState(worldX, y, worldZ);
          const target = this.buffersFor(layers, definition);
          const meshAsCube = definition.renderShape === 'cube'
            || (definition.renderShape === 'slab' && defaultSlabType(state) === 'double');
          if (!meshAsCube) {
            faces += this.addSpecial(target, definition, state, world, worldX, y, worldZ);
            continue;
          }
          const east = x < CHUNK_SIZE - 1
            ? blocks[blockIndex + 1] as BlockId
            : (eastChunk?.blocks[yOffset + z * CHUNK_SIZE] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(east, block, world, worldX + 1, y, worldZ)) {
            this.addCubeFace(target, definition, FACES[0]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const west = x > 0
            ? blocks[blockIndex - 1] as BlockId
            : (westChunk?.blocks[yOffset + z * CHUNK_SIZE + CHUNK_SIZE - 1] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(west, block, world, worldX - 1, y, worldZ)) {
            this.addCubeFace(target, definition, FACES[1]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const above = y < chunkHeight - 1 ? blocks[blockIndex + CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Air;
          if (this.faceVisible(above, block, world, worldX, y + 1, worldZ)) {
            this.addCubeFace(target, definition, FACES[2]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const below = y > 0 ? blocks[blockIndex - CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Bedrock;
          if (this.faceVisible(below, block, world, worldX, y - 1, worldZ)) {
            this.addCubeFace(target, definition, FACES[3]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const south = z < CHUNK_SIZE - 1
            ? blocks[blockIndex + CHUNK_SIZE] as BlockId
            : (southChunk?.blocks[yOffset + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(south, block, world, worldX, y, worldZ + 1)) {
            this.addCubeFace(target, definition, FACES[4]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const north = z > 0
            ? blocks[blockIndex - CHUNK_SIZE] as BlockId
            : (northChunk?.blocks[yOffset + (CHUNK_SIZE - 1) * CHUNK_SIZE + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(north, block, world, worldX, y, worldZ - 1)) {
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
      vegetation: this.toGeometry(layers.vegetation),
      translucent: this.toGeometry(layers.translucent),
      water: this.toGeometry(layers.water),
      faces,
    };
    const buildEnd = performance.now();
    this.lastProfile = { scanMs: scanEnd - buildStart, geometryMs: buildEnd - scanEnd };
    return result;
  }

  private faceVisible(adjacent: BlockId, block: BlockId, world: VoxelWorld, ax: number, ay: number, az: number): boolean {
    if (adjacent === BlockId.Air) return true;
    if (blockOccludesFaces(world, ax, ay, az)) return false;
    const adjacentDefinition = getBlockDefinition(adjacent);
    const adjacentFull = adjacentDefinition.renderShape === 'cube'
      || (adjacentDefinition.renderShape === 'slab' && defaultSlabType(this.resolveState(ax, ay, az)) === 'double');
    return adjacent !== block || !adjacentFull;
  }

  private buffersFor(layers: LayerBuffers, definition: BlockDefinition): GeometryBuffers {
    if (blockLightingMode(definition) === 'vegetation') return layers.vegetation;
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
    const lighting = this.lightingFor(world, definition, textureKey, x, y, z, face.normal, face.shade);
    const tile = this.atlas.tile(textureKey);
    const base = buffers.positions.length / 3;
    for (let index = 0; index < 4; index += 1) {
      const corner = face.corners[index]!;
      buffers.positions.push(x + corner[0], y + corner[1], z + corner[2]);
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const cornerLight = smoothFaceCornerLight(
        world, x, y, z,
        face.normal[0], face.normal[1], face.normal[2],
        corner[0], corner[1], corner[2],
      );
      this.pushLighting(buffers, {
        tint: lighting.tint,
        sky: cornerLight.sky / 15,
        block: cornerLight.block / 15,
        emission: lighting.emission,
        shade: lighting.shade,
      });
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
      case 'ladder': return this.addLadder(buffers, definition, state, world, x, y, z);
      case 'stairs': return this.addStairs(buffers, definition, state, world, x, y, z);
      case 'slab': return this.addSlab(buffers, definition, state, world, x, y, z);
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
    const lighting = this.lightingFor(world, definition, texture, x, y, z, VEGETATION_LIGHTING_NORMAL, 1);
    const inset = 0.08;
    const planes: readonly (readonly (readonly [number, number, number])[])[] = [
      [
        [x + inset, y, z + inset], [x + 1 - inset, y, z + 1 - inset],
        [x + 1 - inset, y + 0.9, z + 1 - inset], [x + inset, y + 0.9, z + inset],
      ],
      [
        [x + 1 - inset, y, z + inset], [x + inset, y, z + 1 - inset],
        [x + inset, y + 0.9, z + 1 - inset], [x + 1 - inset, y + 0.9, z + inset],
      ],
    ];
    for (const corners of planes) {
      this.addQuad(buffers, texture, corners, VEGETATION_LIGHTING_NORMAL, lighting);
      this.addQuad(
        buffers,
        texture,
        [corners[0]!, corners[3]!, corners[2]!, corners[1]!],
        VEGETATION_LIGHTING_NORMAL,
        lighting,
        [0, 0, 1, 1],
        true,
      );
    }
    return 4;
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
    const attachment = state?.attachment ?? 'floor';
    const facing = state?.facing ?? 'north';
    const matrix = torchLocalMatrix(x, y, z, attachment, facing)
      .multiply(new THREE.Matrix4().makeTranslation(0, TORCH_HEIGHT * 0.5, 0));
    return this.addCuboid(
      buffers, texture, [TORCH_WIDTH, TORCH_HEIGHT, TORCH_WIDTH], matrix,
      world, definition, x, y, z, TORCH_TEXTURE_UV,
    );
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
    const lighting = this.lightingFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const tinted: VertexLighting = {
      ...lighting,
      tint: [
        lighting.tint[0] * (0.42 + power * 0.58),
        lighting.tint[1] * (0.15 + power * 0.15),
        lighting.tint[2] * 0.15,
      ],
    };
    this.addQuad(buffers, texture, [
      [x + 0.05, y + 0.012, z + 0.95],
      [x + 0.95, y + 0.012, z + 0.95],
      [x + 0.95, y + 0.012, z + 0.05],
      [x + 0.05, y + 0.012, z + 0.05],
    ], [0, 1, 0], tinted);
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
        : facingVectorFrom(facing);
    const localZ = attachment === 'wall' ? new THREE.Vector3(0, 1, 0) : facingVectorFrom(facing);
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
        : facingVectorFrom(facing);
    const localZ = attachment === 'wall' ? new THREE.Vector3(0, 1, 0) : facingVectorFrom(facing);
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
    const occupied = occupiedDoorFacing(
      state?.facing ?? 'north',
      state?.open === true,
      state?.hinge ?? 'left',
    );
    const hinge = state?.hinge ?? 'left';
    const texture = doorHalfTexture(state?.half, definition.textures);
    const t = DOOR_THICKNESS;
    const lighting = this.lightingFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const outerUv = doorFaceTextureUv('outer', hinge);
    const innerUv = doorFaceTextureUv('inner', hinge);
    const edgeUv = doorFaceTextureUv('edge', hinge);
    const faces = doorCuboidFaces(x, y, z, occupied, t);
    for (const face of faces) {
      const uv = face.role === 'outer' ? outerUv : face.role === 'inner' ? innerUv : edgeUv;
      this.addQuad(buffers, texture, face.corners, face.normal, lighting, uv);
    }
    return faces.length;
  }

  private addLadder(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? 'block/ladder';
    const facing = state?.facing ?? 'north';
    const { corners, normal } = ladderFrontCorners(x, y, z, facing);
    const lighting = this.lightingFor(world, definition, texture, x, y, z, normal, 1);
    this.addQuad(buffers, texture, corners, normal, lighting);
    this.addQuad(
      buffers,
      texture,
      [corners[1]!, corners[0]!, corners[3]!, corners[2]!],
      [-normal[0], 0, -normal[2]] as [number, number, number],
      lighting,
      [1, 0, 0, 1],
    );
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
      buffers, definition.textures.all ?? 'block/oak_planks', [0.875, height, 0.875], matrix,
      world, definition, x, y, z,
    );
  }

  private addStairs(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const shape = resolveStairShape(world, x, y, z, state);
    const boxes = stairLocalBoxes(defaultStairFacing(state), defaultStairHalf(state), shape);
    let faces = 0;
    for (const box of boxes) faces += this.addLocalCuboid(buffers, texture, box, world, definition, x, y, z);
    return faces;
  }

  private addSlab(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const boxes = slabLocalBoxes(defaultSlabType(state));
    let faces = 0;
    for (const box of boxes) faces += this.addLocalCuboid(buffers, texture, box, world, definition, x, y, z);
    return faces;
  }

  private addLocalCuboid(
    buffers: GeometryBuffers,
    texture: string,
    box: LocalBox,
    world: VoxelWorld,
    definition: BlockDefinition,
    x: number,
    y: number,
    z: number,
  ): number {
    let faces = 0;
    for (const face of FACES) {
      if (this.localFaceCulled(box, face, world, x, y, z)) continue;
      const corners = face.corners.map((corner) => [
        x + box.minX + corner[0] * (box.maxX - box.minX),
        y + box.minY + corner[1] * (box.maxY - box.minY),
        z + box.minZ + corner[2] * (box.maxZ - box.minZ),
      ] as [number, number, number]);
      this.addQuad(
        buffers,
        texture,
        corners,
        face.normal,
        this.lightingFor(world, definition, texture, x, y, z, face.normal, face.shade),
        localFaceUv(face, box),
      );
      faces += 1;
    }
    return faces;
  }

  private localFaceCulled(
    box: LocalBox,
    face: Face,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): boolean {
    const nx = face.normal[0];
    const ny = face.normal[1];
    const nz = face.normal[2];
    const onBoundary = (nx > 0 && box.maxX >= 1 - 1e-6)
      || (nx < 0 && box.minX <= 1e-6)
      || (ny > 0 && box.maxY >= 1 - 1e-6)
      || (ny < 0 && box.minY <= 1e-6)
      || (nz > 0 && box.maxZ >= 1 - 1e-6)
      || (nz < 0 && box.minZ <= 1e-6);
    if (!onBoundary) return false;
    return blockOccludesFaces(world, x + nx, y + ny, z + nz);
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
        this.lightingFor(world, definition, texture, x, y, z, normalTuple, face.shade),
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
    lighting: VertexLighting,
    textureUv: TextureUvRect = [0, 0, 1, 1],
    backFace = false,
  ): void {
    const base = buffers.positions.length / 3;
    const tile = this.atlas.tile(textureKey);
    const u0 = THREE.MathUtils.lerp(tile.u0, tile.u1, textureUv[0]);
    const v0 = THREE.MathUtils.lerp(tile.v0, tile.v1, textureUv[1]);
    const u1 = THREE.MathUtils.lerp(tile.u0, tile.u1, textureUv[2]);
    const v1 = THREE.MathUtils.lerp(tile.v0, tile.v1, textureUv[3]);
    const uv = backFace
      ? [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] as const
      : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const;
    for (let index = 0; index < 4; index += 1) {
      buffers.positions.push(...corners[index]!);
      buffers.normals.push(...normal);
      buffers.uvs.push(...uv[index]!);
      this.pushLighting(buffers, lighting);
    }
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private pushLighting(buffers: GeometryBuffers, lighting: VertexLighting): void {
    buffers.colors.push(lighting.tint[0], lighting.tint[1], lighting.tint[2]);
    buffers.skyLights.push(lighting.sky);
    buffers.blockLights.push(lighting.block);
    buffers.faceShades.push(lighting.shade);
    buffers.emissions.push(lighting.emission);
  }

  private lightingFor(
    world: VoxelWorld,
    definition: BlockDefinition,
    textureKey: string,
    x: number,
    y: number,
    z: number,
    normal: readonly [number, number, number],
    shade: number,
  ): VertexLighting {
    const localX = x - this.columnOriginX;
    const localZ = z - this.columnOriginZ;
    const inCachedChunk = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;
    const columnIndex = inCachedChunk ? localZ * CHUNK_SIZE + localX : -1;
    const column = columnIndex >= 0 ? undefined : world.generator.columnAt(x, z);
    const sampleX = x + Math.round(normal[0]);
    const sampleY = y + Math.round(normal[1]);
    const sampleZ = z + Math.round(normal[2]);
    const sky = getSkyLight(world, sampleX, sampleY, sampleZ) / 15;
    const block = getBlockLight(world, sampleX, sampleY, sampleZ) / 15;
    const emission = Math.max(0, Math.min(1, (definition.emission ?? 0) / 15));
    const biome = columnIndex >= 0 ? this.columnBiomes[columnIndex]! : this.biomeCode(column!.biome);
    return {
      tint: this.tintFor(definition, textureKey, biome),
      sky,
      block,
      emission,
      shade,
    };
  }

  private textureForFace(definition: BlockDefinition, face: Face['texture']): string {
    const textures = definition.textures;
    if (face === 'top') return textures.top ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'bottom') return textures.bottom ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'front') return textures.front ?? textures.side ?? textures.all ?? 'block/missing';
    return textures.side ?? textures.all ?? textures.top ?? 'block/missing';
  }

  private tintFor(
    definition: BlockDefinition,
    texture: string,
    biome: number,
  ): readonly [number, number, number] {
    if (definition.biomeTint !== 'grass'
      && !texture.includes('grass_block_top')
      && !texture.includes('leaves')) return WHITE_TINT;
    return biomeGrassTint(biome);
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

  private toGeometry(buffers: GeometryBuffers): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geometry.setAttribute('skyLight', new THREE.Float32BufferAttribute(buffers.skyLights, 1));
    geometry.setAttribute('blockLight', new THREE.Float32BufferAttribute(buffers.blockLights, 1));
    geometry.setAttribute('faceShade', new THREE.Float32BufferAttribute(buffers.faceShades, 1));
    geometry.setAttribute('emissionLight', new THREE.Float32BufferAttribute(buffers.emissions, 1));
    geometry.setIndex(buffers.indices);
    if (buffers.positions.length > 0) geometry.computeBoundingSphere();
    return geometry;
  }
}
