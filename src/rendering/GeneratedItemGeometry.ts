import * as THREE from 'three';

export interface GeneratedItemMask {
  readonly width: number;
  readonly height: number;
  /** One alpha byte per pixel, row-major from the image top-left. */
  readonly alpha: Uint8Array;
}

export interface GeneratedItemGeometryInfo {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly opaquePixels: number;
  readonly frontQuads: 1;
  readonly backQuads: 1;
  readonly sideSpans: number;
  readonly triangleCount: number;
}

export type GeneratedSpanFacing = 'up' | 'down' | 'left' | 'right';

export interface GeneratedItemSpan {
  readonly facing: GeneratedSpanFacing;
  /** Inclusive texel coordinate along the span. */
  readonly min: number;
  /** Inclusive texel coordinate along the span. */
  readonly max: number;
  readonly anchor: number;
}

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const MODEL = 16;
const VANILLA_FRONT_Z0 = 7.5;
const VANILLA_FRONT_Z1 = 8.5;

/**
 * Vanilla `item/generated` thickness: Z 7.5–8.5 in 0–16 model units = 1/16 of
 * a block. Higher-resolution packs must not change this.
 */
export const VANILLA_GENERATED_DEPTH = (VANILLA_FRONT_Z1 - VANILLA_FRONT_Z0) / MODEL;

/** Span detection matches ItemModelGenerator: only exact alpha 0 is transparent. */
export function isGeneratedTransparentAlpha(alpha: number): boolean {
  return alpha === 0;
}

/**
 * Cached vanilla-like item/generated geometry.
 *
 * Front and back are one full-sprite quad each. Silhouette comes from the
 * alpha texture, not from meshed pixels. Side faces exist only on opaque →
 * transparent boundaries and are merged into adjacent spans of the same
 * facing. Texture resolution maps into a fixed 16×16 model so a 32×32 pack
 * adds boundary detail without changing item size or thickness.
 */
export function createGeneratedItemGeometry(
  mask: Readonly<GeneratedItemMask>,
  depth = VANILLA_GENERATED_DEPTH,
): THREE.BufferGeometry {
  if (mask.width < 1 || mask.height < 1 || mask.alpha.length !== mask.width * mask.height) {
    throw new RangeError('Generated item mask dimensions do not match its alpha data.');
  }

  const buffers: Buffers = { positions: [], normals: [], uvs: [], indices: [] };
  const halfDepth = depth / 2;
  const width = 1;
  const height = 1;

  addQuad(
    buffers,
    [
      [-width / 2, -height / 2, halfDepth],
      [width / 2, -height / 2, halfDepth],
      [width / 2, height / 2, halfDepth],
      [-width / 2, height / 2, halfDepth],
    ],
    [0, 0, 1],
    [[0, 0], [1, 0], [1, 1], [0, 1]],
  );
  addQuad(
    buffers,
    [
      [width / 2, -height / 2, -halfDepth],
      [-width / 2, -height / 2, -halfDepth],
      [-width / 2, height / 2, -halfDepth],
      [width / 2, height / 2, -halfDepth],
    ],
    [0, 0, -1],
    [[1, 0], [0, 0], [0, 1], [1, 1]],
  );

  const spans = collectGeneratedItemSpans(mask);
  for (const span of spans) addSideSpan(buffers, mask, span, halfDepth);

  const triangleCount = buffers.indices.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(buffers.indices);
  geometry.userData.generatedItem = Object.freeze({
    width: mask.width,
    height: mask.height,
    opaquePixels: countOpaquePixels(mask),
    frontQuads: 1,
    backQuads: 1,
    sideSpans: spans.length,
    depth,
    triangleCount,
  } satisfies GeneratedItemGeometryInfo);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function generatedItemInfo(geometry: THREE.BufferGeometry): GeneratedItemGeometryInfo {
  return geometry.userData.generatedItem as GeneratedItemGeometryInfo;
}

/**
 * Opaque → transparent boundary spans, merged with neighboring edges of the
 * same facing. Out-of-bounds neighbors are transparent, matching vanilla.
 */
export function collectGeneratedItemSpans(mask: Readonly<GeneratedItemMask>): GeneratedItemSpan[] {
  const spans: GeneratedItemSpan[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (isTransparent(mask, x, y)) continue;
      considerSpan(spans, 'up', x, y, isTransparent(mask, x, y - 1));
      considerSpan(spans, 'down', x, y, isTransparent(mask, x, y + 1));
      considerSpan(spans, 'left', x, y, isTransparent(mask, x - 1, y));
      considerSpan(spans, 'right', x, y, isTransparent(mask, x + 1, y));
    }
  }
  return spans;
}

