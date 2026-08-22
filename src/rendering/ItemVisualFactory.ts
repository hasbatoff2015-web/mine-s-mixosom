import * as THREE from 'three';
import { getBlockDefinition, type BlockDefinition } from '../blocks';
import {
  ITEMS,
  generatedHeldTexturePath,
  getItemDefinition,
  itemHeldMeshKind,
  itemIconDescriptor,
  itemRenderProfile,
  itemUsesGeneratedHeldGeometry,
  OAK_DOOR_HELD_TEXTURE,
  type ItemRenderContext,
  type ItemViewTransform,
} from '../items';
import {
  slabLocalBoxes,
  stairLocalBoxes,
  type LocalBox,
} from './specialBlockGeometry';
import {
  createGeneratedItemGeometry,
  type GeneratedItemMask,
} from './GeneratedItemGeometry';
import { TextureAtlas, type AtlasTile } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';
import { CHEST_TEXTURE_KEY, createClosedChestGeometry } from './chestModel';

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

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function heldLocalFaceUv(
  normal: readonly [number, number, number],
  box: LocalBox,
): readonly [number, number, number, number] {
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];
  if (nx > 0) return [box.maxZ, box.minY, box.minZ, box.maxY];
  if (nx < 0) return [box.minZ, box.minY, box.maxZ, box.maxY];
  if (ny > 0) return [box.minX, box.maxZ, box.maxX, box.minZ];
  if (ny < 0) return [box.minX, box.minZ, box.maxX, box.maxZ];
  if (nz > 0) return [box.minX, box.minY, box.maxX, box.maxY];
  return [box.maxX, box.minY, box.minX, box.maxY];
}

