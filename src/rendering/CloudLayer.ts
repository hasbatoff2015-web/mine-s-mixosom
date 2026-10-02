import * as THREE from 'three';
import { CLOUD_MASK_SIZE, cloudMaskAlpha } from './cloudMask';

/** World units per mask texel. Smaller than the old 4-block texels. */
export const CLOUD_WORLD_PER_TEXEL = 2;
/** Blocks per second along +X. Slow enough to read as sky drift. */
export const CLOUD_DRIFT_BLOCKS_PER_SECOND = 0.35;
/** Never drop the layer into the 80-block world. */
export const CLOUD_SKY_FLOOR = 118;
/** Stay this far above the camera so flight cannot catch the layer. */
export const CLOUD_ABOVE_CAMERA = 64;

const CLOUD_PLANE = 960;

/**
 * Decorative sky sheet. It recenters on the camera so the finite plane has no edge,
 * but the mask is sampled in world X/Z. There is no collision and no light contribution.
 */
export function cloudAltitude(cameraY: number): number {
  return Math.max(CLOUD_SKY_FLOOR, cameraY + CLOUD_ABOVE_CAMERA);
}

/**
 * UV offset for a PlaneGeometry rotated by -PI/2.
 * That rotation maps local +Y to world -Z, so the V axis must subtract camera Z.
 * Adding camera Z makes the pattern slide with the player only while moving on Z.
 */
export function cloudScrollOffset(
  cameraX: number,
  cameraZ: number,
  timeSeconds: number,
  span: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (cameraX + timeSeconds * CLOUD_DRIFT_BLOCKS_PER_SECOND) / span,
    y: -cameraZ / span,
  };
}

/** World-locked sample. Camera X and camera Z both cancel; time only moves U. */
export function cloudWorldSample(
  worldX: number,
  worldZ: number,
  cameraX: number,
  cameraZ: number,
  timeSeconds: number,
  span: number,
): { readonly u: number; readonly v: number } {
  const offset = cloudScrollOffset(cameraX, cameraZ, timeSeconds, span);
  return {
    u: (worldX - cameraX) / span + offset.x,
    v: (cameraZ - worldZ) / span + offset.y,
  };
}

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
      data[i * 4] = 248;
      data[i * 4 + 1] = 250;
      data[i * 4 + 2] = 253;
      data[i * 4 + 3] = on ? 255 : 0;
    }
    this.texture = new THREE.DataTexture(data, size, size);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    const span = size * CLOUD_WORLD_PER_TEXEL;
    this.texture.repeat.set(CLOUD_PLANE / span, CLOUD_PLANE / span);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.frustumCulled = false;
    this.object.renderOrder = -500;
    this.object.position.y = CLOUD_SKY_FLOOR;
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
   * Horizontal motion is world-locked. Vertical position stays above the camera and the world.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, timeSeconds: number, night: number): void {
    const span = CLOUD_MASK_SIZE * CLOUD_WORLD_PER_TEXEL;
    const offset = cloudScrollOffset(cameraX, cameraZ, timeSeconds, span);
    this.object.position.set(cameraX, cloudAltitude(cameraY), cameraZ);
    this.texture.offset.set(offset.x, offset.y);
    const shade = Math.min(1, Math.max(0, night));
    this.material.color.setRGB(1 - shade * 0.42, 1 - shade * 0.4, 1 - shade * 0.32);
  }
}