function considerSpan(
  spans: GeneratedItemSpan[],
  facing: GeneratedSpanFacing,
  x: number,
  y: number,
  neighborTransparent: boolean,
): void {
  if (!neighborTransparent) return;
  const horizontal = facing === 'up' || facing === 'down';
  const anchor = horizontal ? y : x;
  const pos = horizontal ? x : y;
  const adjacent = spans.find((span) => (
    span.facing === facing
    && span.anchor === anchor
    && (pos === span.max + 1 || pos === span.min - 1)
  ));
  if (!adjacent) {
    spans.push({ facing, min: pos, max: pos, anchor });
    return;
  }
  if (pos < adjacent.min) (adjacent as { min: number }).min = pos;
  else (adjacent as { max: number }).max = pos;
}

function addSideSpan(
  buffers: Buffers,
  mask: Readonly<GeneratedItemMask>,
  span: GeneratedItemSpan,
  halfDepth: number,
): void {
  const texW = mask.width;
  const texH = mask.height;
  const min = span.min;
  const maxExclusive = span.max + 1;
  const anchor = span.anchor;

  // ItemModelGenerator 1.9: along-span uses 16/size; collapsed UV uses 16/(size-1).
  const uSpan = (texel: number): number => texel / texW;
  const vSpan = (texel: number): number => 1 - texel / texH;
  const collapsedU = (texel: number): number => texel / Math.max(1, texW - 1);
  const collapsedV = (texel: number): number => 1 - texel / Math.max(1, texH - 1);

  const x0 = localX(min, texW);
  const x1 = localX(maxExclusive, texW);
  const yStart = localY(min, texH);
  const yEnd = localY(maxExclusive, texH);
  const yAnchor = localY(anchor, texH);
  const yAnchorOuter = localY(anchor + 1, texH);
  const xAnchor = localX(anchor, texW);
  const xAnchorOuter = localX(anchor + 1, texW);

  switch (span.facing) {
    case 'up':
      addQuad(
        buffers,
        [
          [x0, yAnchor, -halfDepth],
          [x1, yAnchor, -halfDepth],
          [x1, yAnchor, halfDepth],
          [x0, yAnchor, halfDepth],
        ],
        [0, 1, 0],
        [
          [uSpan(min), collapsedV(anchor)],
          [uSpan(maxExclusive), collapsedV(anchor)],
          [uSpan(maxExclusive), collapsedV(anchor)],
          [uSpan(min), collapsedV(anchor)],
        ],
      );
      return;
    case 'down':
      addQuad(
        buffers,
        [
          [x0, yAnchorOuter, halfDepth],
          [x1, yAnchorOuter, halfDepth],
          [x1, yAnchorOuter, -halfDepth],
          [x0, yAnchorOuter, -halfDepth],
        ],
        [0, -1, 0],
        [
          [uSpan(min), collapsedV(anchor)],
          [uSpan(maxExclusive), collapsedV(anchor)],
          [uSpan(maxExclusive), collapsedV(anchor)],
          [uSpan(min), collapsedV(anchor)],
        ],
      );
      return;
    case 'left':
      addQuad(
        buffers,
        [
          [xAnchor, yEnd, halfDepth],
          [xAnchor, yEnd, -halfDepth],
          [xAnchor, yStart, -halfDepth],
          [xAnchor, yStart, halfDepth],
        ],
        [-1, 0, 0],
        [
          [collapsedU(anchor), vSpan(maxExclusive)],
          [collapsedU(anchor), vSpan(maxExclusive)],
          [collapsedU(anchor), vSpan(min)],
          [collapsedU(anchor), vSpan(min)],
        ],
      );
      return;
    case 'right':
      addQuad(
        buffers,
        [
          [xAnchorOuter, yStart, halfDepth],
          [xAnchorOuter, yStart, -halfDepth],
          [xAnchorOuter, yEnd, -halfDepth],
          [xAnchorOuter, yEnd, halfDepth],
        ],
        [1, 0, 0],
        [
          [collapsedU(anchor), vSpan(min)],
          [collapsedU(anchor), vSpan(min)],
          [collapsedU(anchor), vSpan(maxExclusive)],
          [collapsedU(anchor), vSpan(maxExclusive)],
        ],
      );
  }
}

function localX(texel: number, width: number): number {
  return texel / width - 0.5;
}

function localY(imageY: number, height: number): number {
  return 0.5 - imageY / height;
}

function isTransparent(mask: Readonly<GeneratedItemMask>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return true;
  return isGeneratedTransparentAlpha(mask.alpha[y * mask.width + x]!);
}

function countOpaquePixels(mask: Readonly<GeneratedItemMask>): number {
  let count = 0;
  for (const alpha of mask.alpha) {
    if (!isGeneratedTransparentAlpha(alpha)) count += 1;
  }
  return count;
}

function addQuad(
  buffers: Buffers,
  corners: readonly (readonly [number, number, number])[],
  normal: readonly [number, number, number],
  uvs: readonly (readonly [number, number])[],
): void {
  const base = buffers.positions.length / 3;
  for (let index = 0; index < 4; index += 1) {
    buffers.positions.push(...corners[index]!);
    buffers.normals.push(...normal);
    buffers.uvs.push(...uvs[index]!);
  }
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
