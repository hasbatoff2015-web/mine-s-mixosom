import * as THREE from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import type { BlockDefinition, BlockRenderState, HorizontalFacing, StairShape } from '../blocks';
import type { VoxelHit, VoxelWorld } from '../world/World';
import {
  fenceConnections,
  resolveStairShape,
  selectionShapeKey,
  type BlockNeighborView,
} from '../world/blockGeometry';
import {
  selectionBoxesForBlock,
  type OrientedSelectionBox,
} from './specialBlockGeometry';
import { TextureAtlas } from './TextureAtlas';
import { breakingStagePixels, BREAKING_STAGE_COUNT, BREAKING_STAGE_SIZE } from './breakingOverlayPixels';
import { composeWorldLight, worldDaylightUniform } from './worldLighting';

/** After fire (4), before the yellow selection outline (10). */
export const BREAKING_OVERLAY_RENDER_ORDER = 5;
export const BREAKING_STAGE_MIN = 0;
export const BREAKING_STAGE_MAX = 9;
export const BREAKING_TEXTURE_DIR = 'gui/destroy';

export interface BreakingOverlaySnapshot {
  readonly visible: boolean;
  readonly stage: number | null;
  readonly shapeKey: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly map: THREE.Texture | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly geometryCacheSize: number;
}

/**
 * Minecraft Java mapping:
 * progress in (0, 1) → floor(progress * 10) clamped to 0..9.
 * progress <= 0 or >= 1 → overlay hidden (not yet mining / already broken).
 */
export function breakingStage(progress: number): number | null {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return null;
  return Math.min(BREAKING_STAGE_MAX, Math.floor(progress * 10));
}

export function breakingTextureKey(stage: number): string {
  const clamped = Math.min(BREAKING_STAGE_MAX, Math.max(BREAKING_STAGE_MIN, stage | 0));
  return `${BREAKING_TEXTURE_DIR}/destroy_stage_${clamped}`;
}

function fenceNeighborView(
  connections: Readonly<Record<HorizontalFacing, boolean>>,
): BlockNeighborView {
  return {
    getBlock(x, y, z) {
      if (y !== 0) return BlockId.Air;
      if (x === 0 && z === -1) return connections.north ? BlockId.OakFence : BlockId.Air;
      if (x === 0 && z === 1) return connections.south ? BlockId.OakFence : BlockId.Air;
      if (x === 1 && z === 0) return connections.east ? BlockId.OakFence : BlockId.Air;
      if (x === -1 && z === 0) return connections.west ? BlockId.OakFence : BlockId.Air;
      return BlockId.Air;
    },
  };
}

export function breakingOverlayShapeKey(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state: BlockRenderState | undefined,
  stairShape: StairShape | '' = '',
  fence?: Readonly<Record<HorizontalFacing, boolean>>,
): string {
  const base = selectionShapeKey(definition, state, stairShape);
  if (!fence) return base;
  return `${base}|f${Number(fence.north)}${Number(fence.south)}${Number(fence.east)}${Number(fence.west)}`;
}

export function breakingOverlayBoxes(
  definition: Pick<BlockDefinition, 'renderShape'>,
  state: BlockRenderState | undefined,
  stairShape: StairShape | '' = '',
  fence?: Readonly<Record<HorizontalFacing, boolean>>,
): OrientedSelectionBox[] {
  const neighbor = fence ? fenceNeighborView(fence) : undefined;
  return selectionBoxesForBlock(
    definition,
    state,
    0,
    0,
    0,
    neighbor,
    stairShape || 'straight',
  );
}

/** Six UV-0..1 quads per oriented selection box. Local voxel space, not chunk space. */
export function createBreakingOverlayGeometry(
  boxes: readonly OrientedSelectionBox[],
): THREE.BufferGeometry {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const sourcePosition = unit.getAttribute('position');
  const sourceUv = unit.getAttribute('uv');
  const sourceIndex = unit.getIndex();
  const vertexCount = sourcePosition.count;
  const positions = new Float32Array(vertexCount * 3 * boxes.length);
  const uvs = new Float32Array(vertexCount * 2 * boxes.length);
  const indices: number[] = [];
  const vertex = new THREE.Vector3();
  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
    const box = boxes[boxIndex]!;
    const base = boxIndex * vertexCount;
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      vertex.fromBufferAttribute(sourcePosition, vertexIndex).applyMatrix4(box.matrix);
      const positionOffset = (base + vertexIndex) * 3;
      positions[positionOffset] = vertex.x;
      positions[positionOffset + 1] = vertex.y;
      positions[positionOffset + 2] = vertex.z;
      const uvOffset = (base + vertexIndex) * 2;
      uvs[uvOffset] = sourceUv.getX(vertexIndex);
      uvs[uvOffset + 1] = sourceUv.getY(vertexIndex);
    }
    if (sourceIndex) {
      for (let index = 0; index < sourceIndex.count; index += 1) {
        indices.push(base + sourceIndex.getX(index));
      }
    }
  }
  unit.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (indices.length > 0) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createStageTexture(stage: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    breakingStagePixels(stage),
    BREAKING_STAGE_SIZE,
    BREAKING_STAGE_SIZE,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  if (typeof document !== 'undefined') {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const loaded = new THREE.Texture(image);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.magFilter = THREE.NearestFilter;
      loaded.minFilter = THREE.NearestFilter;
      loaded.generateMipmaps = false;
      loaded.wrapS = THREE.ClampToEdgeWrapping;
      loaded.wrapT = THREE.ClampToEdgeWrapping;
      loaded.flipY = true;
      loaded.needsUpdate = true;
      replaceStageTexture(stage, loaded);
    };
    image.onerror = () => {
      // Keep the original procedural mask. Production must not require a missing file.
    };
    image.src = TextureAtlas.url(breakingTextureKey(stage));
  }
  return texture;
}

