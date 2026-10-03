import * as THREE from 'three';
import { CLOUD_MASK_SIZE, cloudMaskAlpha } from './cloudMask';

/** World units per mask texel. */
export const CLOUD_WORLD_PER_TEXEL = 2;
/** Blocks per second along +X. About 10 blocks a minute. */
export const CLOUD_DRIFT_BLOCKS_PER_SECOND = 0.16;
/**
 * Camera-relative sky decoration. The sheet rises with the camera, so flight
 * cannot catch it. It is not a world-space ceiling.
 */
export const CLOUD_ABOVE_CAMERA = 128;
/**
 * One plane, recentered on the camera. Half of 6144 at height 128 sits about
 * 2.4° above the horizon, so the sheet does not stop in the middle of the sky.
 */
export const CLOUD_PLANE_SIZE = 6144;

const CLOUD_DAY = { r: 0.94, g: 0.93, b: 0.9 };
const CLOUD_NIGHT = { r: 0.18, g: 0.22, b: 0.3 };

const cloudVertexShader = /* glsl */ `
out vec2 vUv;
out vec2 vLocal;
void main() {
  vUv = uv;
  vLocal = position.xy / (${CLOUD_PLANE_SIZE / 2}.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cloudFragmentShader = /* glsl */ `
in vec2 vUv;
in vec2 vLocal;
out vec4 fragColor;
uniform sampler2D uMap;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform vec3 uColor;

void main() {
  float mask = texture(uMap, vUv * uRepeat + uOffset).a;
  float edge = max(abs(vLocal.x), abs(vLocal.y));
  float fade = 1.0 - smoothstep(0.86, 0.98, edge);
  float alpha = mask * fade;
  if (alpha < 0.02) discard;
  fragColor = vec4(uColor, alpha);
}
`;

/**
 * Decorative sky sheet. It recenters on the camera so the finite plane stays
 * around the player, but the mask is sampled in world X/Z. There is no
 * collision and no light contribution.
 */
export function cloudAltitude(cameraY: number): number {
  return cameraY + CLOUD_ABOVE_CAMERA;
}

/** Degrees above the horizon of the plane's far edge, as seen from the camera. */
export function cloudEdgeElevationDeg(
  height = CLOUD_ABOVE_CAMERA,
  planeSize = CLOUD_PLANE_SIZE,
): number {
  return Math.atan2(height, planeSize / 2) * (180 / Math.PI);
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

/** Day is a warm light grey. Night is a dark blue-grey. The sheet does not vanish. */
export function cloudTint(night: number): { readonly r: number; readonly g: number; readonly b: number } {
  const shade = Math.min(1, Math.max(0, night));
  return {
    r: CLOUD_DAY.r + (CLOUD_NIGHT.r - CLOUD_DAY.r) * shade,
    g: CLOUD_DAY.g + (CLOUD_NIGHT.g - CLOUD_DAY.g) * shade,
    b: CLOUD_DAY.b + (CLOUD_NIGHT.b - CLOUD_DAY.b) * shade,
  };
}

export class CloudLayer {
  readonly object: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: {
    uMap: { value: THREE.DataTexture };
    uRepeat: { value: THREE.Vector2 };
    uOffset: { value: THREE.Vector2 };
    uColor: { value: THREE.Color };
  };
  private enabled = true;

  constructor() {
    const size = CLOUD_MASK_SIZE;
    const alpha = cloudMaskAlpha(size);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < alpha.length; i += 1) {
      const on = (alpha[i] ?? 0) > 0;
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = on ? 255 : 0;
    }
    this.texture = new THREE.DataTexture(data, size, size);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    const span = size * CLOUD_WORLD_PER_TEXEL;
    const repeat = CLOUD_PLANE_SIZE / span;
    this.uniforms = {
      uMap: { value: this.texture },
      uRepeat: { value: new THREE.Vector2(repeat, repeat) },
      uOffset: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(CLOUD_DAY.r, CLOUD_DAY.g, CLOUD_DAY.b) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE), this.material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.frustumCulled = false;
    this.object.renderOrder = -500;
    this.object.position.y = CLOUD_ABOVE_CAMERA;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.object.visible = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * `night` is the visual night amount, 0 at noon. Clouds darken but stay drawn.
   * Horizontal motion is world-locked. Vertical position is cameraY + CLOUD_ABOVE_CAMERA.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, timeSeconds: number, night: number): void {
    const span = CLOUD_MASK_SIZE * CLOUD_WORLD_PER_TEXEL;
    const offset = cloudScrollOffset(cameraX, cameraZ, timeSeconds, span);
    this.object.position.set(cameraX, cloudAltitude(cameraY), cameraZ);
    this.uniforms.uOffset.value.set(offset.x, offset.y);
    const tint = cloudTint(night);
    this.uniforms.uColor.value.setRGB(tint.r, tint.g, tint.b);
  }
}