export function specialPreviewEntityTexturePaths(): string[] {
  const paths = new Set<string>();
  for (const item of ITEMS) {
    if (itemIconDescriptor(item).kind !== 'special_preview') continue;
    if (item.kind === 'block' && getBlockDefinition(item.blockId).renderShape === 'chest') {
      paths.add(CHEST_TEXTURE_KEY);
    }
  }
  return [...paths];
}

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
  private readonly blockMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly itemMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly itemTextures = new Map<string, THREE.Texture>();
  private readonly generatedGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly generatedMasks = new Map<string, GeneratedItemMask>();
  private readonly specialHeldGeometries = new Map<string, THREE.BufferGeometry>();
  private chestEntityMaterial?: THREE.MeshBasicMaterial;
  private readonly fallbackTexture: THREE.Texture;
  private readonly atlas?: AtlasSource;
  private disposed = false;

  constructor(options: ItemVisualFactoryOptions = {}) {
    this.atlas = options.atlas;
    this.fallbackTexture = this.createFallbackTexture();
  }

  async preload(): Promise<void> {
    if (typeof document === 'undefined') return;
    const paths = new Set(
      ITEMS.filter((item) => itemUsesGeneratedHeldGeometry(item)).map((item) => generatedHeldTexturePath(item)),
    );
    paths.add('item/bow_pulling_0');
    paths.add('item/bow_pulling_1');
    paths.add('item/bow_pulling_2');
    await Promise.all([
      ...[...paths].map((path) => this.loadGeneratedAsset(path)),
      ...specialPreviewEntityTexturePaths().map((path) => this.ensureDecodedTexture(path)),
    ]);
  }

  createItemModel(itemId: string): THREE.Group {
    this.assertActive();
    const definition = getItemDefinition(itemId);
    const root = new THREE.Group();
    root.name = `item-model:${itemId}`;
    root.userData.itemId = itemId;
    root.userData.renderCategory = itemRenderProfile(definition).category;
    root.userData.heldMeshKind = itemHeldMeshKind(definition);
    root.userData.texturePath = generatedHeldTexturePath(definition);

    const meshKind = itemHeldMeshKind(definition);
    if (meshKind === 'generated') {
      const mesh = this.generatedMesh(generatedHeldTexturePath(definition));
      mesh.name = `${root.name}:generated`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
    } else if (meshKind === 'special_model' && definition.kind === 'block') {
      const block = getBlockDefinition(definition.blockId);
      const mesh = block.renderShape === 'chest'
        ? new THREE.Mesh(this.specialHeldGeometry(definition.id), this.chestMaterial())
        : new THREE.Mesh(this.specialHeldGeometry(definition.id), this.blockMaterial(block));
      mesh.name = `${root.name}:special`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
    } else if (definition.kind === 'block') {
      const block = getBlockDefinition(definition.blockId);
      const mesh = new THREE.Mesh(this.blockGeometry(block), this.blockMaterial(block));
      mesh.name = `${root.name}:block`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
    } else {
      throw new Error(`Item ${definition.id} has no held visual path`);
    }
    return root;
  }

  setGeneratedTextureVariant(root: THREE.Group, texturePath: string): void {
    if (root.userData.texturePath === texturePath) return;
    const previous = root.children[0];
    if (!previous || !(previous instanceof THREE.Mesh)) return;
    const replacement = this.generatedMesh(texturePath);
    replacement.name = previous.name;
    bindEntityLightReceiver(replacement);
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

  getGeneratedMask(texturePath: string): GeneratedItemMask | undefined {
    return this.generatedMasks.get(texturePath);
  }

  getGeneratedGeometry(texturePath: string): THREE.BufferGeometry | undefined {
    return this.generatedGeometries.get(texturePath);
  }

  generatedTextureDataUrl(texturePath: string): string | undefined {
    const image = this.itemTextures.get(texturePath)?.image as { toDataURL?: () => string } | undefined;
    return typeof image?.toDataURL === 'function' ? image.toDataURL() : undefined;
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
    for (const geometry of this.specialHeldGeometries.values()) geometry.dispose();
    for (const material of this.blockMaterials.values()) material.dispose();
    for (const material of this.itemMaterials.values()) material.dispose();
    for (const texture of this.itemTextures.values()) texture.dispose();
    this.fallbackTexture.dispose();
    this.blockGeometries.clear();
    this.blockMaterials.clear();
    this.itemMaterials.clear();
    this.itemTextures.clear();
    this.generatedGeometries.clear();
    this.generatedMasks.clear();
    this.specialHeldGeometries.clear();
    this.chestEntityMaterial?.dispose();
    this.chestEntityMaterial = undefined;
    this.disposed = true;
  }

  private specialHeldGeometry(itemId: string): THREE.BufferGeometry {
    let geometry = this.specialHeldGeometries.get(itemId);
    if (geometry) return geometry;
    const item = getItemDefinition(itemId);
    if (item.kind !== 'block') throw new Error(`No special held model for ${itemId}`);
    const block = getBlockDefinition(item.blockId);
    const texture = block.textures.all ?? block.textures.side ?? `block/${block.key}`;
    switch (block.renderShape) {
      case 'button':
        geometry = this.atlasCuboidGeometry([6 / 16, 4 / 16, 4 / 16], [0, 0, 0], texture);
        break;
      case 'pressure_plate':
        geometry = this.atlasCuboidGeometry(
          [14 / 16, 1 / 16, 14 / 16],
          [0, -0.5 + 1 / 32, 0],
          texture,
        );
        break;
      case 'stairs':
        geometry = this.geometryFromLocalBoxes(stairLocalBoxes('east', 'bottom', 'straight'), texture);
        break;
      case 'slab':
        geometry = this.geometryFromLocalBoxes(slabLocalBoxes('bottom'), texture);
        break;
      case 'chest':
        geometry = createClosedChestGeometry();
        break;
      default:
        throw new Error(`No special held model for ${itemId}`);
    }
    this.specialHeldGeometries.set(itemId, geometry);
    return geometry;
  }

  private geometryFromLocalBoxes(boxes: readonly LocalBox[], textureKey: string): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const tile = this.atlas?.tile(textureKey) ?? FULL_TILE;
    for (const box of boxes) {
      for (const face of CUBE_FACES) {
        const base = positions.length / 3;
        const uv = heldLocalFaceUv(face.normal, box);
        const u0 = lerp(tile.u0, tile.u1, uv[0]);
        const v0 = lerp(tile.v0, tile.v1, uv[1]);
        const u1 = lerp(tile.u0, tile.u1, uv[2]);
        const v1 = lerp(tile.v0, tile.v1, uv[3]);
        for (const corner of face.corners) {
          positions.push(
            box.minX + corner[0] * (box.maxX - box.minX) - 0.5,
            box.minY + corner[1] * (box.maxY - box.minY) - 0.5,
            box.minZ + corner[2] * (box.maxZ - box.minZ) - 0.5,
          );
          normals.push(...face.normal);
        }
        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.userData.specialHeldModel = true;
    geometry.userData.specialHeldBoxes = boxes.length;
    return geometry;
  }

  private atlasCuboidGeometry(
    size: readonly [number, number, number],
    center: readonly [number, number, number],
    textureKey: string,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const tile = this.atlas?.tile(textureKey) ?? FULL_TILE;
    for (const face of CUBE_FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(
          (corner[0] - 0.5) * size[0] + center[0],
          (corner[1] - 0.5) * size[1] + center[1],
          (corner[2] - 0.5) * size[2] + center[2],
        );
        normals.push(...face.normal);
      }
      uvs.push(tile.u0, tile.v0, tile.u1, tile.v0, tile.u1, tile.v1, tile.u0, tile.v1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.userData.specialHeldModel = true;
    return geometry;
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

  private blockMaterial(block: BlockDefinition): THREE.MeshBasicMaterial {
    const layer = block.renderLayer;
    let material = this.blockMaterials.get(layer);
    if (material) return material;
    const map = this.atlas?.texture ?? this.fallbackTexture;
    material = createEntityMaterial({
      map,
      alphaTest: layer === 'cutout' ? 0.42 : 0,
      transparent: layer === 'translucent',
      opacity: layer === 'translucent' ? 0.72 : 1,
      depthWrite: layer !== 'translucent',
    });
    this.blockMaterials.set(layer, material);
    return material;
  }

  private chestMaterial(): THREE.MeshBasicMaterial {
    if (this.chestEntityMaterial) return this.chestEntityMaterial;
    this.chestEntityMaterial = createEntityMaterial({
      map: this.itemTexture(CHEST_TEXTURE_KEY),
      wrap: false,
    });
    this.chestEntityMaterial.userData.chestEntityTexture = CHEST_TEXTURE_KEY;
    return this.chestEntityMaterial;
  }

  private generatedMesh(texturePath: string): THREE.Mesh {
    let geometry = this.generatedGeometries.get(texturePath);
    if (!geometry) {
      geometry = createGeneratedItemGeometry({ width: 1, height: 1, alpha: new Uint8Array([255]) });
      this.generatedGeometries.set(texturePath, geometry);
    }
    let surface = this.itemMaterials.get(texturePath);
    if (!surface) {
      surface = createEntityMaterial({
        map: this.itemTexture(texturePath),
        alphaTest: 0.08,
        side: THREE.FrontSide,
        wrap: false,
      });
      this.itemMaterials.set(texturePath, surface);
    }
    return new THREE.Mesh(geometry, surface);
  }

  private async loadGeneratedAsset(texturePath: string): Promise<void> {
    if (this.generatedGeometries.has(texturePath) && this.itemTextures.has(texturePath)) return;
    if (texturePath === OAK_DOOR_HELD_TEXTURE) {
      await this.loadCompositedDoorAsset();
      return;
    }
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
    const mask: GeneratedItemMask = {
      width: canvas.width,
      height: canvas.height,
      alpha,
    };
    this.generatedMasks.set(texturePath, mask);
    this.generatedGeometries.set(texturePath, createGeneratedItemGeometry(mask));
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

  /**
   * Vanilla oak_door item is `item/generated` + `item/oak_door.png`. Faithful 1.21.8
   * in this repo only ships block halves, so stack upper/lower into a square sprite.
   */
  private async loadCompositedDoorAsset(): Promise<void> {
    const upper = await this.loadImageElement(TextureAtlas.url('block/oak_door_upper'));
    const lower = await this.loadImageElement(TextureAtlas.url('block/oak_door'));
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to composite oak door item texture');
    context.imageSmoothingEnabled = false;
    context.drawImage(upper, 0, 0, upper.naturalWidth, upper.naturalHeight, 0, 0, size, size / 2);
    context.drawImage(lower, 0, 0, lower.naturalWidth, lower.naturalHeight, 0, size / 2, size, size / 2);
    const rgba = context.getImageData(0, 0, size, size).data;
    const alpha = new Uint8Array(size * size);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3]!;
    this.generatedGeometries.get(OAK_DOOR_HELD_TEXTURE)?.dispose();
    const mask: GeneratedItemMask = { width: size, height: size, alpha };
    this.generatedMasks.set(OAK_DOOR_HELD_TEXTURE, mask);
    this.generatedGeometries.set(OAK_DOOR_HELD_TEXTURE, createGeneratedItemGeometry(mask));
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.itemTextures.get(OAK_DOOR_HELD_TEXTURE)?.dispose();
    this.itemTextures.set(OAK_DOOR_HELD_TEXTURE, texture);
  }

  private loadImageElement(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load ${url}`));
      image.src = url;
    });
  }

  private async ensureDecodedTexture(texturePath: string): Promise<void> {
    const existing = this.itemTextures.get(texturePath);
    if (existing?.image) return;
    const image = await this.loadImageElement(TextureAtlas.url(texturePath));
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
