/**
 * Original 64×64 bee sheet painted on the bedrock bee UV islands.
 * The pixel art is not the Mojang PNG. Island positions match geometry.bee.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from './png-rgba.mjs';

const WIDTH = 64;
const HEIGHT = 64;
const YELLOW = [246, 196, 48, 255];
const YELLOW_DEEP = [214, 150, 28, 255];
const BLACK = [36, 32, 38, 255];
const BROWN = [92, 58, 36, 255];
const EYE = [250, 248, 240, 255];
const PUPIL = [18, 16, 22, 255];
const WING = [210, 232, 250, 168];
const VEIN = [236, 246, 255, 230];
const CLEAR = [0, 0, 0, 0];

function paint(data, u, v, width, height, colorAt) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = u + x;
      const py = v + y;
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) throw new Error(`UV overflow ${px},${py}`);
      const color = colorAt(x, y, width, height);
      const index = (py * WIDTH + px) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = color[3];
    }
  }
}

function stripe(along) {
  const band = Math.floor(along / 2) % 2;
  return band === 0 ? YELLOW : BLACK;
}

function face(x, y) {
  const eye = (x === 1 || x === 5) && y === 1;
  const pupil = (x === 1 || x === 5) && y === 2;
  if (eye) return EYE;
  if (pupil) return PUPIL;
  if ((y === 4 || y === 5) && (x <= 1 || x >= 5)) return BLACK;
  return y >= 5 ? YELLOW_DEEP : YELLOW;
}

function wing(x, y, width, height, flip) {
  const px = flip ? width - 1 - x : x;
  const nx = (px + 0.5) / width - 0.45;
  const ny = (y + 0.5) / height - 0.5;
  if (nx * nx * 3.2 + ny * ny * 5.2 > 1) return CLEAR;
  if (px === 2 || y === 2) return VEIN;
  return WING;
}

export function createBeeTextureRgba() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  // Body 7×7×10 at [0, 0].
  paint(data, 10, 0, 7, 10, (_x, y) => stripe(y));
  paint(data, 17, 0, 7, 10, (_x, y) => (stripe(y) === BLACK ? BROWN : YELLOW_DEEP));
  paint(data, 0, 10, 10, 7, (x) => stripe(x));
  paint(data, 17, 10, 10, 7, (x) => stripe(9 - x));
  paint(data, 10, 10, 7, 7, face);
  paint(data, 27, 10, 7, 7, () => BROWN);
  // Antenna faces for cubes at [2, 0] and [2, 3].
  paint(data, 5, 0, 1, 3, () => BLACK);
  paint(data, 6, 0, 1, 3, () => BLACK);
  paint(data, 2, 3, 3, 2, () => BLACK);
  paint(data, 5, 3, 1, 2, () => BLACK);
  paint(data, 6, 3, 3, 2, () => BLACK);
  paint(data, 9, 3, 1, 2, () => BLACK);
  paint(data, 5, 3, 1, 3, () => BLACK);
  paint(data, 6, 3, 1, 3, () => BLACK);
  paint(data, 2, 6, 3, 2, () => BLACK);
  paint(data, 5, 6, 1, 2, () => BLACK);
  paint(data, 6, 6, 3, 2, () => BLACK);
  paint(data, 9, 6, 1, 2, () => BLACK);
  // Stinger plane [26, 7], size 0×1×2. Visible left/right islands.
  paint(data, 26, 9, 2, 1, () => BROWN);
  paint(data, 28, 9, 2, 1, () => BLACK);
  // Three flat leg segments. Visible front/back islands.
  for (const v of [1, 3, 5]) {
    paint(data, 26, v, 7, 2, (x, y) => ((x === 2 || x === 4) && y === 0 ? BLACK : YELLOW_DEEP));
    paint(data, 33, v, 7, 2, (x, y) => ((x === 2 || x === 4) && y === 0 ? BLACK : BROWN));
  }
  // Wings. Top and bottom islands, right [0, 18] and left [9, 24].
  paint(data, 6, 18, 9, 6, (x, y, w, h) => wing(x, y, w, h, false));
  paint(data, 15, 18, 9, 6, (x, y, w, h) => wing(x, y, w, h, false));
  paint(data, 15, 24, 9, 6, (x, y, w, h) => wing(x, y, w, h, true));
  paint(data, 24, 24, 9, 6, (x, y, w, h) => wing(x, y, w, h, true));
  return data;
}

const target = join(dirname(fileURLToPath(import.meta.url)), '../public/textures/entity/bee.png');
writeFileSync(target, encodeRgbaPng({ width: WIDTH, height: HEIGHT, data: createBeeTextureRgba() }));
console.log(`wrote ${target}`);
