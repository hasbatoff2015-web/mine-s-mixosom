import * as THREE from 'three';
import type { GeneratedItemMask } from './GeneratedItemGeometry';
import { VANILLA_GENERATED_DEPTH, isGeneratedTransparentAlpha } from './GeneratedItemGeometry';
import type { RenderVector } from '../items';

export interface ProjectedLocalPoint {
  readonly local: RenderVector;
  readonly camera: RenderVector;
  readonly ndc: RenderVector;
  readonly screen01: readonly [number, number];
}

export function projectLocalPoint(
  local: RenderVector,
  modelView: THREE.Matrix4,
  camera: THREE.Camera,
): ProjectedLocalPoint {
  const world = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(modelView);
  const ndc = world.clone().project(camera);
  return {
    local,
    camera: [world.x, world.y, world.z],
    ndc: [ndc.x, ndc.y, ndc.z],
    screen01: [(ndc.x + 1) / 2, (1 - ndc.y) / 2],
  };
}

export const REFERENCE_F2_IRON_PICKAXE = Object.freeze({
  minecraftVersion: '1.21.8',
  capture: 'F2 framebuffer, no window chrome',
  framebufferWidth: 2048,
  framebufferHeight: 1152,
  aspect: 2048 / 1152,
  playerFovSetting: 70,
  /** Hand pass is independent of the settings FOV; user verified 70 vs 97. */
  handFovDegrees: 70,
  itemId: 'iron_pickaxe',
  pose: 'idle',
  swing: 0,
  movement: 0,
  /** Visual read of the attached F2 shot; not a sub-pixel measurement. */
  pixelUncertainty: 12,
});

export type IronPickaxeLandmarkName =
  | 'leftHeadTip'
  | 'topWoodCap'
  | 'headHandleJunction'
  | 'handleBottom'
  | 'rightMetal';

/** Pixel XY in the 2048×1152 F2 screenshot, origin top-left.
 * handleBottom y=1152 and rightMetal x=2048 sit on the framebuffer edge
 * (clip reads, not necessarily the true projected 3D landmark). */
export const REFERENCE_F2_IRON_PICKAXE_PIXELS: Readonly<Record<IronPickaxeLandmarkName, readonly [number, number]>> = Object.freeze({
  leftHeadTip: [1618, 688],
  topWoodCap: [1965, 608],
  headHandleJunction: [1890, 690],
  handleBottom: [1740, 1152],
  rightMetal: [2048, 765],
});

export interface SilhouetteLandmark {
  readonly name: IronPickaxeLandmarkName;
  readonly texel: readonly [number, number];
  readonly local: RenderVector;
}

export interface ProjectedLandmark extends ProjectedLocalPoint {
  readonly name: IronPickaxeLandmarkName;
  readonly texel: readonly [number, number];
}

function texelToGeneratedLocal(texelX: number, texelY: number, width: number, height: number): RenderVector {
  const u = (texelX + 0.5) / width;
  const v = (texelY + 0.5) / height;
  return [u - 0.5, 0.5 - v, VANILLA_GENERATED_DEPTH / 2];
}

function opaqueTexels(mask: Readonly<GeneratedItemMask>): Array<readonly [number, number]> {
  const pixels: Array<readonly [number, number]> = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!isGeneratedTransparentAlpha(mask.alpha[y * mask.width + x]!)) pixels.push([x, y]);
    }
  }
  return pixels;
}

/**
 * Named 32×32 iron_pickaxe texels (PNG origin top-left) matching the F2
 * screenshot features. Extractor falls back to bbox heuristics for other masks.
 */
export const IRON_PICKAXE_LANDMARK_TEXELS: Readonly<Record<IronPickaxeLandmarkName, readonly [number, number]>> = Object.freeze({
  leftHeadTip: [10, 6],
  topWoodCap: [27, 6],
  headHandleJunction: [20, 13],
  handleBottom: [5, 29],
  rightMetal: [28, 22],
});

export const HELD_ITEM_FOV_SWEEP_DEGREES = Object.freeze([60, 70, 75, 80]);

function pick(
  pixels: ReadonlyArray<readonly [number, number]>,
  score: (x: number, y: number) => number,
): readonly [number, number] {
  if (pixels.length === 0) throw new RangeError('Silhouette has no opaque pixels.');
  let best = pixels[0]!;
  let bestScore = score(best[0], best[1]);
  for (let i = 1; i < pixels.length; i += 1) {
    const pixel = pixels[i]!;
    const next = score(pixel[0], pixel[1]);
    if (next < bestScore) {
      best = pixel;
      bestScore = next;
    }
  }
  return best;
}

function texelOpaque(mask: Readonly<GeneratedItemMask>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return !isGeneratedTransparentAlpha(mask.alpha[y * mask.width + x]!);
}

/**
 * Named iron_pickaxe silhouette points from the opaque alpha mask.
 * Texture row 0 is the PNG top (= generated +Y). Front Z is +depth/2.
 */
