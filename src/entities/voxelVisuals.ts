import * as THREE from 'three';
import { getBlockDefinition } from '../blocks';
import { getItemDefinition } from '../items';
import { TextureAtlas } from '../rendering/TextureAtlas';
import {
  createTexturedCuboidGeometry,
  type TexturedCuboidDefinition,
} from '../rendering/TexturedCuboid';

const CATEGORY_COLORS: Readonly<Record<string, number>> = {
  air: 0xbfdfff,
  terrain: 0x79664a,
  wood: 0x8a633d,
  ore: 0x777777,
  building: 0x9a8f82,
  decoration: 0x6c9a55,
  utility: 0x8c7358,
  wool: 0xeeeeee,
  redstone: 0xa72020,
  liquid: 0x3f70d8,
};

const ITEM_COLORS: Readonly<Record<string, number>> = {
  coal: 0x272727,
  charcoal: 0x333333,
  iron_ingot: 0xd8d4c7,
  gold_ingot: 0xf3cf43,
  diamond: 0x56e3d6,
  redstone_dust: 0xb52222,
  stick: 0x865b35,
  string: 0xe2e2df,
  feather: 0xf3f3e9,
  leather: 0x9b592f,
  gunpowder: 0x686c66,
  arrow: 0xa8a18f,
  beef: 0xa9473f,
  porkchop: 0xe38686,
  chicken: 0xe0b18f,
  apple: 0xcb2933,
  bread: 0xd6a34d,
};

function hashColor(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.48, 0.54).getHex();
}

function itemColor(itemId: string): number {
  const explicit = ITEM_COLORS[itemId];
  if (explicit !== undefined) return explicit;
  const definition = getItemDefinition(itemId);
  if (definition.kind === 'block') {
    const block = getBlockDefinition(definition.blockId);
    if (block.key === 'grass_block') return 0x6f984a;
    if (block.key.includes('leaves')) return 0x507b3d;
    if (block.key.includes('water')) return 0x416fd0;
    if (block.key.includes('lava')) return 0xe46122;
    if (block.key.includes('sand')) return 0xd8ca83;
    const category = CATEGORY_COLORS[block.category];
    if (category !== undefined) return category;
  }
  return hashColor(itemId);
}

/** Owns the tiny amount of shared geometry/material state used by entity models. */
export class VoxelVisualFactory {
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  private readonly texturedMaterials = new Map<string, THREE.Material>();
  private readonly entityTextures = new Map<string, THREE.Texture>();
  private readonly cuboidGeometries = new Map<string, THREE.BufferGeometry>();

  material(color: number): THREE.MeshLambertMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.materials.set(color, material);
    }
    return material;
  }

  addBox(
    parent: THREE.Object3D,
    size: Readonly<THREE.Vector3> | readonly [number, number, number],
    position: Readonly<THREE.Vector3> | readonly [number, number, number],
    color: number,
  ): THREE.Mesh {
    const sizeX = 'x' in size ? size.x : size[0];
    const sizeY = 'y' in size ? size.y : size[1];
    const sizeZ = 'z' in size ? size.z : size[2];
    const positionX = 'x' in position ? position.x : position[0];
    const positionY = 'y' in position ? position.y : position[1];
    const positionZ = 'z' in position ? position.z : position[2];
    const mesh = new THREE.Mesh(this.cube, this.material(color));
    mesh.scale.set(sizeX, sizeY, sizeZ);
    mesh.position.set(positionX, positionY, positionZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  addTexturedCuboid(
    parent: THREE.Object3D,
    definition: TexturedCuboidDefinition,
    position: readonly [number, number, number],
    texturePath: string,
    options: { readonly glow?: boolean } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.texturedCuboidGeometry(definition),
      this.texturedMaterial(texturePath, options.glow === true),
    );
    mesh.position.set(...position);
    mesh.castShadow = !options.glow;
    mesh.receiveShadow = !options.glow;
    parent.add(mesh);
    return mesh;
  }

  addPivotCuboid(
    parent: THREE.Object3D,
    definition: TexturedCuboidDefinition,
    pivot: readonly [number, number, number],
    offset: readonly [number, number, number],
    texturePath: string,
    options: { readonly glow?: boolean } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.position.set(...pivot);
    this.addTexturedCuboid(group, definition, offset, texturePath, options);
    parent.add(group);
    return group;
  }

  createDroppedItem(itemId: string): THREE.Group {
    const definition = getItemDefinition(itemId);
    const group = new THREE.Group();
    group.name = `dropped-item:${itemId}`;
    if (definition.kind === 'block') {
      this.addBox(group, [0.28, 0.28, 0.28], [0, 0, 0], itemColor(itemId));
    } else {
      const color = itemColor(itemId);
      const first = this.addBox(group, [0.3, 0.3, 0.045], [0, 0, 0], color);
      const second = this.addBox(group, [0.045, 0.3, 0.3], [0, 0, 0], color);
      first.rotation.z = Math.PI / 12;
      second.rotation.z = -Math.PI / 12;
    }
    return group;
  }

  dispose(): void {
    this.cube.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const material of this.texturedMaterials.values()) material.dispose();
    this.texturedMaterials.clear();
    for (const texture of this.entityTextures.values()) texture.dispose();
    this.entityTextures.clear();
    for (const geometry of this.cuboidGeometries.values()) geometry.dispose();
    this.cuboidGeometries.clear();
  }

  private texturedCuboidGeometry(definition: TexturedCuboidDefinition): THREE.BufferGeometry {
    const key = JSON.stringify(definition);
    let geometry = this.cuboidGeometries.get(key);
    if (!geometry) {
      geometry = createTexturedCuboidGeometry(definition);
      this.cuboidGeometries.set(key, geometry);
    }
    return geometry;
  }

  private texturedMaterial(texturePath: string, glow: boolean): THREE.Material {
    const key = `${texturePath}:${glow ? 'glow' : 'lit'}`;
    let material = this.texturedMaterials.get(key);
    if (!material) {
      const map = this.entityTexture(texturePath);
      material = glow
        ? new THREE.MeshBasicMaterial({ map, alphaTest: 0.45, transparent: false })
        : new THREE.MeshLambertMaterial({ map, alphaTest: 0.1, transparent: false, flatShading: true });
      this.texturedMaterials.set(key, material);
    }
    return material;
  }

  private entityTexture(texturePath: string): THREE.Texture {
    let texture = this.entityTextures.get(texturePath);
    if (!texture) {
      texture = typeof document === 'undefined'
        ? new THREE.Texture()
        : new THREE.TextureLoader().load(TextureAtlas.url(texturePath));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      this.entityTextures.set(texturePath, texture);
    }
    return texture;
  }
}
