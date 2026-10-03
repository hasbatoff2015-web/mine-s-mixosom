/**
 * One cloud tile. Built once at startup. The mesh only scrolls UVs.
 * 256×256 texels at 2 blocks each span 512 blocks, so the pattern is not a
 * small stamp repeated across the whole sky.
 */
export const CLOUD_MASK_SIZE = 256;
/** Fixed seed. Placement uses this generator only. */
export const CLOUD_MASK_SEED = 0x51c10d;

/**
 * Enough separate groups to land near 10–18% coverage while each cloud stays
 * in the small/medium/large width bands. Fewer groups on a 512-block tile
 * leave the sky almost empty.
 */
const TARGET_CLOUDS = 120;
/** Toroidal gap between centers, in texels. Stops the clouds from forming a grid. */
const MIN_CENTER_DISTANCE = 15;

export type CloudSizeClass = 'small' | 'medium' | 'large';

export interface CloudStamp {
  readonly sizeClass: CloudSizeClass;
  readonly widthTexels: number;
  readonly heightTexels: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function toroidalDistance(ax: number, ay: number, bx: number, by: number, size: number): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > size / 2) dx = size - dx;
  if (dy > size / 2) dy = size - dy;
  return Math.hypot(dx, dy);
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

function rangeInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickClass(rng: () => number): CloudSizeClass {
  const roll = rng();
  if (roll < 0.55) return 'small';
  if (roll < 0.9) return 'medium';
  return 'large';
}

/** Width in texels. At 2 blocks per texel this is the 12–46 block mix. */
function widthFor(sizeClass: CloudSizeClass, rng: () => number): number {
  if (sizeClass === 'small') return rangeInt(rng, 8, 11);
  if (sizeClass === 'medium') return rangeInt(rng, 12, 17);
  return rangeInt(rng, 18, 23);
}

interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Base body plus 1–5 overlapping lobes. Every extra lobe covers a pixel of
 * an earlier lobe, so the cloud stays one piece and the middle stays solid.
 */
function buildLobes(rng: () => number, width: number, height: number): Lobe[] {
  const lobes: Lobe[] = [];
  const bodyH = Math.max(2, Math.round(height * (0.78 + rng() * 0.18)));
  const bodyY = Math.max(0, height - bodyH);
  lobes.push({ x: 0, y: bodyY, w: width, h: Math.min(bodyH, height - bodyY) });
  const extras = 1 + Math.floor(rng() * 5);
  for (let i = 0; i < extras; i += 1) {
    const host = lobes[Math.floor(rng() * lobes.length)];
    if (!host) break;
    const lw = Math.max(2, Math.min(width, Math.round(width * (0.32 + rng() * 0.4))));
    const lh = Math.max(2, Math.min(height, Math.round(height * (0.38 + rng() * 0.42))));
    const ax = host.x + Math.floor(rng() * host.w);
    const ay = host.y + Math.floor(rng() * host.h);
    let x = ax - Math.floor(rng() * Math.max(1, lw - 1));
    let y = ay - Math.floor(lh * (0.4 + rng() * 0.5));
    x = Math.max(0, Math.min(width - 2, x));
    y = Math.max(0, Math.min(height - 2, y));
    const w = Math.max(2, Math.min(lw, width - x));
    const h = Math.max(2, Math.min(lh, height - y));
    lobes.push({ x, y, w, h });
  }
  return lobes;
}

function orthogonalFilled(alpha: Uint8Array, size: number, x: number, y: number): number {
  let count = 0;
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const [dx, dy] of steps) {
    const px = wrap(x + dx, size);
    const py = wrap(y + dy, size);
    if ((alpha[py * size + px] ?? 0) > 0) count += 1;
  }
  return count;
}

/** Drop 1px spikes and fill single-pixel holes. No blur. */
function cleanupMask(alpha: Uint8Array, size: number): void {
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

interface BuiltMask {
  readonly alpha: Uint8Array;
  readonly stamps: readonly CloudStamp[];
}

let built: BuiltMask | undefined;

function heightFor(width: number, rng: () => number): number {
  const ratio = 1.7 + rng() * (3.5 - 1.7);
  let height = Math.max(3, Math.round(width / ratio));
  if (width / height < 1.7) height = Math.max(3, Math.floor(width / 1.7));
  if (width / height > 3.5) height = Math.max(3, Math.ceil(width / 3.5));
  return Math.min(height, width);
}

function buildCloudMask(): BuiltMask {
  if (built) return built;
  const size = CLOUD_MASK_SIZE;
  const rng = mulberry32(CLOUD_MASK_SEED);
  const alpha = new Uint8Array(size * size);
  const centers: Array<{ x: number; y: number }> = [];
  let attempts = 0;
  while (centers.length < TARGET_CLOUDS && attempts < 20_000) {
    attempts += 1;
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    let clear = true;
    for (const center of centers) {
      if (toroidalDistance(center.x, center.y, x, y, size) < MIN_CENTER_DISTANCE) {
        clear = false;
        break;
      }
    }
    if (clear) centers.push({ x, y });
  }
  const stamps: CloudStamp[] = [];
  for (const center of centers) {
    const sizeClass = pickClass(rng);
    const width = widthFor(sizeClass, rng);
    const height = heightFor(width, rng);
    const lobes = buildLobes(rng, width, height);
    const originX = center.x - Math.floor(width / 2);
    const originY = center.y - Math.floor(height / 2);
    for (const lobe of lobes) {
      paintWrappedRect(alpha, size, originX + lobe.x, originY + lobe.y, lobe.w, lobe.h);
    }
    stamps.push({ sizeClass, widthTexels: width, heightTexels: height });
  }
  cleanupMask(alpha, size);
  built = { alpha, stamps };
  return built;
}

/** Alpha 255 on a cloud texel, 0 in the sky. Same bytes for the same seed. */
export function cloudMaskAlpha(size = CLOUD_MASK_SIZE): Uint8Array {
  if (size !== CLOUD_MASK_SIZE) {
    throw new Error(`cloud mask is fixed at ${CLOUD_MASK_SIZE}`);
  }
  return buildCloudMask().alpha.slice();
}

export function cloudStamps(): readonly CloudStamp[] {
  return buildCloudMask().stamps;
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
