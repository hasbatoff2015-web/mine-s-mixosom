import * as THREE from 'three';

export interface GeneratedItemMask {
  readonly width: number;
  readonly height: number;
  /** One alpha byte per pixel, row-major from the image top-left. */
  readonly alpha: Uint8Array;
}

export interface GeneratedUvRange {
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
}

export interface GeneratedSpanCounts {
  readonly up: number;
  readonly down: number;
  readonly left: number;
  readonly right: number;
  readonly total: number;
}

export interface GeneratedItemGeometryInfo {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly opaquePixels: number;
  readonly frontQuads: 1;
  readonly backQuads: 1;
  readonly sideSpans: number;
  readonly spansByFacing: GeneratedSpanCounts;
  readonly rawEdgesByFacing: GeneratedSpanCounts;
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly uv: {
    readonly front: GeneratedUvRange;
    readonly back: GeneratedUvRange;
    readonly sides: GeneratedUvRange;
  };
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

export interface GeneratedItemBuildOptions {
  readonly depth?: number;
  /** Vertex-color side faces for `qaSideDebug`. Production meshes omit this. */
  readonly debugSides?: boolean;
}

export const GENERATED_SIDE_DEBUG_COLORS: Readonly<Record<'front' | 'back' | GeneratedSpanFacing, readonly [number, number, number]>> = Object.freeze({
  front: [1, 1, 1],
  back: [0.55, 0.55, 0.55],
  up: [1, 0.12, 0.12],
  down: [0.12, 0.85, 0.18],
  left: [0.2, 0.45, 1],
  right: [1, 0.92, 0.12],
});

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors?: number[];
  indices: number[];
}

const MODEL = 16;
const VANILLA_FRONT_Z0 = 7.5;
const VANILLA_FRONT_Z1 = 8.5;
const EMPTY_UV: GeneratedUvRange = Object.freeze({ uMin: 0, uMax: 0, vMin: 0, vMax: 0 });

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
 *
 * Side-face winding is an outer shell (CCW with the outward normal). Collapsed
 * side UVs sample the opaque texel center so nearest-filter does not pick the
 * transparent neighbor.
 */
export function createGeneratedItemGeometry(
  mask: Readonly<GeneratedItemMask>,
  depthOrOptions: number | GeneratedItemBuildOptions = VANILLA_GENERATED_DEPTH,
): THREE.BufferGeometry {
  if (mask.width < 1 || mask.height < 1 || mask.alpha.length !== mask.width * mask.height) {
    throw new RangeError('Generated item mask dimensions do not match its alpha data.');
  }

  const options: GeneratedItemBuildOptions = typeof depthOrOptions === 'number'
    ? { depth: depthOrOptions }
    : depthOrOptions;
  const depth = options.depth ?? VANILLA_GENERATED_DEPTH;
  const debugSides = options.debugSides === true;

  const buffers: Buffers = { positions: [], normals: [], uvs: [], indices: [] };
  if (debugSides) buffers.colors = [];
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
    GENERATED_SIDE_DEBUG_COLORS.front,
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
    GENERATED_SIDE_DEBUG_COLORS.back,
  );

  const spans = collectGeneratedItemSpans(mask);
  for (const span of spans) addSideSpan(buffers, mask, span, halfDepth);

  const triangleCount = buffers.indices.length / 3;
  const vertexCount = buffers.positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  if (buffers.colors) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  }
  geometry.setIndex(buffers.indices);
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 6, 1);
  if (buffers.indices.length > 12) geometry.addGroup(12, buffers.indices.length - 12, 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const box = geometry.boundingBox!;
  geometry.userData.generatedMask = mask;
  geometry.userData.generatedItem = Object.freeze({
    width: mask.width,
    height: mask.height,
    opaquePixels: countOpaquePixels(mask),
    frontQuads: 1,
    backQuads: 1,
    sideSpans: spans.length,
    spansByFacing: spanCounts(spans),
    rawEdgesByFacing: countGeneratedBoundaryEdges(mask),
    depth,
    triangleCount,
    vertexCount,
    bounds: {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    uv: uvRanges(buffers.uvs),
  } satisfies GeneratedItemGeometryInfo);
  return geometry;
}

export function generatedItemInfo(geometry: THREE.BufferGeometry): GeneratedItemGeometryInfo {
  return geometry.userData.generatedItem as GeneratedItemGeometryInfo;
}

export function generatedItemMask(geometry: THREE.BufferGeometry): GeneratedItemMask | undefined {
  return geometry.userData.generatedMask as GeneratedItemMask | undefined;
}

export function formatGeneratedItemDiagnostics(info: GeneratedItemGeometryInfo, itemId?: string): string {
  const { spansByFacing: s, rawEdgesByFacing: e, bounds, uv } = info;
  const fmtUv = (range: GeneratedUvRange): string => (
    `u ${range.uMin.toFixed(3)}..${range.uMax.toFixed(3)}  v ${range.vMin.toFixed(3)}..${range.vMax.toFixed(3)}`
  );
  return [
    itemId ? `item ${itemId}` : 'generated item',
    `texture ${info.width}×${info.height}`,
    `opaque ${info.opaquePixels}/${info.width * info.height}`,
    `depth ${info.depth.toFixed(4)}  (vanilla 7.5–8.5 / 16)`,
    `front ${info.frontQuads}  back ${info.backQuads}`,
    `side spans  U ${s.up}  D ${s.down}  L ${s.left}  R ${s.right}  Σ ${s.total}`,
    `raw edges   U ${e.up}  D ${e.down}  L ${e.left}  R ${e.right}  Σ ${e.total}`,
    `verts ${info.vertexCount}  tris ${info.triangleCount}`,
    `bounds x ${bounds.min[0].toFixed(3)}..${bounds.max[0].toFixed(3)}  y ${bounds.min[1].toFixed(3)}..${bounds.max[1].toFixed(3)}  z ${bounds.min[2].toFixed(3)}..${bounds.max[2].toFixed(3)}`,
    `uv front ${fmtUv(uv.front)}`,
    `uv back  ${fmtUv(uv.back)}`,
    `uv sides ${fmtUv(uv.sides)}`,
  ].join('\n');
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

export function countGeneratedBoundaryEdges(mask: Readonly<GeneratedItemMask>): GeneratedSpanCounts {
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (isTransparent(mask, x, y)) continue;
      if (isTransparent(mask, x, y - 1)) up += 1;
      if (isTransparent(mask, x, y + 1)) down += 1;
      if (isTransparent(mask, x - 1, y)) left += 1;
      if (isTransparent(mask, x + 1, y)) right += 1;
    }
  }
  return freezeCounts(up, down, left, right);
}

