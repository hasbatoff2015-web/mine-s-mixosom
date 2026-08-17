import * as THREE from 'three';
import { TextureAtlas } from '../rendering/TextureAtlas';
import {
  createTexturedCuboidGeometry,
  type TexturedCuboidDefinition,
} from '../rendering/TexturedCuboid';

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
    options: { readonly glow?: boolean; readonly doubleSided?: boolean; readonly alphaTest?: number } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.texturedCuboidGeometry(definition),
      this.texturedMaterial(texturePath, options.glow === true, options.doubleSided === true, options.alphaTest),
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

  private texturedMaterial(texturePath: string, glow: boolean, doubleSided: boolean, requestedAlphaTest?: number): THREE.Material {
    const alphaTest = requestedAlphaTest ?? (glow ? 0.45 : 0.1);
    const key = `${texturePath}:${glow ? 'glow' : 'lit'}:${doubleSided ? 'double' : 'front'}:${alphaTest}`;
    let material = this.texturedMaterials.get(key);
    if (!material) {
      const map = this.entityTexture(texturePath);
      material = glow
        ? new THREE.MeshBasicMaterial({ map, alphaTest, transparent: false, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide })
        : new THREE.MeshLambertMaterial({ map, alphaTest, transparent: false, flatShading: true, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
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
