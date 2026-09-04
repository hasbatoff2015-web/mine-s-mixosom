import * as THREE from 'three';
import {
  BlockId,
  blockLightingMode,
  DEFAULT_FURNACE_FACING,
  furnaceCubeFaceSlot,
  furnaceFaceTextureKey,
  getBlockDefinition,
  occupiedDoorFacing,
  type BlockDefinition,
  type BlockRenderState,
  type HorizontalFacing,
} from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';
import type { Chunk } from '../world/Chunk';
import type { VoxelWorld } from '../world/World';
import type { TextureAtlas } from './TextureAtlas';
import {
  blockOccludesFaces,
  defaultRailShape,
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  DOOR_THICKNESS,
  doorFaceTextureUv,
  doorHalfTexture,
  facingVector as facingVectorFrom,
  fenceConnections,
  fenceLocalBoxes,
  ladderPlaneLocal,
  buttonSelectionBox,
  leverSelectionBoxes,
  railLocalBoxes,
  railTextureYaw,
  resolveRailShape,
  resolveStairShape,
  slabLocalBoxes,
  stairLocalBoxes,
  TORCH_HEIGHT,
  TORCH_TEXTURE_UV,
  TORCH_WIDTH,
  torchLocalMatrix,
  lanternHangerPlanes,
  lanternMeshCuboids,
  chainMeshPlanes,
  type DoorFaceRole,
  type LocalBox,
  type TextureUvRect,
} from './specialBlockGeometry';
import { fluidCellGeometry } from '../world/fluidSurface';
import { fireBlockPlanes, FIRE_PLANE_COUNT } from './fireGeometry';
import { sampleSurfaceVertexLight, type SurfaceLight } from '../world/lightSampling';
import { attachedStemDirection, cropAge, cropTextureStage, isStemBlock } from '../farming';

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
  readonly origin?: readonly [number, number, number];
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
  fire: GeometryBuffers;
}

const createBuffers = (): GeometryBuffers => ({
  positions: [], normals: [], colors: [], uvs: [], indices: [],
  skyLights: [], blockLights: [], faceShades: [], emissions: [],
});
const resetBuffers = (buffers: GeometryBuffers): void => {
  buffers.positions.length = 0;
  buffers.normals.length = 0;
  buffers.colors.length = 0;
  buffers.uvs.length = 0;
  buffers.indices.length = 0;
  buffers.skyLights.length = 0;
  buffers.blockLights.length = 0;
  buffers.faceShades.length = 0;
  buffers.emissions.length = 0;
};
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
  fire: THREE.BufferGeometry;
  faces: number;
  chests: Array<{ x: number; y: number; z: number }>;
}

export function disposeMeshedChunk(meshed: MeshedChunk): void {
  meshed.opaque.dispose();
  meshed.cutout.dispose();
  meshed.vegetation.dispose();
  meshed.translucent.dispose();
  meshed.water.dispose();
  meshed.fire.dispose();
}

export interface ChunkMeshProfile {
  readonly scanMs: number;
  readonly geometryMs: number;
}

export type BlockRenderStateResolver = (x: number, y: number, z: number) => BlockRenderState | undefined;

