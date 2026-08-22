import * as THREE from 'three';
import { sampleVoxelLightLevels } from '../world/LightEngine';
import type { VoxelWorld } from '../world/World';
import type { TextureAtlas } from './TextureAtlas';

/** Warm fire tint applied only to block-light contribution, not sky/daylight. */
export const TORCH_LIGHT_RGB = [1, 0.68, 0.28] as const;

/** Visual intensity of 0–1 block light. Flood radius stays the LightEngine emission. */
export const BLOCK_LIGHT_VISUAL = 1.35;

const SKY_TERM_MIN = 0.05;
const SKY_TERM_SCALE = 0.83;
const SKY_AMBIENT = 0.04;
/** Lifts mid-range sky so 1–2 level cave openings don't cliff from 15 to 0. */
const SKY_TERM_GAMMA = 0.82;
const ENTITY_WRAP_MIN = 0.76;
const ENTITY_WRAP_SCALE = 0.24;

export const ENTITY_LIGHT_IDENTITY = new THREE.Vector3(1, 1, 1);

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
  const skyTerm = (SKY_TERM_MIN + (sky > 0 ? sky ** SKY_TERM_GAMMA : 0) * SKY_TERM_SCALE) * daylight + SKY_AMBIENT;
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
float skyTerm = (${SKY_TERM_MIN} + pow(max(vSkyLight, 0.0), ${SKY_TERM_GAMMA}) * ${SKY_TERM_SCALE}) * uDaylight + ${SKY_AMBIENT};
vec3 blockRgb = torchWarm * (vBlockLight * ${BLOCK_LIGHT_VISUAL});
vec3 baked = max(vec3(skyTerm), max(blockRgb, vec3(vEmissionLight)));
diffuseColor.rgb *= baked * vFaceShade;`,
      );
  };
  material.customProgramCacheKey = () => 'frontier-world-baked-light-v2';
  return material;
}

export function setWorldDaylight(daylight: number): void {
  worldDaylightUniform.value = THREE.MathUtils.clamp(daylight, 0.08, 1);
}

export interface EntityMaterialOptions {
  readonly map?: THREE.Texture | null;
  readonly color?: THREE.ColorRepresentation;
  readonly alphaTest?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly depthWrite?: boolean;
  readonly side?: THREE.Side;
  readonly fog?: boolean;
  readonly glow?: boolean;
  /** Mob wrap-shade. Generated items set this false so thin side faces stay fullbright. */
  readonly wrap?: boolean;
}

/**
 * World-entity material: voxel light via `uEntityLight`, wrap shade that never
 * goes to black. Scene Lambert/hemisphere lights are not used (same class of
 * bug as chunk MeshLambert). Glow skips wrap/voxel multiply.
 */
export function createEntityMaterial(options: EntityMaterialOptions = {}): THREE.MeshBasicMaterial {
  const glow = options.glow === true;
  const wrap = options.wrap !== false;
  const material = new THREE.MeshBasicMaterial({
    map: options.map ?? null,
    color: options.color ?? 0xffffff,
    fog: options.fog ?? true,
    alphaTest: options.alphaTest ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
    side: options.side ?? THREE.FrontSide,
  });
  if (glow) {
    material.customProgramCacheKey = () => 'frontier-entity-glow-v1';
    return material;
  }
  const wrapExpression = wrap
    ? `${ENTITY_WRAP_MIN} + ${ENTITY_WRAP_SCALE} * clamp(dot(normalize(mat3(modelMatrix) * normal), vec3(0.18, 0.92, 0.28)), 0.0, 1.0)`
    : '1.0';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEntityLight = { value: ENTITY_LIGHT_IDENTITY.clone() };
    material.userData.uEntityLight = shader.uniforms.uEntityLight;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying float vEntityWrap;`,
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vEntityWrap = ${wrapExpression};`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uEntityLight;
varying float vEntityWrap;`,
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb *= uEntityLight * vEntityWrap;`,
    );
  };
  material.customProgramCacheKey = () => (
    wrap ? 'frontier-entity-voxel-light-v1' : 'frontier-entity-voxel-light-v1-nowrap'
  );
  return material;
}

export function setEntityLight(object: THREE.Object3D, rgb: readonly [number, number, number]): void {
  let light = object.userData.entityLight as THREE.Vector3 | undefined;
  if (!(light instanceof THREE.Vector3)) {
    light = new THREE.Vector3(1, 1, 1);
    object.userData.entityLight = light;
  }
  light.set(rgb[0], rgb[1], rgb[2]);
}

function findEntityLight(object: THREE.Object3D): THREE.Vector3 {
  let current: THREE.Object3D | null = object;
  while (current) {
    const light = current.userData.entityLight;
    if (light instanceof THREE.Vector3) return light;
    current = current.parent;
  }
  return ENTITY_LIGHT_IDENTITY;
}

/** Shared-material safe: each mesh copies its root's voxel light just before draw. */
export function bindEntityLightReceiver(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material;
    if (Array.isArray(material) || !material.userData) return;
    child.onBeforeRender = () => {
      const current = child.material;
      if (Array.isArray(current)) return;
      const uniform = current.userData?.uEntityLight as
        | { value: THREE.Vector3 }
        | undefined;
      if (!uniform) return;
      uniform.value.copy(findEntityLight(child));
    };
  });
}

export interface EntityLightSample {
  readonly sky: number;
  readonly block: number;
  readonly rgb: readonly [number, number, number];
}

/**
 * Feet / torso / head samples of voxel sky+block, then the same compose as terrain.
 * Cheap: three integer lookups (plus neighbor fallback only when a cell is unlit).
 */
export function sampleEntityLight(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  height: number,
  daylight = 1,
): EntityLightSample {
  const feet = sampleVoxelLightLevels(world, Math.floor(x), Math.floor(y + 0.08), Math.floor(z));
  const torso = sampleVoxelLightLevels(world, Math.floor(x), Math.floor(y + height * 0.55), Math.floor(z));
  const head = sampleVoxelLightLevels(world, Math.floor(x), Math.floor(y + height * 0.92), Math.floor(z));
  const sky = (feet.sky + torso.sky + head.sky) / (3 * 15);
  const block = (feet.block + torso.block + head.block) / (3 * 15);
  return { sky, block, rgb: composeWorldLight(sky, block, 0, 1, daylight) };
}

export function applySampledEntityLight(
  object: THREE.Object3D,
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  height: number,
  daylight = 1,
): EntityLightSample {
  const sample = sampleEntityLight(world, x, y, z, height, daylight);
  setEntityLight(object, sample.rgb);
  return sample;
}
