import * as THREE from 'three';
import type { SkySample } from './skyPalette';

/** Drawn after the sky dome and before the transparent cloud sheet. */
export const CELESTIAL_RENDER_ORDER = -750;

/**
 * Sun and moon must not write depth. An opaque depth write turns the disc
 * into an occluder, so a cloud fragment behind the sprite fails the depth
 * test. World geometry still wins: it is opaque, closer, and writes depth.
 */
export function createCelestialMaterial(color: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    ...(map ? { map, transparent: true } : {}),
    depthWrite: false,
    depthTest: true,
  });
}

/** 16×16 pixel moon. Transparent corners, a pale disc, a few darker craters. */
export function createMoonTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  const crater = new Set(['5,6', '6,6', '6,7', '10,9', '9,4', '11,11']);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      if (dx * dx + dy * dy > 6.35 * 6.35) continue;
      const dark = crater.has(`${x},${y}`);
      const index = (y * size + x) * 4;
      data[index] = dark ? 168 : 226;
      data[index + 1] = dark ? 186 : 232;
      data[index + 2] = dark ? 204 : 238;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Replaces the smooth moon sphere with one camera-facing pixel quad. */
export function createMoonMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    createCelestialMaterial(0xffffff, createMoonTexture()),
  );
  mesh.renderOrder = CELESTIAL_RENDER_ORDER;
  mesh.frustumCulled = false;
  return mesh;
}

const vertexShader = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
in vec3 vDir;
out vec4 fragColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBand;
uniform vec3 uSunDir;
uniform float uBandStrength;
uniform float uStarOpacity;
uniform float uCloudTime;

float hashCell(vec3 cell) {
  vec3 p = fract(cell * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float starLayer(vec3 dir, float scale, float threshold, float radius) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 local = fract(p) - 0.5;
  float seed = hashCell(cell);
  // edge0 must be below edge1. The inverted form is undefined in GLSL.
  float core = 1.0 - smoothstep(0.0, radius, length(local));
  return step(threshold, seed) * core;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(up, 0.62));
  float verticalBand = exp(-pow((dir.y - 0.035) * 8.6, 2.0));
  vec3 flatDir = vec3(dir.x, 0.0, dir.z);
  vec3 flatSun = vec3(uSunDir.x, 0.0, uSunDir.z);
  float sunFacing = 0.0;
  float dirLen = length(flatDir);
  float sunLen = length(flatSun);
  if (dirLen > 0.0001 && sunLen > 0.0001) {
    sunFacing = clamp(dot(flatDir / dirLen, flatSun / sunLen), 0.0, 1.0);
  }
  float localWarm = mix(0.16, 1.0, sunFacing * sunFacing);
  float band = verticalBand * uBandStrength * localWarm;
  color = mix(color, uBand, clamp(band, 0.0, 0.98));
  vec3 hazeAxis = normalize(vec3(0.2, 0.42, 0.88));
  float hazeAlign = dot(dir, hazeAxis) * 3.0;
  float nightHaze = exp(-(hazeAlign * hazeAlign));
  color += nightHaze * uStarOpacity * vec3(0.015, 0.032, 0.052);
  if (uStarOpacity > 0.001 && dir.y > 0.08) {
    float small = starLayer(dir, 70.0, 0.968, 0.2);
    float bright = starLayer(dir, 32.0, 0.994, 0.26);
    float twinkle = 0.9 + 0.1 * sin(uCloudTime * 0.35 + bright * 12.0);
    color += uStarOpacity * (small * vec3(0.72, 0.78, 0.9) + bright * twinkle * vec3(1.0, 0.97, 0.88));
  }
  fragColor = vec4(color, 1.0);
}
`;

/**
 * One inside-out sphere. Gradient, sunset band and stars are this fragment.
 * Clouds are a separate plane so they stay readable when looking up.
 */
export class SkyDome {
  readonly object: THREE.Mesh;
  private readonly uniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uBand: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uBandStrength: { value: number };
    uStarOpacity: { value: number };
    uCloudTime: { value: number };
  };

  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0.18, 0.41, 0.93) },
      uHorizon: { value: new THREE.Color(0.55, 0.74, 0.95) },
      uBand: { value: new THREE.Color(0.98, 0.42, 0.18) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uBandStrength: { value: 0 },
      uStarOpacity: { value: 0 },
      uCloudTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.object = new THREE.Mesh(new THREE.SphereGeometry(420, 16, 12), material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1000;
    this.object.matrixAutoUpdate = true;
  }

  update(sample: SkySample, cloudTime: number, sunDir: { readonly x: number; readonly y: number; readonly z: number }): void {
    this.uniforms.uZenith.value.setRGB(sample.zenith.r, sample.zenith.g, sample.zenith.b);
    this.uniforms.uHorizon.value.setRGB(sample.horizon.r, sample.horizon.g, sample.horizon.b);
    this.uniforms.uBand.value.setRGB(sample.band.r, sample.band.g, sample.band.b);
    this.uniforms.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z);
    this.uniforms.uBandStrength.value = sample.bandStrength;
    this.uniforms.uStarOpacity.value = sample.starOpacity;
    this.uniforms.uCloudTime.value = cloudTime;
  }

  setPosition(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }
}
