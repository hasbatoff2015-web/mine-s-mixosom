/**
 * One cloud tile, built once. The mesh only scrolls UVs.
 *
 * The previous generator stamped a full-width horizontal rectangle and then
 * a few lobes on top, and it kept those stamps about a minimum distance
 * apart. That is why the sky read as a field of dashes: each shape started
 * as a bar, and the bars were spread evenly. This tile is a thresholded
 * two-scale field instead. Macro noise decides where a region may have
 * clouds. Detail noise cuts the blocky edge inside that region. The result
 * stays binary. There is no blur.
 *
 * 512×512 texels at 2 blocks each span 1024 blocks.
 */
export const CLOUD_MASK_SIZE = 512;
/** Fixed seed. The field uses this hash only. */
export const CLOUD_MASK_SEED = 0x51c10d;

/** Coarse weather. One cell is 128 texels, so empty sky comes in large blocks. */
const MACRO_CELLS = 4;
/** Groups clouds inside a weather cell instead of scattering them evenly. */
const REGION_CELLS = 8;
/** About 25.6 texels. This is the block scale of a cloud edge. */
const DETAIL_CELLS = 28;
/** Finer lumps so a cloud is not a smooth oval. */
const FINE_CELLS = 36;
const MACRO_WEIGHT = 0.7;
const DETAIL_WEIGHT = 0.3;
const FIELD_THRESHOLD = 0.598;
const MIN_COMPONENT_AREA = 18;
/** Above this, a painted blob is a bank, not one Minecraft-like cloud. */
const MAX_COMPONENT_WIDTH = 52;
const MAX_COMPONENT_HEIGHT = 28;
const SPLIT_DETAIL = 0.66;

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface CloudComponentBox {
  readonly area: number;
  readonly widthTexels: number;
  readonly heightTexels: number;
}

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix + seed, 374761393) ^ Math.imul(iy + (seed >>> 16), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/** Periodic value noise. The lattice count divides the tile, so the edges meet. */
function latticeNoise(x: number, y: number, cells: number, seed: number, size: number): number {
  const scale = size / cells;
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sample = (ix: number, iy: number): number => {
    const wx = ((ix % cells) + cells) % cells;
    const wy = ((iy % cells) + cells) % cells;
    return hash2(wx, wy, seed);
  };
  const v00 = sample(x0, y0);
  const v10 = sample(x0 + 1, y0);
  const v01 = sample(x0, y0 + 1);
  const v11 = sample(x0 + 1, y0 + 1);
  const ix0 = v00 + (v10 - v00) * sx;
  const ix1 = v01 + (v11 - v01) * sx;
  return ix0 + (ix1 - ix0) * sy;
}

/**
 * Where clouds are allowed. Low macro values are clear sky. The gate is
 * smooth, but once it is near zero the detail term cannot cross the
 * threshold, so whole sectors stay empty.
 */
function macroAt(x: number, y: number, size: number): number {
  const weather = latticeNoise(x, y, MACRO_CELLS, CLOUD_MASK_SEED, size);
  const region = latticeNoise(x, y, REGION_CELLS, CLOUD_MASK_SEED ^ 0x85ebca6b, size);
  const gate = smoothstep(0.4, 0.64, weather);
  // The open gate stays near the threshold so detail valleys stay sky.
  return gate * (0.5 + 0.16 * region);
}

function detailAt(x: number, y: number, size: number): number {
  const coarse = latticeNoise(x, y, DETAIL_CELLS, CLOUD_MASK_SEED ^ 0x27d4eb2d, size);
  const fine = latticeNoise(x, y, FINE_CELLS, CLOUD_MASK_SEED ^ 0xc2b2ae35, size);
  return coarse * 0.78 + fine * 0.22;
}

/**
 * Scalar field before the binary cut. Coordinates outside the tile match the
 * wrapped texel, because every lattice is periodic.
 */
export function cloudScalarField(x: number, y: number, size = CLOUD_MASK_SIZE): number {
  return macroAt(x, y, size) * MACRO_WEIGHT + detailAt(x, y, size) * DETAIL_WEIGHT;
}

/** Solid rectangle. Coordinates that leave the tile continue on the opposite edge. */
export function paintWrappedRect(
  alpha: Uint8Array,
  size: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const px = wrap(x + col, size);
      const py = wrap(y + row, size);
      alpha[py * size + px] = 255;
    }
  }
}

