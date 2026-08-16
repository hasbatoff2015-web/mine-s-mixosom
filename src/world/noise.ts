const UINT_MAX = 0xffff_ffff;

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashCoords(seed: number, x: number, y = 0, z = 0): number {
  let hash = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function random01(seed: number, x: number, y = 0, z = 0): number {
  return hashCoords(seed, x, y, z) / UINT_MAX;
}

const smooth = (value: number): number => value * value * (3 - 2 * value);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function valueNoise2D(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = smooth(x - ix);
  const tz = smooth(z - iz);
  const a = random01(seed, ix, 0, iz) * 2 - 1;
  const b = random01(seed, ix + 1, 0, iz) * 2 - 1;
  const c = random01(seed, ix, 0, iz + 1) * 2 - 1;
  const d = random01(seed, ix + 1, 0, iz + 1) * 2 - 1;
  return mix(mix(a, b, tx), mix(c, d, tx), tz);
}

export function valueNoise3D(seed: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  const tz = smooth(z - iz);
  const sample = (dx: number, dy: number, dz: number) => random01(seed, ix + dx, iy + dy, iz + dz) * 2 - 1;
  const x00 = mix(sample(0, 0, 0), sample(1, 0, 0), tx);
  const x10 = mix(sample(0, 1, 0), sample(1, 1, 0), tx);
  const x01 = mix(sample(0, 0, 1), sample(1, 0, 1), tx);
  const x11 = mix(sample(0, 1, 1), sample(1, 1, 1), tx);
  return mix(mix(x00, x10, ty), mix(x01, x11, ty), tz);
}

export function fbm2D(seed: number, x: number, z: number, octaves = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise2D(seed + octave * 1013, x * frequency, z * frequency) * amplitude;
    normalizer += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value / normalizer;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
