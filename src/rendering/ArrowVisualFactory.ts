import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';

/** Shared crossed-plane projectile model using the legacy arrow entity sheet. */
export class ArrowVisualFactory {
  private readonly geometry = createArrowGeometry();
  private readonly texture: THREE.Texture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly flamingMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url('entity/arrow'));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.material = createEntityMaterial({
      map: this.texture,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
    });
    this.flamingMaterial = this.material.clone();
    this.flamingMaterial.color.set(0xff7a22);
  }

  create(flaming = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, flaming ? this.flamingMaterial : this.material);
    mesh.name = flaming ? 'fire-arrow-projectile' : 'arrow-projectile';
    bindEntityLightReceiver(mesh);
    return mesh;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.flamingMaterial.dispose();
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
