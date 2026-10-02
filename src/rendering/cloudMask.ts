/** One texel is a cloud block. Groups leave wide gaps so the layer stays readable. */
export const CLOUD_MASK_SIZE = 96;

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Alpha 255 on a cloud block, 0 in the gap. Built once; the mesh only scrolls UVs. */
export function cloudMaskAlpha(size = CLOUD_MASK_SIZE): Uint8Array {
  const alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const groupX = Math.floor(x / 6);
      const groupY = Math.floor(y / 6);
      const cluster = hash2(groupX, groupY);
      const block = hash2(x + 19, y + 7);
      alpha[y * size + x] = cluster > 0.72 && block > 0.28 ? 255 : 0;
    }
  }
  return alpha;
}

export function cloudCoverage(alpha: Uint8Array): number {
  let filled = 0;
  for (let i = 0; i < alpha.length; i += 1) if ((alpha[i] ?? 0) > 0) filled += 1;
  return alpha.length === 0 ? 0 : filled / alpha.length;
}
