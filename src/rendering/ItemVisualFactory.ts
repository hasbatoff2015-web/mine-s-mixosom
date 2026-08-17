import * as THREE from 'three';
import { getBlockDefinition, type BlockDefinition } from '../blocks';
import {
  ITEMS,
  getItemDefinition,
  itemRenderProfile,
  type ItemRenderContext,
  type ItemViewTransform,
} from '../items';
import { createGeneratedItemGeometry } from './GeneratedItemGeometry';
import { TextureAtlas, type AtlasTile } from './TextureAtlas';

interface AtlasSource {
  readonly texture: THREE.Texture;
  tile(key: string): AtlasTile;
}

interface ItemVisualFactoryOptions {
  readonly atlas?: AtlasSource;
}

interface CubeFace {
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
  readonly texture: 'top' | 'bottom' | 'side' | 'front';
}

const CUBE_FACES: readonly CubeFace[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], texture: 'side' },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], texture: 'side' },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], texture: 'top' },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], texture: 'bottom' },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], texture: 'side' },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], texture: 'front' },
];

const FULL_TILE: AtlasTile = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });
const DROPPED_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0.07, 0.025, 0.055], [-0.055, 0.045, -0.045], [0.025, 0.075, -0.07],
];

export function droppedVisualCopyCount(stackCount: number): number {
  if (stackCount > 32) return 4;
  if (stackCount > 16) return 3;
  if (stackCount > 1) return 2;
  return 1;
}

export function applyItemViewTransform(object: THREE.Object3D, transform: ItemViewTransform): void {
  object.position.set(...transform.position);
  object.rotation.set(...transform.rotation);
  object.scale.set(...transform.scale);
}

/** Shared cached item-model source for first-person and world item entities. */
export class ItemVisualFactory {
  private readonly blockGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly blockMaterials = new Map<string, THREE.MeshLambertMaterial>();
  private readonly itemMaterials = new Map<string, THREE.MeshLambertMaterial>();
  private readonly itemTextures = new Map<string, THREE.Texture>();
  private readonly generatedGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly fallbackTexture: THREE.Texture;
  private readonly atlas?: AtlasSource;
  private disposed = false;

  constructor(options: ItemVisualFactoryOptions = {}) {
    this.atlas = options.atlas;
    this.fallbackTexture = this.createFallbackTexture();
  }

  async preload(): Promise<void> {
    if (typeof document === 'undefined') return;
    const paths = new Set(ITEMS.filter((item) => item.kind !== 'block').map((item) => item.texture));
    paths.add('item/bow_pulling_0');
    paths.add('item/bow_pulling_1');
    paths.add('item/bow_pulling_2');
    await Promise.all([...paths].map((path) => this.loadGeneratedAsset(path)));
  }

