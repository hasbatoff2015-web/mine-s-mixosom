import * as THREE from 'three';
import { getBlockDefinition, type BlockDefinition } from '../blocks';
import {
  getItemDefinition,
  itemRenderProfile,
  itemVisualFamily,
  type ItemRenderContext,
  type ItemViewTransform,
  type ItemVisualFamily,
} from '../items';
import {
  applyBowDrawPose,
  colorForRole,
  createBowVisual,
  createShieldVisual,
  familyGeometryCacheSize,
  familyParts,
  itemPalette,
} from './ItemFamilyGeometry';
import {
  createButtonItemGeometry,
  createDoorItemGeometry,
  createPlateItemGeometry,
  createTorchItemGeometry,
} from './specialBlockGeometry';
import { TextureAtlas, type AtlasTile } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';

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
const ATLAS_FAMILIES = new Set<ItemVisualFamily>(['torch', 'door', 'button', 'pressure-plate']);

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
  private readonly blockGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly blockMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly colorMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly itemTextures = new Map<string, THREE.Texture>();
  private readonly fallbackTexture: THREE.Texture;
  private readonly atlas?: AtlasSource;
  private disposed = false;

  constructor(options: ItemVisualFactoryOptions = {}) {
    this.atlas = options.atlas;
    this.fallbackTexture = this.createFallbackTexture();
  }

  async preload(): Promise<void> {
    if (typeof document === 'undefined') return;
    this.itemTexture('item/shield');
  }

  createItemModel(itemId: string): THREE.Group {
    this.assertActive();
    const definition = getItemDefinition(itemId);
    const family = itemVisualFamily(definition);
    const root = new THREE.Group();
    root.name = `item-model:${itemId}`;
    root.userData.itemId = itemId;
    root.userData.visualFamily = family;
    root.userData.visualKind = family;
    root.userData.renderCategory = itemRenderProfile(definition).category;
    root.userData.texturePath = definition.texture;

    if (family === 'block-cube' && definition.kind === 'block') {
      const block = getBlockDefinition(definition.blockId);
      const mesh = new THREE.Mesh(this.blockGeometry(block), this.blockMaterial(block));
      mesh.name = `${root.name}:block`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
      return root;
    }

    if (ATLAS_FAMILIES.has(family) && definition.kind === 'block') {
      const block = getBlockDefinition(definition.blockId);
      const mesh = new THREE.Mesh(this.atlasFamilyGeometry(family, block), this.blockMaterial(block));
      mesh.name = `${root.name}:${family}`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
      return root;
    }

    if (family === 'bow') {
      const palette = itemPalette(definition);
      const bow = createBowVisual({
        limb: this.colorMaterial(palette.primary),
        grip: this.colorMaterial(palette.secondary),
        string: this.colorMaterial(palette.accent),
      });
      bow.name = `${root.name}:bow`;
      bindEntityLightReceiver(bow);
      root.add(bow);
      return root;
    }

    if (family === 'shield') {
      const palette = itemPalette(definition);
      const shield = createShieldVisual(
        this.shieldPlateMaterial(),
        this.colorMaterial(palette.secondary),
        this.colorMaterial(palette.accent),
      );
      shield.name = `${root.name}:shield`;
      bindEntityLightReceiver(shield);
      root.add(shield);
      return root;
    }

    this.addPaletteParts(root, family, itemPalette(definition));
    return root;
  }

  applyBowDraw(root: THREE.Group, charge: number): void {
    const bow = root.getObjectByName(`${root.name}:bow`) ?? root;
    applyBowDrawPose(bow, charge);
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

  get cacheStats(): Readonly<{
    blockGeometries: number;
    itemTextures: number;
    familyGeometries: number;
    materials: number;
  }> {
    return {
      blockGeometries: this.blockGeometries.size,
      itemTextures: this.itemTextures.size,
      familyGeometries: familyGeometryCacheSize(),
      materials: this.blockMaterials.size + this.colorMaterials.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    for (const geometry of this.blockGeometries.values()) geometry.dispose();
    for (const material of this.blockMaterials.values()) material.dispose();
    for (const material of this.colorMaterials.values()) material.dispose();
    for (const texture of this.itemTextures.values()) texture.dispose();
    this.fallbackTexture.dispose();
    this.blockGeometries.clear();
    this.blockMaterials.clear();
    this.colorMaterials.clear();
    this.itemTextures.clear();
    this.disposed = true;
  }

  private addPaletteParts(root: THREE.Group, family: ItemVisualFamily, palette: ReturnType<typeof itemPalette>): void {
    const parts = familyParts(family);
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, this.colorMaterial(colorForRole(palette, part.role)));
      mesh.name = `${root.name}:${family}:${part.role}`;
      bindEntityLightReceiver(mesh);
      root.add(mesh);
    }
  }

  private atlasFamilyGeometry(family: ItemVisualFamily, block: BlockDefinition): THREE.BufferGeometry {
    const key = `${family}:${block.id}`;
    let geometry = this.blockGeometries.get(key);
    if (geometry) return geometry;
    const texture = this.textureForFace(block, 'front');
    const tile = this.atlas?.tile(texture) ?? FULL_TILE;
    if (family === 'torch') geometry = createTorchItemGeometry(tile);
    else if (family === 'door') geometry = createDoorItemGeometry(tile);
    else if (family === 'button') geometry = createButtonItemGeometry(tile);
    else geometry = createPlateItemGeometry(tile);
    this.blockGeometries.set(key, geometry);
    return geometry;
  }

  private blockGeometry(block: BlockDefinition): THREE.BufferGeometry {
    const key = `cube:${block.id}`;
    let geometry = this.blockGeometries.get(key);
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
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.blockGeometries.set(key, geometry);
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

  private colorMaterial(hex: number): THREE.MeshBasicMaterial {
    let material = this.colorMaterials.get(hex);
    if (material) return material;
    material = createEntityMaterial({ color: hex });
    this.colorMaterials.set(hex, material);
    return material;
  }

  private shieldPlateMaterial(): THREE.MeshBasicMaterial {
    const key = 0x1000000;
    let material = this.colorMaterials.get(key);
    if (material) return material;
    material = createEntityMaterial({ map: this.itemTexture('item/shield') });
    this.colorMaterials.set(key, material);
    return material;
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