function orthogonalFilled(alpha: Uint8Array, size: number, x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const px = wrap(x + dx, size);
    const py = wrap(y + dy, size);
    if ((alpha[py * size + px] ?? 0) > 0) count += 1;
  }
  return count;
}

/** 5×3 toroidal majority. Keeps the mask binary and knocks out 1px spikes. */
function majorityFilter(alpha: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = wrap(x + dx, size);
          const py = wrap(y + dy, size);
          if ((alpha[py * size + px] ?? 0) > 0) count += 1;
        }
      }
      const on = (alpha[y * size + x] ?? 0) > 0;
      // Keep dense cores and fill only tight holes. A full majority bridges
      // neighboring clouds into one slab.
      if ((on && count >= 6) || (!on && count >= 13)) out[y * size + x] = 255;
    }
  }
  return out;
}

function fillHolesAndSpikes(alpha: Uint8Array, size: number): void {
  const filled = alpha.slice();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if ((alpha[index] ?? 0) > 0) continue;
      if (orthogonalFilled(alpha, size, x, y) === 4) filled[index] = 255;
    }
  }
  const cleared = filled.slice();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if ((filled[index] ?? 0) === 0) continue;
      if (orthogonalFilled(filled, size, x, y) <= 1) cleared[index] = 0;
    }
  }
  alpha.set(cleared);
}

function toroidalSpan(coords: readonly number[], size: number): number {
  if (coords.length === 0) return 0;
  const seen = new Uint8Array(size);
  for (const value of coords) seen[value] = 1;
  const unique: number[] = [];
  for (let i = 0; i < size; i += 1) if (seen[i]) unique.push(i);
  if (unique.length === 0) return 0;
  if (unique.length === size) return size;
  let maxGap = unique[0]! + size - unique[unique.length - 1]!;
  for (let i = 1; i < unique.length; i += 1) {
    const gap = unique[i]! - unique[i - 1]!;
    if (gap > maxGap) maxGap = gap;
  }
  return size - maxGap + 1;
}

function componentIsStripe(width: number, height: number): boolean {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  return shortSide <= 2 && longSide / Math.max(1, shortSide) >= 4;
}

/** Drop specks and 1–2 texel bars. The bounding box is the painted component, wrapped. */
/**
 * Open valleys inside a blob that is wider or taller than the target.
 * Small clouds are left alone. The cut uses the same detail field, so the
 * new edge is still blocky and the tile still wraps.
 */
function splitOversized(alpha: Uint8Array, size: number, detailCutoff: number): void {
  const seen = new Uint8Array(size * size);
  const qx = new Int32Array(size * size);
  const qy = new Int32Array(size * size);
  const cuts: number[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const start = y * size + x;
      if (seen[start] || (alpha[start] ?? 0) === 0) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;
      seen[start] = 1;
      const xs: number[] = [];
      const ys: number[] = [];
      while (head < tail) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head += 1;
        xs.push(cx);
        ys.push(cy);
        for (const [dx, dy] of NEIGHBORS) {
          const nx = wrap(cx + dx, size);
          const ny = wrap(cy + dy, size);
          const index = ny * size + nx;
          if (seen[index] || (alpha[index] ?? 0) === 0) continue;
          seen[index] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail += 1;
        }
      }
      const width = toroidalSpan(xs, size);
      const height = toroidalSpan(ys, size);
      if (width <= MAX_COMPONENT_WIDTH && height <= MAX_COMPONENT_HEIGHT) continue;
      for (let i = 0; i < xs.length; i += 1) {
        const px = xs[i]!;
        const py = ys[i]!;
        if (detailAt(px, py, size) < detailCutoff) cuts.push(py * size + px);
      }
    }
  }
  for (const index of cuts) alpha[index] = 0;
}

