/** Original Frontier crack masks. Not Mojang `destroy_stage_*` art. */

export const BREAKING_STAGE_SIZE = 32;
export const BREAKING_STAGE_COUNT = 10;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 32×32 RGBA crack mask for stage 0..9.
 * Later stages keep earlier strokes and add more fractures.
 */
export function breakingStagePixels(stage: number): Uint8ClampedArray {
  const size = BREAKING_STAGE_SIZE;
  const data = new Uint8ClampedArray(size * size * 4);
  const coverage = new Float32Array(size * size);
  const s = Math.max(0, Math.min(BREAKING_STAGE_COUNT - 1, Math.floor(stage)));

  const plot = (x: number, y: number, amount: number): void => {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= size || iy >= size || amount <= 0) return;
    const index = iy * size + ix;
    if (amount > coverage[index]!) coverage[index] = amount;
  };

  const stamp = (x: number, y: number, radius: number, amount: number): void => {
    const reach = Math.max(0.55, radius);
    const minX = Math.floor(x - reach);
    const maxX = Math.ceil(x + reach);
    const minY = Math.floor(y - reach);
    const maxY = Math.ceil(y + reach);
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y);
        if (distance <= reach) plot(px, py, amount * (1 - (distance / reach) * 0.4));
      }
    }
  };

  const walk = (
    rng: () => number,
    startX: number,
    startY: number,
    angle: number,
    length: number,
    thickness: number,
    branches: number,
  ): void => {
    let x = startX;
    let y = startY;
    let dir = angle;
    const steps = Math.max(5, Math.floor(length));
    for (let step = 0; step < steps; step += 1) {
      stamp(x, y, thickness, 0.78 + rng() * 0.22);
      dir += (rng() - 0.5) * 0.48;
      x += Math.cos(dir);
      y += Math.sin(dir);
      if (branches > 0 && rng() < 0.1) {
        walk(rng, x, y, dir + (rng() - 0.5) * 1.3, length * 0.4, thickness * 0.84, branches - 1);
      }
    }
  };

  const crackCount = 4 + s;
  for (let crack = 0; crack < crackCount; crack += 1) {
    const rng = mulberry32(0xc0ffee ^ Math.imul(crack + 1, 0x9e3779b9));
    const thickness = 0.5 + Math.min(s, crack) * 0.03;
    walk(
      rng,
      7 + rng() * 18,
      7 + rng() * 18,
      rng() * Math.PI * 2,
      8 + Math.min(s, crack) * 1.4 + rng() * 4,
      thickness,
      crack >= 4 ? 2 : 1,
    );
  }
  const chips = s * 3;
  for (let chip = 0; chip < chips; chip += 1) {
    const rng = mulberry32(0x51ed ^ Math.imul(chip + 3, 0x85ebca6b));
    stamp(3 + rng() * 26, 3 + rng() * 26, 0.5 + rng() * 0.3, 0.35 + rng() * 0.4);
  }

  for (let i = 0; i < size * size; i += 1) {
    const alpha = Math.min(255, Math.round((coverage[i] ?? 0) * 255));
    if (alpha <= 0) continue;
    const offset = i * 4;
    data[offset] = 22;
    data[offset + 1] = 20;
    data[offset + 2] = 18;
    data[offset + 3] = alpha;
  }
  return data;
}
