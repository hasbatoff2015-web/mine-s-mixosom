import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { createEntityMaterial } from './worldLighting';
import { fireBlockPlanes } from './fireGeometry';

/** Fallback when the PNG strip has not loaded yet. */
export const FIRE_FALLBACK_FRAMES = 8;
/** Two game ticks per frame, matching a simple vanilla-like flicker. */
export const FIRE_SECONDS_PER_FRAME = 0.1;
/** First-person overlay opacity. World fire material stays opaque-cutout. */
export const FP_FIRE_OVERLAY_OPACITY = 0.76;

export interface FirstPersonFireQuad {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly rotX: number;
  readonly rotY: number;
}

/**
 * Two lower-corner billboards. Tops stay below camera center so the crosshair
 * and upper view stay readable. Values are camera-local metres.
 */
export function firstPersonFireOverlayLayout(): {
  readonly quads: readonly FirstPersonFireQuad[];
  readonly minY: number;
  readonly maxY: number;
} {
  const quads: readonly FirstPersonFireQuad[] = [
    { x: -0.36, y: -0.27, z: -0.38, width: 0.52, height: 0.24, rotX: -0.16, rotY: 0.46 },
    { x: 0.36, y: -0.27, z: -0.38, width: 0.52, height: 0.24, rotX: -0.16, rotY: -0.46 },
  ];
  const minY = Math.min(...quads.map((quad) => quad.y - quad.height * 0.5));
  const maxY = Math.max(...quads.map((quad) => quad.y + quad.height * 0.5));
  return { quads, minY, maxY };
}

let shared: SharedFireTexture | undefined;
let elapsed = 0;

export class SharedFireTexture {
  readonly texture: THREE.Texture;
  readonly material: THREE.MeshBasicMaterial;
  private overlayMaterial?: THREE.MeshBasicMaterial;
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

  /** Camera-space lower flames. Shares the animated strip; does not remesh. */
  createFirstPersonOverlay(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'first-person:fire-overlay';
    const material = this.firstPersonMaterial();
    for (const quad of firstPersonFireOverlayLayout().quads) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(quad.width, quad.height), material);
      mesh.position.set(quad.x, quad.y, quad.z);
      mesh.rotation.set(quad.rotX, quad.rotY, 0);
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      group.add(mesh);
    }
    return group;
  }

  private firstPersonMaterial(): THREE.MeshBasicMaterial {
    if (!this.overlayMaterial) {
      this.overlayMaterial = this.material.clone();
      this.overlayMaterial.map = this.texture;
      this.overlayMaterial.transparent = true;
      this.overlayMaterial.opacity = FP_FIRE_OVERLAY_OPACITY;
      this.overlayMaterial.depthTest = false;
      this.overlayMaterial.depthWrite = false;
      this.overlayMaterial.fog = false;
      this.overlayMaterial.alphaTest = 0.08;
    }
    return this.overlayMaterial;
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