let stageTextures: THREE.Texture[] | undefined;
const textureListeners = new Set<(stage: number, texture: THREE.Texture) => void>();

function replaceStageTexture(stage: number, texture: THREE.Texture): void {
  const pack = breakingStageTextures();
  pack[stage] = texture;
  for (const listener of textureListeners) listener(stage, texture);
}

export function breakingStageTextures(): THREE.Texture[] {
  if (!stageTextures) {
    stageTextures = Array.from({ length: BREAKING_STAGE_COUNT }, (_, stage) => createStageTexture(stage));
  }
  return stageTextures;
}

function createBreakingMaterial(): THREE.MeshBasicMaterial {
  const textures = breakingStageTextures();
  return new THREE.MeshBasicMaterial({
    map: textures[0],
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: false,
    alphaTest: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}

export type BlockRenderStateResolver = (x: number, y: number, z: number) => BlockRenderState | undefined;

/**
 * Local-player visual overlay. Does not mutate the world and is not break authority.
 * A later `breakerId` map can sit beside this single mesh without changing mining.
 */
export class BlockBreakingOverlay {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private stage: number | null = null;
  private shapeKey = '';
  private progress = Number.NaN;
  private targetX = Number.NaN;
  private targetY = Number.NaN;
  private targetZ = Number.NaN;
  private targetBlock = BlockId.Air;
  private disposed = false;
  private readonly onTexture = (stage: number, texture: THREE.Texture): void => {
    if (this.disposed || this.stage !== stage) return;
    this.material.map = texture;
    this.material.needsUpdate = true;
  };

  constructor(
    private readonly world: VoxelWorld,
    private readonly resolveState: BlockRenderStateResolver = () => undefined,
  ) {
    this.group.name = 'block-breaking-overlay';
    this.material = createBreakingMaterial();
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'block-breaking-overlay:mesh';
    this.mesh.visible = false;
    this.mesh.renderOrder = BREAKING_OVERLAY_RENDER_ORDER;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = true;
    this.group.add(this.mesh);
    textureListeners.add(this.onTexture);
  }

  setProgress(hit?: VoxelHit, progress = 0): void {
    if (this.disposed) return;
    const stage = breakingStage(progress);
    if (!hit || stage === null) {
      this.hide();
      return;
    }
    if (this.world.getBlock(hit.x, hit.y, hit.z, false) !== hit.block || hit.block === BlockId.Air) {
      this.hide();
      return;
    }
    if (
      this.mesh.visible
      && this.progress === progress
      && this.targetX === hit.x
      && this.targetY === hit.y
      && this.targetZ === hit.z
      && this.targetBlock === hit.block
    ) {
      return;
    }
    this.progress = progress;
    this.targetX = hit.x;
    this.targetY = hit.y;
    this.targetZ = hit.z;
    this.targetBlock = hit.block;
    const definition = getBlockDefinition(hit.block);
    if (definition.breakable === false || definition.hardness < 0) {
      this.hide();
      return;
    }
    const state = this.resolveState(hit.x, hit.y, hit.z);
    const stairShape = definition.renderShape === 'stairs'
      ? resolveStairShape(this.world, hit.x, hit.y, hit.z, state)
      : '';
    const fence = definition.renderShape === 'fence'
      ? fenceConnections(this.world, hit.x, hit.y, hit.z)
      : undefined;
    const key = breakingOverlayShapeKey(definition, state, stairShape, fence);
    if (key !== this.shapeKey) {
      let geometry = this.geometries.get(key);
      if (!geometry) {
        geometry = createBreakingOverlayGeometry(breakingOverlayBoxes(definition, state, stairShape, fence));
        this.geometries.set(key, geometry);
      }
      this.mesh.geometry = geometry;
      this.shapeKey = key;
    }
    if (this.stage !== stage) {
      this.material.map = breakingStageTextures()[stage] ?? null;
      this.stage = stage;
    }
    this.tintFromWorldLight(hit.x, hit.y, hit.z);
    this.mesh.position.set(hit.x, hit.y, hit.z);
    this.mesh.updateMatrix();
    this.mesh.visible = true;
  }

  snapshot(): BreakingOverlaySnapshot {
    return {
      visible: this.mesh.visible,
      stage: this.stage,
      shapeKey: this.shapeKey,
      geometry: this.mesh.geometry,
      material: this.material,
      map: this.material.map,
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
      geometryCacheSize: this.geometries.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    textureListeners.delete(this.onTexture);
    this.hide();
    this.group.remove(this.mesh);
    this.material.dispose();
    const cached = new Set(this.geometries.values());
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    if (!cached.has(this.mesh.geometry)) this.mesh.geometry.dispose();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private hide(): void {
    this.mesh.visible = false;
    this.stage = null;
    this.progress = Number.NaN;
    this.targetX = Number.NaN;
    this.targetY = Number.NaN;
    this.targetZ = Number.NaN;
    this.targetBlock = BlockId.Air;
  }

  private tintFromWorldLight(x: number, y: number, z: number): void {
    const sky = this.world.skyLightAt(x, y, z) / 15;
    const block = this.world.blockLightAt(x, y, z) / 15;
    const [red, green, blue] = composeWorldLight(sky, block, 0, 1, worldDaylightUniform.value);
    const luminance = (red + green + blue) / 3;
    const shade = 0.42 + 0.58 * Math.min(1, Math.max(0, luminance));
    this.material.color.setRGB(shade, shade, shade);
  }
}
