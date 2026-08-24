import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { createEntityMaterial } from './worldLighting';
import { fireBlockPlanes } from './fireGeometry';

/** Fallback when the PNG strip has not loaded yet. */
export const FIRE_FALLBACK_FRAMES = 8;
/** Two game ticks per frame, matching a simple vanilla-like flicker. */
export const FIRE_SECONDS_PER_FRAME = 0.1;

let shared: SharedFireTexture | undefined;
let elapsed = 0;

export class SharedFireTexture {
  readonly texture: THREE.Texture;
  readonly material: THREE.MeshBasicMaterial;
  private frameCount = FIRE_FALLBACK_FRAMES;

  private constructor() {
    this.texture = new THREE.Texture();
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.repeat.set(1, 1 / this.frameCount);
    this.material = createEntityMaterial({
      map: this.texture,
      alphaTest: 0.28,
      side: THREE.DoubleSide,
      glow: true,
      fog: true,
    });
    this.material.depthWrite = true;
    this.load();
  }

  static instance(): SharedFireTexture {
    shared ??= new SharedFireTexture();
    return shared;
  }

  get frames(): number {
    return this.frameCount;
  }

  update(deltaSeconds: number): void {
    elapsed += Math.max(0, deltaSeconds);
    const frame = Math.floor(elapsed / FIRE_SECONDS_PER_FRAME) % this.frameCount;
    this.texture.offset.y = frame / this.frameCount;
  }

  createBlockOverlay(): THREE.Mesh {
    return this.createScaledOverlay(1, 1);
  }

  createScaledOverlay(width: number, height: number): THREE.Mesh {
    const mesh = new THREE.Mesh(createFireOverlayGeometry(width, height), this.material);
    mesh.name = 'fire-overlay';
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    return mesh;
  }

  private load(): void {
    if (typeof document === 'undefined') return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const size = Math.max(1, image.naturalWidth);
      this.frameCount = Math.max(1, Math.round(image.naturalHeight / size));
      this.texture.image = image;
      this.texture.repeat.set(1, 1 / this.frameCount);
      this.texture.needsUpdate = true;
    };
    image.src = TextureAtlas.url('block/fire');
  }
}

export function updateSharedFireAnimation(deltaSeconds: number): void {
  SharedFireTexture.instance().update(deltaSeconds);
}

function createFireOverlayGeometry(width: number, height: number): THREE.BufferGeometry {
  const planes = fireBlockPlanes(-0.5, 0, -0.5);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sx = Math.max(0.45, width);
  const sy = Math.max(0.7, height);
  for (const plane of planes) {
    const base = positions.length / 3;
    for (const corner of plane.corners) {
      positions.push(corner[0] * sx, corner[1] * sy, corner[2] * sx);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
