import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';

/** Shared crossed-plane projectile model using the legacy arrow entity sheet. */
export class ArrowVisualFactory {
  private readonly geometry = createArrowGeometry();
  private readonly texture: THREE.Texture;
  private readonly material: THREE.MeshLambertMaterial;

  constructor() {
    this.texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url('entity/arrow'));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.MeshLambertMaterial({
      map: this.texture,
      alphaTest: 0.08,
      transparent: false,
      side: THREE.DoubleSide,
    });
  }

  create(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'arrow-projectile';
    mesh.castShadow = true;
    return mesh;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function createArrowGeometry(): THREE.BufferGeometry {
  const positions = [
    -0.10, 0, -0.48, 0.10, 0, -0.48, 0.10, 0, 0.48, -0.10, 0, 0.48,
    0, -0.10, -0.48, 0, 0.10, -0.48, 0, 0.10, 0.48, 0, -0.10, 0.48,
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ];
  // The legacy 32×32 sheet stores the main shaft/head strip in its upper-left 24×5 area.
  const u0 = 0;
  const u1 = 24 / 32;
  const v0 = 27 / 32;
  const v1 = 1;
  const uvs = [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeBoundingSphere();
  return geometry;
}
