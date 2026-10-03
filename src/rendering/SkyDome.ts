import * as THREE from 'three';
import type { SkySample } from './skyPalette';

/** Drawn after the sky dome and before the transparent cloud sheet. */
export const CELESTIAL_RENDER_ORDER = -750;

/**
 * Sun and moon must not write depth. An opaque depth write turns the disc
 * into an occluder, so a cloud fragment behind the sprite fails the depth
 * test. World geometry still wins: it is opaque, closer, and writes depth.
 */
export function createCelestialMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    depthTest: true,
  });
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
  if (uStarOpacity > 0.001 && dir.y > 0.12) {
    vec3 cell = floor(dir * 58.0);
    float n = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float star = step(0.986, n);
    float twinkle = 0.78 + 0.22 * sin(dot(cell.xy, vec2(1.3, 0.7)) + uCloudTime * 0.35);
    color += star * twinkle * uStarOpacity * vec3(0.86, 0.91, 1.0);
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
      uZenith: { value: new THREE.Color(0.43, 0.67, 0.93) },
      uHorizon: { value: new THREE.Color(0.74, 0.86, 0.96) },
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