export class ChunkMesher {
  private readonly columnHeights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly columnBiomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  private readonly layers: LayerBuffers = {
    opaque: createBuffers(),
    cutout: createBuffers(),
    vegetation: createBuffers(),
    translucent: createBuffers(),
    water: createBuffers(),
    fire: createBuffers(),
  };
  private columnOriginX = 0;
  private columnOriginZ = 0;
  private lightSelf?: Chunk;
  private lightEast?: Chunk;
  private lightWest?: Chunk;
  private lightSouth?: Chunk;
  private lightNorth?: Chunk;
  private lightNorthEast?: Chunk;
  private lightNorthWest?: Chunk;
  private lightSouthEast?: Chunk;
  private lightSouthWest?: Chunk;
  private readonly surfaceLight: SurfaceLight = { sky: 0, block: 0, ao: 1 };
  private readonly readLightCell = (x: number, y: number, z: number): number => this.packedLightCell(x, y, z);
  lastProfile: ChunkMeshProfile = { scanMs: 0, geometryMs: 0 };

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly resolveState: BlockRenderStateResolver = () => undefined,
  ) {}

  build(chunk: Chunk, world: VoxelWorld): MeshedChunk {
    const buildStart = performance.now();
    resetBuffers(this.layers.opaque);
    resetBuffers(this.layers.cutout);
    resetBuffers(this.layers.vegetation);
    resetBuffers(this.layers.translucent);
    resetBuffers(this.layers.water);
    resetBuffers(this.layers.fire);
    const layers = this.layers;
    this.cacheColumns(chunk, world);
    this.lightSelf = chunk;
    this.lightEast = world.getChunk(chunk.x + 1, chunk.z, false);
    this.lightWest = world.getChunk(chunk.x - 1, chunk.z, false);
    this.lightSouth = world.getChunk(chunk.x, chunk.z + 1, false);
    this.lightNorth = world.getChunk(chunk.x, chunk.z - 1, false);
    this.lightNorthEast = world.getChunk(chunk.x + 1, chunk.z - 1, false);
    this.lightNorthWest = world.getChunk(chunk.x - 1, chunk.z - 1, false);
    this.lightSouthEast = world.getChunk(chunk.x + 1, chunk.z + 1, false);
    this.lightSouthWest = world.getChunk(chunk.x - 1, chunk.z + 1, false);
    let faces = 0;
    const chests: Array<{ x: number; y: number; z: number }> = [];
    const chunkHeight = Math.min(
      chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE),
      chunk.scanMaxY() + 1,
    );
    const blocks = chunk.blocks;
    const eastChunk = this.lightEast;
    const westChunk = this.lightWest;
    const southChunk = this.lightSouth;
    const northChunk = this.lightNorth;
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
          const needsState = definition.renderShape !== 'cube'
            || definition.id === BlockId.Furnace
            || definition.liquid === true;
          const state = needsState ? this.resolveState(worldX, y, worldZ) : undefined;
          const target = this.buffersFor(layers, definition);
          if (definition.liquid) {
            faces += this.addFluid(target, definition, state, world, worldX, y, worldZ);
            continue;
          }
          const meshAsCube = definition.renderShape === 'cube'
            || (definition.renderShape === 'slab' && defaultSlabType(state) === 'double');
          if (definition.renderShape === 'chest') {
            chests.push({ x: worldX, y, z: worldZ });
            continue;
          }
          if (!meshAsCube) {
            faces += this.addSpecial(target, definition, state, world, worldX, y, worldZ);
            continue;
          }
          const east = x < CHUNK_SIZE - 1
            ? blocks[blockIndex + 1] as BlockId
            : (eastChunk?.blocks[yOffset + z * CHUNK_SIZE] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(east, block, worldX + 1, y, worldZ)) {
            this.addCubeFace(target, definition, FACES[0]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const west = x > 0
            ? blocks[blockIndex - 1] as BlockId
            : (westChunk?.blocks[yOffset + z * CHUNK_SIZE + CHUNK_SIZE - 1] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(west, block, worldX - 1, y, worldZ)) {
            this.addCubeFace(target, definition, FACES[1]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const above = y < chunkHeight - 1 ? blocks[blockIndex + CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Air;
          if (this.faceVisible(above, block, worldX, y + 1, worldZ)) {
            this.addCubeFace(target, definition, FACES[2]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const below = y > 0 ? blocks[blockIndex - CHUNK_SIZE * CHUNK_SIZE] as BlockId : BlockId.Bedrock;
          if (this.faceVisible(below, block, worldX, y - 1, worldZ)) {
            this.addCubeFace(target, definition, FACES[3]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const south = z < CHUNK_SIZE - 1
            ? blocks[blockIndex + CHUNK_SIZE] as BlockId
            : (southChunk?.blocks[yOffset + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(south, block, worldX, y, worldZ + 1)) {
            this.addCubeFace(target, definition, FACES[4]!, world, worldX, y, worldZ);
            faces += 1;
          }
          const north = z > 0
            ? blocks[blockIndex - CHUNK_SIZE] as BlockId
            : (northChunk?.blocks[yOffset + (CHUNK_SIZE - 1) * CHUNK_SIZE + x] ?? BlockId.Air) as BlockId;
          if (this.faceVisible(north, block, worldX, y, worldZ - 1)) {
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
      fire: this.toGeometry(layers.fire),
      faces,
      chests,
    };
    const buildEnd = performance.now();
    this.lastProfile = { scanMs: scanEnd - buildStart, geometryMs: buildEnd - scanEnd };
    return result;
  }

  private faceVisible(adjacent: BlockId, block: BlockId, ax: number, ay: number, az: number): boolean {
    if (adjacent === BlockId.Air) return true;
    const adjacentDefinition = getBlockDefinition(adjacent);
    if (adjacentDefinition.renderShape === 'slab') {
      if (defaultSlabType(this.resolveState(ax, ay, az)) === 'double') return false;
    } else if (adjacentDefinition.occludesFaces) return false;
    const adjacentFull = adjacentDefinition.renderShape === 'cube'
      || (adjacentDefinition.renderShape === 'slab' && defaultSlabType(this.resolveState(ax, ay, az)) === 'double');
    return adjacent !== block || !adjacentFull;
  }

  private buffersFor(layers: LayerBuffers, definition: BlockDefinition): GeometryBuffers {
    if (definition.renderShape === 'fire') return layers.fire;
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
    const textureKey = this.cubeFaceTextureKey(definition, face, world, x, y, z);
    const emission = definition.id === BlockId.Furnace
      ? Math.max(0, Math.min(1, world.blockEmissionAt(x, y, z) / 15))
      : Math.max(0, Math.min(1, (definition.emission ?? 0) / 15));
    const localX = x - this.columnOriginX;
    const localZ = z - this.columnOriginZ;
    const biome = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE
      ? this.columnBiomes[localZ * CHUNK_SIZE + localX]!
      : this.biomeCode(world.generator.columnAt(x, z).biome);
    const tint = this.tintFor(definition, textureKey, biome);
    const tile = this.atlas.tile(textureKey);
    const base = buffers.positions.length / 3;
    for (let index = 0; index < 4; index += 1) {
      const corner = face.corners[index]!;
      buffers.positions.push(x + corner[0], y + corner[1], z + corner[2]);
      buffers.normals.push(face.normal[0], face.normal[1], face.normal[2]);
      const cornerLight = this.fastCornerLight(x, y, z, face.normal, corner);
      this.pushLighting(buffers, {
        tint,
        sky: cornerLight.sky / 15,
        block: cornerLight.block / 15,
        emission,
        shade: face.shade * cornerLight.ao,
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
      case 'cross': return this.addCrossPlant(buffers, definition, state, world, x, y, z);
      case 'fire': return this.addFire(buffers, definition, world, x, y, z);
      case 'door': return this.addDoor(buffers, definition, state, world, x, y, z);
      case 'ladder': return this.addLadder(buffers, definition, state, world, x, y, z);
      case 'stairs': return this.addStairs(buffers, definition, state, world, x, y, z);
      case 'slab': return this.addSlab(buffers, definition, state, world, x, y, z);
      case 'fence': return this.addFence(buffers, definition, world, x, y, z);
      case 'rail': return this.addRail(buffers, definition, state, world, x, y, z);
      case 'lantern': return this.addLantern(buffers, definition, state, world, x, y, z);
      case 'chain': return this.addChain(buffers, definition, world, x, y, z);
      case 'farmland': return this.addFarmland(buffers, definition, state, world, x, y, z);
      case 'chest': return 0;
      case 'cube': return 0;
    }
  }

  private addCrossPlant(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const stage = cropTextureStage(definition.id, state);
    const stagedTexture = definition.textures[`stage${stage}` as keyof typeof definition.textures];
    const attached = isStemBlock(definition.id)
      ? attachedStemDirection(world, x, y, z, definition.id)
      : undefined;
    const texture = attached
      ? definition.textures.attached ?? definition.textures.all ?? `block/${definition.key}`
      : stagedTexture ?? definition.textures.all ?? `block/${definition.key}`;
    const lighting = this.lightingFor(world, definition, texture, x, y, z, VEGETATION_LIGHTING_NORMAL, 1);
    if (attached) return this.addAttachedStem(buffers, texture, lighting, x, y, z, attached);
    const inset = 0.08;
    const height = isStemBlock(definition.id) ? Math.max(2 / 16, (cropAge(state) + 1) * 1.75 / 16) : 0.9;
    const planes: readonly (readonly (readonly [number, number, number])[])[] = [
      [
        [x + inset, y, z + inset], [x + 1 - inset, y, z + 1 - inset],
        [x + 1 - inset, y + height, z + 1 - inset], [x + inset, y + height, z + inset],
      ],
      [
        [x + 1 - inset, y, z + inset], [x + inset, y, z + 1 - inset],
        [x + inset, y + height, z + 1 - inset], [x + 1 - inset, y + height, z + inset],
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

  private addAttachedStem(
    buffers: GeometryBuffers,
    texture: string,
    lighting: VertexLighting,
    x: number,
    y: number,
    z: number,
    facing: HorizontalFacing,
  ): number {
    const northSouth = facing === 'north' || facing === 'south';
    const toward = facing === 'north' || facing === 'west' ? -0.48 : 0.48;
    const cx = x + 0.5, cz = z + 0.5;
    const endX = northSouth ? cx : cx + toward;
    const endZ = northSouth ? cz + toward : cz;
    const width = 0.08;
    const corners: Array<[number, number, number]> = northSouth
      ? [[cx - width, y, cz], [endX - width, y, endZ], [endX + width, y + 0.5, endZ], [cx + width, y + 0.5, cz]]
      : [[cx, y, cz + width], [endX, y, endZ + width], [endX, y + 0.5, endZ - width], [cx, y + 0.5, cz - width]];
    const normal = this.quadNormal(corners);
    this.addQuad(buffers, texture, corners, normal, lighting);
    this.addQuad(buffers, texture, [corners[0]!, corners[3]!, corners[2]!, corners[1]!], normal, lighting, [0, 0, 1, 1], true);
    return 2;
  }

  private addFarmland(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const box: LocalBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 15 / 16, maxZ: 1 };
    let faces = 0;
    for (const face of FACES) {
      if (this.localFaceCulled(box, face, world, x, y, z)) continue;
      const texture = face.normal[1] > 0.5
        ? (state?.hydrated ? definition.textures.moist : definition.textures.top) ?? 'block/farmland'
        : face.normal[1] < -0.5
          ? definition.textures.bottom ?? 'block/dirt'
          : definition.textures.side ?? 'block/dirt';
      const corners = face.corners.map((corner) => [
        x + box.minX + corner[0] * (box.maxX - box.minX),
        y + box.minY + corner[1] * (box.maxY - box.minY),
        z + box.minZ + corner[2] * (box.maxZ - box.minZ),
      ] as [number, number, number]);
      this.addQuad(buffers, texture, corners, face.normal,
        this.lightingFor(world, definition, texture, x, y, z, face.normal, face.shade), localFaceUv(face, box));
      faces += 1;
    }
    return faces;
  }

  private addFire(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const lighting = this.lightingFor(world, definition, texture, x, y, z, [0, 1, 0], 1);
    const bright: VertexLighting = {
      tint: WHITE_TINT,
      sky: lighting.sky,
      block: lighting.block,
      emission: 1,
      shade: 1,
    };
    for (const plane of fireBlockPlanes(x, y, z)) {
      this.addLocalUvQuad(buffers, plane.corners, this.quadNormal(plane.corners), bright);
    }
    return FIRE_PLANE_COUNT;
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

  private addLantern(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? 'block/lantern';
    let faces = 0;
    for (const part of lanternMeshCuboids(state)) {
      for (const face of FACES) {
        const uv = face.normal[1] > 0.5
          ? part.uvUp
          : face.normal[1] < -0.5
            ? part.uvDown
            : part.uvSide;
        const corners = face.corners.map((corner) => [
          x + part.box.minX + corner[0] * (part.box.maxX - part.box.minX),
          y + part.box.minY + corner[1] * (part.box.maxY - part.box.minY),
          z + part.box.minZ + corner[2] * (part.box.maxZ - part.box.minZ),
        ] as [number, number, number]);
        this.addQuad(
          buffers,
          texture,
          corners,
          face.normal,
          this.lightingFor(world, definition, texture, x, y, z, face.normal, face.shade),
          uv,
        );
        faces += 1;
      }
    }
    for (const plane of lanternHangerPlanes(state)) {
      const corners = plane.corners.map((corner) => [
        x + corner[0], y + corner[1], z + corner[2],
      ] as [number, number, number]);
      const normal = this.quadNormal(corners);
      const lighting = this.lightingFor(world, definition, texture, x, y, z, normal, 1);
      this.addQuad(buffers, texture, corners, normal, lighting, plane.uv);
      this.addQuad(
        buffers,
        texture,
        [corners[0]!, corners[3]!, corners[2]!, corners[1]!],
        [-normal[0], -normal[1], -normal[2]],
        lighting,
        plane.uv,
        true,
      );
      faces += 2;
    }
    return faces;
  }

  private addChain(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? 'block/chain';
    let faces = 0;
    for (const plane of chainMeshPlanes()) {
      const corners = plane.corners.map((corner) => [
        x + corner[0], y + corner[1], z + corner[2],
      ] as [number, number, number]);
      const normal = this.quadNormal(corners);
      const lighting = this.lightingFor(world, definition, texture, x, y, z, normal, 1);
      this.addQuad(buffers, texture, corners, normal, lighting, plane.uv);
      this.addQuad(
        buffers,
        texture,
        [corners[0]!, corners[3]!, corners[2]!, corners[1]!],
        [-normal[0], -normal[1], -normal[2]],
        lighting,
        plane.uv,
        true,
      );
      faces += 2;
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
    const parts = leverSelectionBoxes(x, y, z, state);
    let faces = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const matrix = part.matrix.clone().scale(new THREE.Vector3(
        1 / part.size[0], 1 / part.size[1], 1 / part.size[2],
      ));
      faces += this.addCuboid(
        buffers, i === 0 ? 'block/stone' : definition.textures.all ?? 'block/lever',
        part.size, matrix, world, definition, x, y, z, i === 0 ? undefined : LEVER_HANDLE_UV,
      );
    }
    return faces;
  }

  private addButton(
    buffers: GeometryBuffers, definition: BlockDefinition, state: BlockRenderState | undefined,
    world: VoxelWorld, x: number, y: number, z: number,
  ): number {
    const part = buttonSelectionBox(x, y, z, state);
    const matrix = part.matrix.clone().scale(new THREE.Vector3(
      1 / part.size[0], 1 / part.size[1], 1 / part.size[2],
    ));
    return this.addCuboid(buffers, 'block/stone', part.size, matrix, world, definition, x, y, z);
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

  private addFence(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? `block/${definition.key}`;
    const boxes = fenceLocalBoxes(fenceConnections(world, x, y, z), 1);
    let faces = 0;
    for (const box of boxes) faces += this.addLocalCuboid(buffers, texture, box, world, definition, x, y, z);
    return faces;
  }

  private addRail(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const texture = definition.textures.all ?? 'block/rail';
    const shape = world ? resolveRailShape(world, x, y, z) : defaultRailShape(state);
    const yaw = railTextureYaw(shape);
    if (yaw === 0) {
      const boxes = railLocalBoxes(shape);
      let faces = 0;
      for (const box of boxes) faces += this.addLocalCuboid(buffers, texture, box, world, definition, x, y, z);
      return faces;
    }
    const height = shape.startsWith('ascending_') ? 8 / 16 : 2 / 16;
    const matrix = new THREE.Matrix4()
      .makeTranslation(x + 0.5, y + height * 0.5, z + 0.5)
      .multiply(new THREE.Matrix4().makeRotationY(yaw));
    return this.addCuboid(buffers, texture, [1, height, 1], matrix, world, definition, x, y, z);
  }

  private addFluid(
    buffers: GeometryBuffers,
    definition: BlockDefinition,
    _state: BlockRenderState | undefined,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): number {
    const geometry = fluidCellGeometry(world, x, y, z);
    if (!geometry) return 0;
    const texture = definition.textures.all ?? `block/${definition.key}`;
    let faces = 0;
    if (geometry.top) {
      const { h00, h10, h01, h11 } = geometry.top;
      const corners: Array<[number, number, number]> = [
        [x, y + h01, z + 1],
        [x + 1, y + h11, z + 1],
        [x + 1, y + h10, z],
        [x, y + h00, z],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        this.quadNormal(corners),
        this.lightingFor(world, definition, texture, x, y, z, [0, 1, 0], 1),
      );
      faces += 1;
    }
    if (geometry.bottom) {
      const corners: Array<[number, number, number]> = [
        [x, y, z],
        [x + 1, y, z],
        [x + 1, y, z + 1],
        [x, y, z + 1],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        [0, -1, 0],
        this.lightingFor(world, definition, texture, x, y, z, [0, -1, 0], 0.58),
      );
      faces += 1;
    }
    if (geometry.sides.px) {
      const h10 = geometry.top?.h10 ?? 1;
      const h11 = geometry.top?.h11 ?? 1;
      const corners: Array<[number, number, number]> = [
        [x + 1, y, z + 1],
        [x + 1, y, z],
        [x + 1, y + h10, z],
        [x + 1, y + h11, z + 1],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        [1, 0, 0],
        this.lightingFor(world, definition, texture, x, y, z, [1, 0, 0], 0.82),
      );
      faces += 1;
    }
    if (geometry.sides.nx) {
      const h00 = geometry.top?.h00 ?? 1;
      const h01 = geometry.top?.h01 ?? 1;
      const corners: Array<[number, number, number]> = [
        [x, y, z],
        [x, y, z + 1],
        [x, y + h01, z + 1],
        [x, y + h00, z],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        [-1, 0, 0],
        this.lightingFor(world, definition, texture, x, y, z, [-1, 0, 0], 0.72),
      );
      faces += 1;
    }
    if (geometry.sides.pz) {
      const h01 = geometry.top?.h01 ?? 1;
      const h11 = geometry.top?.h11 ?? 1;
      const corners: Array<[number, number, number]> = [
        [x, y, z + 1],
        [x + 1, y, z + 1],
        [x + 1, y + h11, z + 1],
        [x, y + h01, z + 1],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        [0, 0, 1],
        this.lightingFor(world, definition, texture, x, y, z, [0, 0, 1], 0.88),
      );
      faces += 1;
    }
    if (geometry.sides.nz) {
      const h00 = geometry.top?.h00 ?? 1;
      const h10 = geometry.top?.h10 ?? 1;
      const corners: Array<[number, number, number]> = [
        [x + 1, y, z],
        [x, y, z],
        [x, y + h00, z],
        [x + 1, y + h10, z],
      ];
      this.addQuad(
        buffers,
        texture,
        corners,
        [0, 0, -1],
        this.lightingFor(world, definition, texture, x, y, z, [0, 0, -1], 0.76),
      );
      faces += 1;
    }
    return faces;
  }

  private quadNormal(corners: readonly (readonly [number, number, number])[]): [number, number, number] {
    const ax = corners[1]![0] - corners[0]![0];
    const ay = corners[1]![1] - corners[0]![1];
    const az = corners[1]![2] - corners[0]![2];
    const bx = corners[3]![0] - corners[0]![0];
    const by = corners[3]![1] - corners[0]![1];
    const bz = corners[3]![2] - corners[0]![2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz) || 1;
    return [nx / length, ny / length, nz / length];
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
      this.pushSurfaceLighting(buffers, lighting, corners[index]!, normal);
    }
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private addLocalUvQuad(
    buffers: GeometryBuffers,
    corners: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
    lighting: VertexLighting,
  ): void {
    const base = buffers.positions.length / 3;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
    for (let index = 0; index < 4; index += 1) {
      buffers.positions.push(...corners[index]!);
      buffers.normals.push(...normal);
      buffers.uvs.push(...uv[index]!);
      this.pushSurfaceLighting(buffers, lighting, corners[index]!, normal);
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

  private pushSurfaceLighting(
    buffers: GeometryBuffers, lighting: VertexLighting,
    vertex: readonly [number, number, number], normal: readonly [number, number, number],
  ): void {
    const origin = lighting.origin;
    if (!origin) { this.pushLighting(buffers, lighting); return; }
    const light = sampleSurfaceVertexLight(this.readLightCell, ...vertex, ...normal, ...origin, this.surfaceLight);
    buffers.colors.push(...lighting.tint);
    buffers.skyLights.push(light.sky / 15);
    buffers.blockLights.push(light.block / 15);
    buffers.faceShades.push(lighting.shade * light.ao);
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
    const sky = this.packedLight('sky', sampleX, sampleY, sampleZ) / 15;
    const block = this.packedLight('block', sampleX, sampleY, sampleZ) / 15;
    const emission = Math.max(0, Math.min(1, world.blockEmissionAt(x, y, z) / 15));
    const biome = columnIndex >= 0 ? this.columnBiomes[columnIndex]! : this.biomeCode(column!.biome);
    return {
      tint: this.tintFor(definition, textureKey, biome),
      sky,
      block,
      emission,
      shade,
      origin: [x, y, z],
    };
  }

  private fastCornerLight(
    x: number, y: number, z: number,
    normal: readonly [number, number, number],
    corner: readonly [number, number, number],
  ): SurfaceLight {
    return sampleSurfaceVertexLight(this.readLightCell, x + corner[0], y + corner[1], z + corner[2],
      ...normal, x, y, z, this.surfaceLight);
  }

  private packedLight(kind: 'sky' | 'block', x: number, y: number, z: number): number {
    const packed = this.packedLightCell(x, y, z);
    return kind === 'sky' ? packed & 15 : (packed >>> 4) & 15;
  }

  private packedLightCell(x: number, y: number, z: number): number {
    if (y < 0) return 256;
    if (y >= WORLD_HEIGHT) return 15;
    let localX = x - this.columnOriginX;
    let localZ = z - this.columnOriginZ;
    let ox = 0;
    let oz = 0;
    if (localX < 0) {
      ox = -1;
      localX += CHUNK_SIZE;
    } else if (localX >= CHUNK_SIZE) {
      ox = 1;
      localX -= CHUNK_SIZE;
    }
    if (localZ < 0) {
      oz = -1;
      localZ += CHUNK_SIZE;
    } else if (localZ >= CHUNK_SIZE) {
      oz = 1;
      localZ -= CHUNK_SIZE;
    }
    const chunk = this.lightNeighbor(ox, oz);
    if (!chunk || localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) return 0;
    const index = y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX;
    return chunk.skyLightAtIndex(index) | (chunk.blockLight[index]! << 4)
      | (getBlockDefinition(chunk.blocks[index]!).occludesFaces ? 256 : 0);
  }

  private lightNeighbor(ox: number, oz: number): Chunk | undefined {
    if (ox === 0 && oz === 0) return this.lightSelf;
    if (ox === 1 && oz === 0) return this.lightEast;
    if (ox === -1 && oz === 0) return this.lightWest;
    if (ox === 0 && oz === 1) return this.lightSouth;
    if (ox === 0 && oz === -1) return this.lightNorth;
    if (ox === 1 && oz === -1) return this.lightNorthEast;
    if (ox === -1 && oz === -1) return this.lightNorthWest;
    if (ox === 1 && oz === 1) return this.lightSouthEast;
    if (ox === -1 && oz === 1) return this.lightSouthWest;
    return undefined;
  }

  private cubeFaceTextureKey(
    definition: BlockDefinition,
    face: Face,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
  ): string {
    if (definition.id === BlockId.Furnace) {
      const facing = world.getBlockState(x, y, z)?.facing ?? DEFAULT_FURNACE_FACING;
      const slot = furnaceCubeFaceSlot(face.normal[0], face.normal[1], face.normal[2], facing);
      return furnaceFaceTextureKey(definition.textures, slot, world.isFurnaceBurning(x, y, z));
    }
    return this.textureForFace(definition, face.texture);
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