  createItemModel(itemId: string): THREE.Group {
    this.assertActive();
    const definition = getItemDefinition(itemId);
    const root = new THREE.Group();
    root.name = `item-model:${itemId}`;
    root.userData.itemId = itemId;
    root.userData.renderCategory = itemRenderProfile(definition).category;
    root.userData.texturePath = definition.texture;

    if (definition.kind === 'block') {
      const block = getBlockDefinition(definition.blockId);
      const mesh = new THREE.Mesh(this.blockGeometry(block), this.blockMaterial(block));
      mesh.name = `${root.name}:block`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    } else {
      const mesh = this.generatedMesh(definition.texture);
      mesh.name = `${root.name}:generated`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return root;
  }

  setGeneratedTextureVariant(root: THREE.Group, texturePath: string): void {
    if (root.userData.texturePath === texturePath) return;
    const previous = root.children[0];
    if (!previous || !(previous instanceof THREE.Mesh)) return;
    const replacement = this.generatedMesh(texturePath);
    replacement.name = previous.name;
    replacement.castShadow = previous.castShadow;
    replacement.receiveShadow = previous.receiveShadow;
    root.remove(previous);
    root.add(replacement);
    root.userData.texturePath = texturePath;
  }

  createDroppedItemVisual(itemId: string, stackCount = 1): THREE.Group {
    const root = new THREE.Group();
    root.name = `dropped-item:${itemId}`;
    root.userData.itemId = itemId;
    this.updateDroppedItemVisual(root, itemId, stackCount);
    return root;
  }

  updateDroppedItemVisual(root: THREE.Group, itemId: string, stackCount: number): void {
    const copies = droppedVisualCopyCount(stackCount);
    if (root.userData.itemId === itemId && root.userData.visualCopies === copies) return;
    root.clear();
    root.userData.itemId = itemId;
    root.userData.visualCopies = copies;
    const groundTransform = itemRenderProfile(itemId).transforms.ground;
    for (let index = 0; index < copies; index += 1) {
      const model = this.createItemModel(itemId);
      applyItemViewTransform(model, groundTransform);
      const offset = DROPPED_OFFSETS[index]!;
      model.position.x += offset[0];
      model.position.y += offset[1];
      model.position.z += offset[2];
      model.rotation.y += index * 0.18;
      model.rotation.z += index % 2 === 0 ? index * 0.035 : -index * 0.035;
      root.add(model);
    }
  }

  applyContextTransform(object: THREE.Object3D, itemId: string, context: ItemRenderContext): void {
    applyItemViewTransform(object, itemRenderProfile(itemId).transforms[context]);
  }

  get cacheStats(): Readonly<{ blockGeometries: number; itemTextures: number; generatedGeometries: number; materials: number }> {
    return {
      blockGeometries: this.blockGeometries.size,
      itemTextures: this.itemTextures.size,
      generatedGeometries: this.generatedGeometries.size,
      materials: this.blockMaterials.size + this.itemMaterials.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const geometry of this.generatedGeometries.values()) geometry.dispose();
    for (const material of this.blockMaterials.values()) material.dispose();
    for (const material of this.itemMaterials.values()) material.dispose();
    for (const texture of this.itemTextures.values()) texture.dispose();
    this.fallbackTexture.dispose();
    this.blockGeometries.clear();
    this.blockMaterials.clear();
    this.itemMaterials.clear();
    this.itemTextures.clear();
    this.generatedGeometries.clear();
    this.disposed = true;
  }

  private blockGeometry(block: BlockDefinition): THREE.BufferGeometry {
    let geometry = this.blockGeometries.get(block.id);
    if (geometry) return geometry;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const face of CUBE_FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(corner[0] - 0.5, corner[1] - 0.5, corner[2] - 0.5);
        normals.push(...face.normal);
      }
      const tile = this.atlas?.tile(this.textureForFace(block, face.texture)) ?? FULL_TILE;
      uvs.push(tile.u0, tile.v0, tile.u1, tile.v0, tile.u1, tile.v1, tile.u0, tile.v1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    this.blockGeometries.set(block.id, geometry);
    return geometry;
  }

  private blockMaterial(block: BlockDefinition): THREE.MeshLambertMaterial {
    const layer = block.renderLayer;
    let material = this.blockMaterials.get(layer);
    if (material) return material;
    const map = this.atlas?.texture ?? this.fallbackTexture;
    material = new THREE.MeshLambertMaterial({
      map,
      alphaTest: layer === 'cutout' ? 0.42 : 0,
      transparent: layer === 'translucent',
      opacity: layer === 'translucent' ? 0.72 : 1,
      depthWrite: layer !== 'translucent',
      flatShading: true,
    });
    this.blockMaterials.set(layer, material);
    return material;
  }

  private generatedMesh(texturePath: string): THREE.Mesh {
    let geometry = this.generatedGeometries.get(texturePath);
    if (!geometry) {
      geometry = createGeneratedItemGeometry({ width: 1, height: 1, alpha: new Uint8Array([255]) });
      this.generatedGeometries.set(texturePath, geometry);
    }
    let surface = this.itemMaterials.get(texturePath);
    if (!surface) {
      surface = new THREE.MeshLambertMaterial({
        map: this.itemTexture(texturePath),
        alphaTest: 0.08,
        transparent: false,
        side: THREE.FrontSide,
        flatShading: true,
      });
      this.itemMaterials.set(texturePath, surface);
    }
    return new THREE.Mesh(geometry, surface);
  }

  private async loadGeneratedAsset(texturePath: string): Promise<void> {
    if (this.generatedGeometries.has(texturePath) && this.itemTextures.has(texturePath)) return;
    const image = new Image();
    image.decoding = 'async';
    image.src = TextureAtlas.url(texturePath);
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Unable to load item texture: ${texturePath}`));
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error(`Unable to inspect item texture: ${texturePath}`);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3]!;
    const previousGeometry = this.generatedGeometries.get(texturePath);
    previousGeometry?.dispose();
    this.generatedGeometries.set(texturePath, createGeneratedItemGeometry({
      width: canvas.width,
      height: canvas.height,
      alpha,
    }));
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.itemTextures.get(texturePath)?.dispose();
    this.itemTextures.set(texturePath, texture);
  }

  private itemTexture(texturePath: string): THREE.Texture {
    let texture = this.itemTextures.get(texturePath);
    if (texture) return texture;
    texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url(texturePath));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.itemTextures.set(texturePath, texture);
    return texture;
  }

  private textureForFace(block: BlockDefinition, face: CubeFace['texture']): string {
    const textures = block.textures;
    if (face === 'top') return textures.top ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'bottom') return textures.bottom ?? textures.all ?? textures.side ?? 'block/missing';
    if (face === 'front') return textures.front ?? textures.side ?? textures.all ?? 'block/missing';
    return textures.side ?? textures.all ?? textures.top ?? 'block/missing';
  }

  private createFallbackTexture(): THREE.Texture {
    if (typeof document === 'undefined') return new THREE.Texture();
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d332ce';
    context.fillRect(0, 0, 2, 2);
    context.fillStyle = '#171419';
    context.fillRect(0, 0, 1, 1);
    context.fillRect(1, 1, 1, 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('ItemVisualFactory has been disposed');
  }
}
