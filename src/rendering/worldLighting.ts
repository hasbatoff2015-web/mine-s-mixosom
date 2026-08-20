import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas';

/** Warm fire tint applied only to block-light contribution, not sky/daylight. */
export const TORCH_LIGHT_RGB = [1, 0.68, 0.28] as const;

/** Visual intensity of 0–1 block light. Flood radius stays the LightEngine emission. */
export const BLOCK_LIGHT_VISUAL = 1.35;

const SKY_TERM_MIN = 0.05;
const SKY_TERM_SCALE = 0.83;
const SKY_AMBIENT = 0.04;

/** Shared by every world material so day/night updates without remeshing. */
export const worldDaylightUniform: { value: number } = { value: 1 };

export interface WorldLightSample {
  readonly sky: number;
  readonly block: number;
  readonly emission: number;
  readonly shade: number;
}

export function composeWorldLight(
  sky: number,
  block: number,
  emission = 0,
  shade = 1,
  daylight = 1,
): [number, number, number] {
  const skyTerm = (SKY_TERM_MIN + sky * SKY_TERM_SCALE) * daylight + SKY_AMBIENT;
  const blockScale = block * BLOCK_LIGHT_VISUAL;
  const r = Math.min(1.2, Math.max(skyTerm, blockScale * TORCH_LIGHT_RGB[0], emission) * shade);
  const g = Math.min(1.2, Math.max(skyTerm, blockScale * TORCH_LIGHT_RGB[1], emission) * shade);
  const b = Math.min(1.2, Math.max(skyTerm, blockScale * TORCH_LIGHT_RGB[2], emission) * shade);
  return [r, g, b];
}

/** Grayscale helper for tests that only care about luminance. */
export function bakedVertexLight(sky: number, blockLight: number, emission = 0, shade = 1, daylight = 1): number {
  const [r, g, b] = composeWorldLight(sky, blockLight, emission, shade, daylight);
  return (r + g + b) / 3;
}

export interface WorldMaterialOptions {
  readonly alphaTest?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly depthWrite?: boolean;
  readonly depthTest?: boolean;
  readonly side?: THREE.Side;
}

/**
 * Terrain lighting is fully in vertex attributes + this shader.
 * Scene Hemisphere/Directional lights still light mobs/items, not chunks —
 * that double-lighting was turning downward faces pitch-black.
 */
export function createWorldChunkMaterial(
  atlas: TextureAtlas,
  options: WorldMaterialOptions = {},
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    vertexColors: true,
    fog: true,
    alphaTest: options.alphaTest ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
    depthTest: options.depthTest ?? true,
    side: options.side ?? THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = worldDaylightUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float skyLight;
attribute float blockLight;
attribute float faceShade;
attribute float emissionLight;
varying float vSkyLight;
varying float vBlockLight;
varying float vFaceShade;
varying float vEmissionLight;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
vSkyLight = skyLight;
vBlockLight = blockLight;
vFaceShade = faceShade;
vEmissionLight = emissionLight;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDaylight;
varying float vSkyLight;
varying float vBlockLight;
varying float vFaceShade;
varying float vEmissionLight;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 torchWarm = vec3(${TORCH_LIGHT_RGB[0]}, ${TORCH_LIGHT_RGB[1]}, ${TORCH_LIGHT_RGB[2]});
float skyTerm = (${SKY_TERM_MIN} + vSkyLight * ${SKY_TERM_SCALE}) * uDaylight + ${SKY_AMBIENT};
vec3 blockRgb = torchWarm * (vBlockLight * ${BLOCK_LIGHT_VISUAL});
vec3 baked = max(vec3(skyTerm), max(blockRgb, vec3(vEmissionLight)));
diffuseColor.rgb *= baked * vFaceShade;`,
      );
  };
  material.customProgramCacheKey = () => 'frontier-world-baked-light-v1';
  return material;
}

export function setWorldDaylight(daylight: number): void {
  worldDaylightUniform.value = THREE.MathUtils.clamp(daylight, 0.08, 1);
}
