/** One texel is one cloud block. Built once; the mesh only scrolls UVs. */
export const CLOUD_MASK_SIZE = 96;

const CELL = 18;

/** Puffy silhouettes. Dots are sky. Each row is 9 texels. */
const CLOUD_SHAPES: readonly (readonly string[])[] = [
  [
    '..#####..',
    '.#######.',
    '#########',
    '.#######.',
    '..#####..',
  ],
  [
    '...####..',
    '.#######.',
    '########.',
    '.######..',
    '..####...',
  ],
  [
    '..####...',
    '.######..',
    '########.',
    '.#######.',
    '...#####.',
  ],
  [
    '....###..',
    '..######.',
    '.########',
    '..######.',
    '...####..',
  ],
];

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Alpha 255 on a cloud block, 0 in the gap. */
export function cloudMaskAlpha(size = CLOUD_MASK_SIZE): Uint8Array {
  const alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cellX = Math.floor(x / CELL);
      const cellY = Math.floor(y / CELL);
      const presence = hash2(cellX, cellY);
      if (presence < 0.46) continue;
      const shape = CLOUD_SHAPES[Math.floor(hash2(cellX + 4, cellY + 9) * CLOUD_SHAPES.length) % CLOUD_SHAPES.length];
      if (!shape) continue;
      const row = shape[0];
      if (!row) continue;
      const shiftX = Math.floor(hash2(cellX + 2, cellY) * 4);
      const shiftY = 6 + Math.floor(hash2(cellX, cellY + 3) * 3);
      const localX = x - cellX * CELL - shiftX;
      const localY = y - cellY * CELL - shiftY;
      const bits = shape[localY];
      if (!bits || localX < 0 || localX >= bits.length) continue;
      if (bits[localX] === '#') alpha[y * size + x] = 255;
    }
  }
  return alpha;
}

export function cloudCoverage(alpha: Uint8Array): number {
  let filled = 0;
  for (let i = 0; i < alpha.length; i += 1) if ((alpha[i] ?? 0) > 0) filled += 1;
  return alpha.length === 0 ? 0 : filled / alpha.length;
}
