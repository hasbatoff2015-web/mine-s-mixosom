import type * as THREE from 'three';
import {
  createTexturedCuboidGeometry,
  cuboidUvRects,
  type LogicalUvRect,
  type TexturedCuboidDefinition,
} from '../TexturedCuboid';
import type { PlayerModelVariant } from '../../player/appearance/PlayerAppearance';

export const PLAYER_MODEL_PIXEL = 1.8 / 32;
export const PLAYER_OUTER_LAYER_INFLATE = 0.25 * PLAYER_MODEL_PIXEL;
export const PLAYER_HAT_LAYER_INFLATE = 0.5 * PLAYER_MODEL_PIXEL;

export type PlayerSkinPart = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type PlayerSkinLayer = 'base' | 'outer';
export type PlayerSkinPresentation = 'world' | 'firstPerson';

const BASE_OFFSETS: Readonly<Record<PlayerSkinPart, readonly [number, number]>> = Object.freeze({
  head: [0, 0],
  body: [16, 16],
  rightArm: [40, 16],
  leftArm: [32, 48],
  rightLeg: [0, 16],
  leftLeg: [16, 48],
});

const OUTER_OFFSETS: Readonly<Record<PlayerSkinPart, readonly [number, number]>> = Object.freeze({
  head: [32, 0],
  body: [16, 32],
  rightArm: [40, 32],
  leftArm: [48, 48],
  rightLeg: [0, 32],
  leftLeg: [0, 48],
});

export function playerSkinPartSize(part: PlayerSkinPart, variant: PlayerModelVariant): readonly [number, number, number] {
  if (part === 'head') return [8, 8, 8];
  if (part === 'body') return [8, 12, 4];
  if (part === 'rightArm' || part === 'leftArm') return [variant === 'slim' ? 3 : 4, 12, 4];
  return [4, 12, 4];
}

export function playerSkinPartDefinition(
  part: PlayerSkinPart,
  variant: PlayerModelVariant,
  layer: PlayerSkinLayer,
  presentation: PlayerSkinPresentation = 'world',
): TexturedCuboidDefinition {
  const size = playerSkinPartSize(part, variant);
  const pixel = presentation === 'firstPerson' ? 0.04 : PLAYER_MODEL_PIXEL;
  return {
    size,
    textureOffset: layer === 'base' ? BASE_OFFSETS[part] : OUTER_OFFSETS[part],
    logicalTextureSize: [64, 64],
    physicalSize: [size[0] * pixel, size[1] * pixel, size[2] * pixel],
    inflate: layer === 'outer' ? (part === 'head' ? 0.5 : 0.25) * pixel : 0,
  };
}

export function playerSkinUvRects(
  part: PlayerSkinPart,
  variant: PlayerModelVariant,
  layer: PlayerSkinLayer,
): Readonly<Record<'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', LogicalUvRect>> {
  return cuboidUvRects(playerSkinPartDefinition(part, variant, layer));
}

/** Shared immutable geometry cache; individual PlayerVisual instances only own materials and transforms. */
export class PlayerSkinGeometryCache {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();

  get(
    part: PlayerSkinPart,
    variant: PlayerModelVariant,
    layer: PlayerSkinLayer,
    presentation: PlayerSkinPresentation = 'world',
  ): THREE.BufferGeometry {
    const key = `${presentation}:${variant}:${part}:${layer}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = createTexturedCuboidGeometry(playerSkinPartDefinition(part, variant, layer, presentation));
      geometry.name = `player-skin:${key}`;
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  get size(): number {
    return this.geometries.size;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}
