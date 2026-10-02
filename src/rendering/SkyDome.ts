import * as THREE from 'three';
import type { SkySample } from './skyPalette';

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
uniform float uBandStrength;
uniform float uStarOpacity;
uniform float uClouds;
uniform float uCloudTime;

void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 color = mix(uHorizon, uZenith, pow(up, 0.48));
  float band = exp(-pow((dir.y - 0.02) * 3.4, 2.0)) * uBandStrength;
  color = mix(color, uBand, clamp(band, 0.0, 0.82));
  if (uStarOpacity > 0.001 && dir.y > 0.12) {
    vec3 cell = floor(dir * 58.0);
    float n = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float star = step(0.986, n);
    float twinkle = 0.78 + 0.22 * sin(dot(cell.xy, vec2(1.3, 0.7)) + uCloudTime * 0.35);
    color += star * twinkle * uStarOpacity * vec3(0.86, 0.91, 1.0);
  }
  if (uClouds > 0.5 && dir.y > 0.04) {
    vec2 uv = dir.xz / max(dir.y, 0.05);
    uv = uv * 0.11 + vec2(uCloudTime * 0.01, uCloudTime * 0.0015);
    vec2 cell2 = floor(uv * 16.0);
    float n2 = fract(sin(dot(cell2, vec2(127.1, 311.7))) * 43758.5453);
    float puff = step(0.58, n2);
    float heightFade = smoothstep(0.04, 0.14, dir.y) * (1.0 - smoothstep(0.32, 0.58, dir.y));
    float dayFade = 1.0 - uStarOpacity;
    color = mix(color, vec3(0.96, 0.97, 0.99), puff * heightFade * dayFade * 0.7);
  }
  fragColor = vec4(color, 1.0);
}
`;

/**
 * One inside-out sphere. Gradient, sunset band, stars and blocky clouds are
 * the same fragment shader: one draw call, no lighting, no shadows.
 */
export class SkyDome {
  readonly object: THREE.Mesh;
  private cloudsEnabled = true;
  private readonly uniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uBand: { value: THREE.Color };
    uBandStrength: { value: number };
    uStarOpacity: { value: number };
    uClouds: { value: number };
    uCloudTime: { value: number };
  };

  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0.43, 0.67, 0.93) },
      uHorizon: { value: new THREE.Color(0.74, 0.86, 0.96) },
      uBand: { value: new THREE.Color(0.98, 0.42, 0.18) },
      uBandStrength: { value: 0 },
      uStarOpacity: { value: 0 },
      uClouds: { value: 1 },
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

  setClouds(enabled: boolean): void {
    this.cloudsEnabled = enabled;
    this.uniforms.uClouds.value = enabled ? 1 : 0;
  }

  get clouds(): boolean {
    return this.cloudsEnabled;
  }

  update(sample: SkySample, cloudTime: number): void {
    this.uniforms.uZenith.value.setRGB(sample.zenith.r, sample.zenith.g, sample.zenith.b);
    this.uniforms.uHorizon.value.setRGB(sample.horizon.r, sample.horizon.g, sample.horizon.b);
    this.uniforms.uBand.value.setRGB(sample.band.r, sample.band.g, sample.band.b);
    this.uniforms.uBandStrength.value = sample.bandStrength;
    this.uniforms.uStarOpacity.value = sample.starOpacity;
    this.uniforms.uClouds.value = this.cloudsEnabled ? 1 : 0;
    this.uniforms.uCloudTime.value = cloudTime;
  }

  setPosition(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }
}
