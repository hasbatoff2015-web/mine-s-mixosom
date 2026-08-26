import * as THREE from 'three';
import { TextureAtlas } from '../rendering/TextureAtlas';
import {
  createTexturedCuboidGeometry,
  type TexturedCuboidDefinition,
} from '../rendering/TexturedCuboid';
import {
  bindEntityLightReceiver,
  cloneOwnedEntityMaterial,
  createEntityMaterial,
} from '../rendering/worldLighting';

/** Owns the tiny amount of shared geometry/material state used by entity models. */
export class VoxelVisualFactory {
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly texturedMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly entityTextures = new Map<string, THREE.Texture>();
  private readonly cuboidGeometries = new Map<string, THREE.BufferGeometry>();
  /** Per-entity checkout so one mob's parts can share a clone without sharing across mobs. */
  private entityCheckout?: Map<THREE.Material, THREE.MeshBasicMaterial>;

  beginEntityMaterials(): void {
    this.entityCheckout = new Map();
  }

  endEntityMaterials(): void {
    this.entityCheckout = undefined;
  }

  material(color: number): THREE.MeshBasicMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = createEntityMaterial({ color });
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
    const mesh = new THREE.Mesh(this.cube, this.checkoutMaterial(this.material(color)));
    mesh.scale.set(sizeX, sizeY, sizeZ);
    mesh.position.set(positionX, positionY, positionZ);
    bindEntityLightReceiver(mesh);
    parent.add(mesh);
    return mesh;
  }

  addTexturedCuboid(
    parent: THREE.Object3D,
    definition: TexturedCuboidDefinition,
    position: readonly [number, number, number],
    texturePath: string,
    options: { readonly glow?: boolean; readonly doubleSided?: boolean; readonly alphaTest?: number } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.texturedCuboidGeometry(definition),
      this.checkoutMaterial(
        this.texturedMaterial(texturePath, options.glow === true, options.doubleSided === true, options.alphaTest),
      ),
    );
    mesh.position.set(...position);
    if (options.glow !== true) bindEntityLightReceiver(mesh);
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

  private checkoutMaterial(template: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
    const checkout = this.entityCheckout;
    if (checkout) {
      const existing = checkout.get(template);
      if (existing) return existing;
      const owned = cloneOwnedEntityMaterial(template);
      checkout.set(template, owned);
      return owned;
    }
    return cloneOwnedEntityMaterial(template);
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

  private texturedMaterial(
    texturePath: string,
    glow: boolean,
    doubleSided: boolean,
    requestedAlphaTest?: number,
  ): THREE.MeshBasicMaterial {
    const alphaTest = requestedAlphaTest ?? (glow ? 0.45 : 0.1);
    const key = `${texturePath}:${glow ? 'glow' : 'lit'}:${doubleSided ? 'double' : 'front'}:${alphaTest}`;
    let material = this.texturedMaterials.get(key);
    if (!material) {
      const map = this.entityTexture(texturePath);
      material = createEntityMaterial({
        map,
        alphaTest,
        glow,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
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
