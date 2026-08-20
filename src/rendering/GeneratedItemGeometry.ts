import * as THREE from 'three';

export interface GeneratedItemMask {
  readonly width: number;
  readonly height: number;
  /** One alpha byte per pixel, row-major from the image top-left. */
  readonly alpha: Uint8Array;
}

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const OPAQUE_THRESHOLD = 8;
/** Extrusion depth in item-local units; thick enough to read in first person without becoming a cube. */
export const GENERATED_ITEM_DEPTH = 0.10;

/** Cached legacy item/generated-style silhouette: opaque front/back spans plus merged edge extrusion. */
export function createGeneratedItemGeometry(
  mask: Readonly<GeneratedItemMask>,
  depth = GENERATED_ITEM_DEPTH,
): THREE.BufferGeometry {
  if (mask.width < 1 || mask.height < 1 || mask.alpha.length !== mask.width * mask.height) {
    throw new RangeError('Generated item mask dimensions do not match its alpha data.');
  }
  const buffers: Buffers = { positions: [], normals: [], uvs: [], indices: [] };
  const scale = Math.max(mask.width, mask.height);
  const width = mask.width / scale;
  const height = mask.height / scale;
  const halfDepth = depth / 2;
  const opaque = (x: number, y: number): boolean => x >= 0 && x < mask.width
    && y >= 0 && y < mask.height
    && mask.alpha[y * mask.width + x]! > OPAQUE_THRESHOLD;

  const xAt = (pixel: number): number => -width / 2 + pixel / scale;
  const yAt = (pixel: number): number => height / 2 - pixel / scale;

  let frontSpans = 0;
  for (let y = 0; y < mask.height; y += 1) {
    let x = 0;
    while (x < mask.width) {
      while (x < mask.width && !opaque(x, y)) x += 1;
      if (x >= mask.width) break;
      const start = x;
      while (x < mask.width && opaque(x, y)) x += 1;
      const end = x;
      const x0 = xAt(start);
      const x1 = xAt(end);
      const y0 = yAt(y + 1);
      const y1 = yAt(y);
      const u0 = start / mask.width;
      const u1 = end / mask.width;
      const v0 = 1 - (y + 1) / mask.height;
      const v1 = 1 - y / mask.height;
      addQuad(buffers,
        [[x0, y0, halfDepth], [x1, y0, halfDepth], [x1, y1, halfDepth], [x0, y1, halfDepth]],
        [0, 0, 1],
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
      );
      addQuad(buffers,
        [[x1, y0, -halfDepth], [x0, y0, -halfDepth], [x0, y1, -halfDepth], [x1, y1, -halfDepth]],
        [0, 0, -1],
        [[u1, v0], [u0, v0], [u0, v1], [u1, v1]],
      );
      frontSpans += 1;
    }
  }

  let sideSpans = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (const edge of ['top', 'bottom'] as const) {
      const neighborY = edge === 'top' ? y - 1 : y + 1;
      let x = 0;
      while (x < mask.width) {
        if (!opaque(x, y) || opaque(x, neighborY)) { x += 1; continue; }
        const start = x;
        while (x + 1 < mask.width && opaque(x + 1, y) && !opaque(x + 1, neighborY)) x += 1;
        const end = x + 1;
        const edgeY = edge === 'top' ? yAt(y) : yAt(y + 1);
        const normal = edge === 'top' ? [0, 1, 0] as const : [0, -1, 0] as const;
        addQuad(buffers,
          [[xAt(start), edgeY, -halfDepth], [xAt(end), edgeY, -halfDepth], [xAt(end), edgeY, halfDepth], [xAt(start), edgeY, halfDepth]],
          normal,
          [[start / mask.width, 1 - y / mask.height], [end / mask.width, 1 - y / mask.height], [end / mask.width, 1 - (y + 1) / mask.height], [start / mask.width, 1 - (y + 1) / mask.height]],
        );
        sideSpans += 1;
        x += 1;
      }
    }
  }

  for (let x = 0; x < mask.width; x += 1) {
    for (const edge of ['left', 'right'] as const) {
      const neighborX = edge === 'left' ? x - 1 : x + 1;
      let y = 0;
      while (y < mask.height) {
        if (!opaque(x, y) || opaque(neighborX, y)) { y += 1; continue; }
        const start = y;
        while (y + 1 < mask.height && opaque(x, y + 1) && !opaque(neighborX, y + 1)) y += 1;
        const end = y + 1;
        const edgeX = edge === 'left' ? xAt(x) : xAt(x + 1);
        const normal = edge === 'left' ? [-1, 0, 0] as const : [1, 0, 0] as const;
        addQuad(buffers,
          [[edgeX, yAt(end), halfDepth], [edgeX, yAt(end), -halfDepth], [edgeX, yAt(start), -halfDepth], [edgeX, yAt(start), halfDepth]],
          normal,
          [[x / mask.width, 1 - end / mask.height], [(x + 1) / mask.width, 1 - end / mask.height], [(x + 1) / mask.width, 1 - start / mask.height], [x / mask.width, 1 - start / mask.height]],
        );
        sideSpans += 1;
        y += 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(buffers.indices);
  geometry.userData.generatedItem = Object.freeze({
    width: mask.width,
    height: mask.height,
    opaquePixels: mask.alpha.reduce((count, alpha) => count + (alpha > OPAQUE_THRESHOLD ? 1 : 0), 0),
    frontSpans,
    sideSpans,
    depth,
  });
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