function pruneComponents(alpha: Uint8Array, size: number): void {
  const seen = new Uint8Array(size * size);
  const qx = new Int32Array(size * size);
  const qy = new Int32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const start = y * size + x;
      if (seen[start] || (alpha[start] ?? 0) === 0) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;
      seen[start] = 1;
      const xs: number[] = [];
      const ys: number[] = [];
      while (head < tail) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head += 1;
        xs.push(cx);
        ys.push(cy);
        for (const [dx, dy] of NEIGHBORS) {
          const nx = wrap(cx + dx, size);
          const ny = wrap(cy + dy, size);
          const index = ny * size + nx;
          if (seen[index] || (alpha[index] ?? 0) === 0) continue;
          seen[index] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail += 1;
        }
      }
      const width = toroidalSpan(xs, size);
      const height = toroidalSpan(ys, size);
      if (xs.length < MIN_COMPONENT_AREA || componentIsStripe(width, height)) {
        for (let i = 0; i < xs.length; i += 1) alpha[ys[i]! * size + xs[i]!] = 0;
      }
    }
  }
}

let cached: Uint8Array | undefined;

function buildCloudMask(): Uint8Array {
  if (cached) return cached;
  const size = CLOUD_MASK_SIZE;
  const alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cloudScalarField(x, y, size) >= FIELD_THRESHOLD) alpha[y * size + x] = 255;
    }
  }
  const majority = majorityFilter(alpha, size);
  alpha.set(majority);
  fillHolesAndSpikes(alpha, size);
  splitOversized(alpha, size, SPLIT_DETAIL);
  pruneComponents(alpha, size);
  fillHolesAndSpikes(alpha, size);
  pruneComponents(alpha, size);
  cached = alpha;
  return cached;
}

/** Alpha 255 on a cloud texel, 0 in the sky. Same bytes for the same seed. */
export function cloudMaskAlpha(size = CLOUD_MASK_SIZE): Uint8Array {
  if (size !== CLOUD_MASK_SIZE) {
    throw new Error(`cloud mask is fixed at ${CLOUD_MASK_SIZE}`);
  }
  return buildCloudMask().slice();
}

export function cloudCoverage(alpha: Uint8Array): number {
  let filled = 0;
  for (let i = 0; i < alpha.length; i += 1) if ((alpha[i] ?? 0) > 0) filled += 1;
  return alpha.length === 0 ? 0 : filled / alpha.length;
}

/** Empty texels whose four toroidal neighbors are cloud. Cleanup should leave none. */
export function interiorHoleCount(alpha: Uint8Array, size = CLOUD_MASK_SIZE): number {
  let holes = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((alpha[y * size + x] ?? 0) > 0) continue;
      if (orthogonalFilled(alpha, size, x, y) === 4) holes += 1;
    }
  }
  return holes;
}

/** Real painted components, including shapes that cross the tile edge. */
export function cloudComponents(alpha: Uint8Array, size = CLOUD_MASK_SIZE): CloudComponentBox[] {
  const seen = new Uint8Array(size * size);
  const qx = new Int32Array(size * size);
  const qy = new Int32Array(size * size);
  const components: CloudComponentBox[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const start = y * size + x;
      if (seen[start] || (alpha[start] ?? 0) === 0) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail += 1;
      seen[start] = 1;
      const xs: number[] = [];
      const ys: number[] = [];
      while (head < tail) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head += 1;
        xs.push(cx);
        ys.push(cy);
        for (const [dx, dy] of NEIGHBORS) {
          const nx = wrap(cx + dx, size);
          const ny = wrap(cy + dy, size);
          const index = ny * size + nx;
          if (seen[index] || (alpha[index] ?? 0) === 0) continue;
          seen[index] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail += 1;
        }
      }
      components.push({
        area: xs.length,
        widthTexels: toroidalSpan(xs, size),
        heightTexels: toroidalSpan(ys, size),
      });
    }
  }
  return components;
}

/**
 * 8×8 sectors of the tile. `empty` counts sectors with no cloud texel.
 * A field that puts a cloud in every sector reads as a uniform dash pattern.
 */
export function cloudMacroSectors(
  alpha: Uint8Array,
  size = CLOUD_MASK_SIZE,
  cells = 8,
): { readonly empty: number; readonly total: number } {
  const cell = size / cells;
  let empty = 0;
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      let filled = 0;
      const x0 = cx * cell;
      const y0 = cy * cell;
      for (let y = y0; y < y0 + cell; y += 1) {
        for (let x = x0; x < x0 + cell; x += 1) {
          if ((alpha[y * size + x] ?? 0) > 0) filled += 1;
        }
      }
      if (filled === 0) empty += 1;
    }
  }
  return { empty, total: cells * cells };
}
