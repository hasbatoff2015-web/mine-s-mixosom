import * as THREE from 'three';
import { CLOUD_MASK_SIZE, cloudMaskAlpha } from './cloudMask';

/** Above the compact 80-block world, low enough to read when looking slightly up. */
export const CLOUD_ALTITUDE = 84;
const CLOUD_PLANE = 720;
const WORLD_PER_TEXEL = 4;

/**
 * One horizontal plane. The block mask is a texture built once.
 * Motion is a UV offset, and X/Z recenters on the camera without sliding the pattern.
 * No shadows, no collision, no per-frame geometry.
 */
export class CloudLayer {
  readonly object: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private enabled = true;

  constructor() {
    const size = CLOUD_MASK_SIZE;
    const alpha = cloudMaskAlpha(size);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < alpha.length; i += 1) {
      const on = (alpha[i] ?? 0) > 0;
      data[i * 4] = 246;
      data[i * 4 + 1] = 248;
      data[i * 4 + 2] = 252;
      data[i * 4 + 3] = on ? 255 : 0;
    }
    this.texture = new THREE.DataTexture(data, size, size);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    const span = size * WORLD_PER_TEXEL;
    this.texture.repeat.set(CLOUD_PLANE / span, CLOUD_PLANE / span);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.frustumCulled = false;
    this.object.renderOrder = -500;
    this.object.position.y = CLOUD_ALTITUDE;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.object.visible = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * `night` is the sky star opacity, 0 at noon. Clouds darken but stay drawn.
   * `timeSeconds` only scrolls the mask.
   */
  update(cameraX: number, cameraZ: number, timeSeconds: number, night: number): void {
    this.object.position.set(cameraX, CLOUD_ALTITUDE, cameraZ);
    const span = CLOUD_MASK_SIZE * WORLD_PER_TEXEL;
    this.texture.offset.set((cameraX + timeSeconds * 1.6) / span, cameraZ / span);
    const shade = Math.min(1, Math.max(0, night));
    this.material.color.setRGB(1 - shade * 0.42, 1 - shade * 0.4, 1 - shade * 0.32);
  }
}