export function extractIronPickaxeLandmarks(mask: Readonly<GeneratedItemMask>): SilhouetteLandmark[] {
  const pixels = opaqueTexels(mask);
  const explicit = mask.width === 32 && mask.height === 32
    && (Object.values(IRON_PICKAXE_LANDMARK_TEXELS) as Array<readonly [number, number]>)
      .every(([x, y]) => texelOpaque(mask, x, y));
  let named: Record<IronPickaxeLandmarkName, readonly [number, number]>;
  if (explicit) {
    named = { ...IRON_PICKAXE_LANDMARK_TEXELS };
  } else {
    let minX = mask.width;
    let minY = mask.height;
    let maxX = 0;
    let maxY = 0;
    for (const [x, y] of pixels) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const upper = pixels.filter(([, y]) => y <= minY + bboxH * 0.45);
    const right = pixels.filter(([x]) => x >= minX + bboxW * 0.62);
    const lowerRight = pixels.filter(([x, y]) => x >= minX + bboxW * 0.62 && y >= minY + bboxH * 0.45);
    const handle = pixels.filter(([x, y]) => x <= minX + bboxW * 0.55 && y >= minY + bboxH * 0.28);
    named = {
      leftHeadTip: pick(upper.length > 0 ? upper : pixels, (x, y) => x * 1000 + y),
      topWoodCap: pick(right.length > 0 ? right : pixels, (x, y) => y * 1000 - x),
      headHandleJunction: pick(handle.length > 0 ? handle : pixels, (x, y) => y * 4 + Math.abs(x - (minX + bboxW * 0.42))),
      handleBottom: pick(pixels, (x, y) => -y * 1000 + x),
      rightMetal: pick(lowerRight.length > 0 ? lowerRight : pixels, (x, y) => -x * 1000 - y),
    };
  }

  return (Object.keys(named) as IronPickaxeLandmarkName[]).map((name) => {
    const texel = named[name];
    return {
      name,
      texel,
      local: texelToGeneratedLocal(texel[0], texel[1], mask.width, mask.height),
    };
  });
}

export function projectSilhouetteLandmarks(
  landmarks: readonly SilhouetteLandmark[],
  modelView: THREE.Matrix4,
  camera: THREE.Camera,
): ProjectedLandmark[] {
  return landmarks.map((landmark) => ({
    name: landmark.name,
    texel: landmark.texel,
    ...projectLocalPoint(landmark.local, modelView, camera),
  }));
}

export function screenshotScreen01(
  pixelX: number,
  pixelY: number,
  width = REFERENCE_F2_IRON_PICKAXE.framebufferWidth,
  height = REFERENCE_F2_IRON_PICKAXE.framebufferHeight,
): readonly [number, number] {
  return [pixelX / width, pixelY / height];
}

export interface LandmarkComparisonRow {
  readonly name: IronPickaxeLandmarkName;
  readonly texel: readonly [number, number];
  readonly screenshotPx: readonly [number, number];
  readonly screenshot01: readonly [number, number];
  readonly production01: readonly [number, number];
  readonly vanilla01: readonly [number, number];
  readonly productionDelta: readonly [number, number];
  readonly vanillaDelta: readonly [number, number];
}

export function compareLandmarksToScreenshot(
  production: readonly ProjectedLandmark[],
  vanilla: readonly ProjectedLandmark[],
): LandmarkComparisonRow[] {
  return (Object.keys(REFERENCE_F2_IRON_PICKAXE_PIXELS) as IronPickaxeLandmarkName[]).map((name) => {
    const screenshotPx = REFERENCE_F2_IRON_PICKAXE_PIXELS[name];
    const screenshot01 = screenshotScreen01(screenshotPx[0], screenshotPx[1]);
    const prod = production.find((point) => point.name === name);
    const van = vanilla.find((point) => point.name === name);
    const production01 = prod?.screen01 ?? [Number.NaN, Number.NaN];
    const vanilla01 = van?.screen01 ?? [Number.NaN, Number.NaN];
    return {
      name,
      texel: prod?.texel ?? van?.texel ?? [0, 0],
      screenshotPx,
      screenshot01,
      production01,
      vanilla01,
      productionDelta: [production01[0] - screenshot01[0], production01[1] - screenshot01[1]],
      vanillaDelta: [vanilla01[0] - screenshot01[0], vanilla01[1] - screenshot01[1]],
    };
  });
}

export function createPerspectiveCamera(fovDegrees: number, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fovDegrees, aspect, 0.01, 12);
  camera.updateProjectionMatrix();
  return camera;
}

export function projectLandmarksAtFovs(
  landmarks: readonly SilhouetteLandmark[],
  modelView: THREE.Matrix4,
  fovs: readonly number[] = HELD_ITEM_FOV_SWEEP_DEGREES,
  aspect = REFERENCE_F2_IRON_PICKAXE.aspect,
): Readonly<Record<number, ProjectedLandmark[]>> {
  const result: Record<number, ProjectedLandmark[]> = {};
  for (const fov of fovs) {
    result[fov] = projectSilhouetteLandmarks(landmarks, modelView, createPerspectiveCamera(fov, aspect));
  }
  return result;
}