export function spanCounts(spans: readonly GeneratedItemSpan[]): GeneratedSpanCounts {
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  for (const span of spans) {
    if (span.facing === 'up') up += 1;
    else if (span.facing === 'down') down += 1;
    else if (span.facing === 'left') left += 1;
    else right += 1;
  }
  return freezeCounts(up, down, left, right);
}

function freezeCounts(up: number, down: number, left: number, right: number): GeneratedSpanCounts {
  return Object.freeze({ up, down, left, right, total: up + down + left + right });
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

  // Along-span covers full texels (16/size). Collapsed axis samples the opaque
  // texel center so nearest-filter cannot round into the transparent neighbor.
  const uSpan = (texel: number): number => texel / texW;
  const vSpan = (texel: number): number => 1 - texel / texH;
  const uCenter = (texel: number): number => (texel + 0.5) / texW;
  const vCenter = (texel: number): number => 1 - (texel + 0.5) / texH;

  const x0 = localX(min, texW);
  const x1 = localX(maxExclusive, texW);
  const yBottom = localY(maxExclusive, texH);
  const yTop = localY(min, texH);
  const yInner = localY(anchor, texH);
  const yOuter = localY(anchor + 1, texH);
  const xInner = localX(anchor, texW);
  const xOuter = localX(anchor + 1, texW);
  const zBack = -halfDepth;
  const zFront = halfDepth;
  const color = GENERATED_SIDE_DEBUG_COLORS[span.facing];

  switch (span.facing) {
    case 'up':
      addQuad(
        buffers,
        [
          [x0, yInner, zBack],
          [x0, yInner, zFront],
          [x1, yInner, zFront],
          [x1, yInner, zBack],
        ],
        [0, 1, 0],
        [
          [uSpan(min), vCenter(anchor)],
          [uSpan(min), vCenter(anchor)],
          [uSpan(maxExclusive), vCenter(anchor)],
          [uSpan(maxExclusive), vCenter(anchor)],
        ],
        color,
      );
      return;
    case 'down':
      addQuad(
        buffers,
        [
          [x0, yOuter, zBack],
          [x1, yOuter, zBack],
          [x1, yOuter, zFront],
          [x0, yOuter, zFront],
        ],
        [0, -1, 0],
        [
          [uSpan(min), vCenter(anchor)],
          [uSpan(maxExclusive), vCenter(anchor)],
          [uSpan(maxExclusive), vCenter(anchor)],
          [uSpan(min), vCenter(anchor)],
        ],
        color,
      );
      return;
    case 'left':
      addQuad(
        buffers,
        [
          [xInner, yBottom, zBack],
          [xInner, yBottom, zFront],
          [xInner, yTop, zFront],
          [xInner, yTop, zBack],
        ],
        [-1, 0, 0],
        [
          [uCenter(anchor), vSpan(maxExclusive)],
          [uCenter(anchor), vSpan(maxExclusive)],
          [uCenter(anchor), vSpan(min)],
          [uCenter(anchor), vSpan(min)],
        ],
        color,
      );
      return;
    case 'right':
      addQuad(
        buffers,
        [
          [xOuter, yBottom, zFront],
          [xOuter, yBottom, zBack],
          [xOuter, yTop, zBack],
          [xOuter, yTop, zFront],
        ],
        [1, 0, 0],
        [
          [uCenter(anchor), vSpan(maxExclusive)],
          [uCenter(anchor), vSpan(maxExclusive)],
          [uCenter(anchor), vSpan(min)],
          [uCenter(anchor), vSpan(min)],
        ],
        color,
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

function uvRanges(uvs: readonly number[]): GeneratedItemGeometryInfo['uv'] {
  return Object.freeze({
    front: rangeOf(uvs, 0, 8),
    back: rangeOf(uvs, 8, 8),
    sides: uvs.length > 16 ? rangeOf(uvs, 16, uvs.length - 16) : EMPTY_UV,
  });
}

function rangeOf(uvs: readonly number[], start: number, count: number): GeneratedUvRange {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let index = start; index < start + count; index += 2) {
    const u = uvs[index]!;
    const v = uvs[index + 1]!;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  if (!Number.isFinite(uMin)) return EMPTY_UV;
  return Object.freeze({ uMin, uMax, vMin, vMax });
}

function addQuad(
  buffers: Buffers,
  corners: readonly (readonly [number, number, number])[],
  normal: readonly [number, number, number],
  uvs: readonly (readonly [number, number])[],
  color: readonly [number, number, number],
): void {
  const base = buffers.positions.length / 3;
  for (let index = 0; index < 4; index += 1) {
    buffers.positions.push(...corners[index]!);
    buffers.normals.push(...normal);
    buffers.uvs.push(...uvs[index]!);
    buffers.colors?.push(...color);
  }
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
