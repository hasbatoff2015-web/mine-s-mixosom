/**
 * Original 64×64 bee sheet. UV islands match BEE_MODEL in src/entities/beeModel.ts.
 * Not a copy of the Mojang bedrock bee texture.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from './png-rgba.mjs';

const WIDTH = 64;
const HEIGHT = 64;

const YELLOW = [246, 208, 52, 255];
const YELLOW_MID = [232, 176, 36, 255];
const YELLOW_DEEP = [186, 128, 28, 255];
const BLACK = [32, 30, 34, 255];
const BLACK_SOFT = [54, 50, 56, 255];
const EYE = [248, 248, 252, 255];
const PUPIL = [16, 14, 18, 255];
const STINGER = [58, 56, 62, 255];
const STINGER_TIP = [28, 26, 30, 255];
const ANTENNA = [42, 40, 44, 255];
const LEG = [48, 44, 46, 255];
const WING = [206, 230, 248, 176];
const WING_VEIN = [238, 246, 255, 236];
const CLEAR = [0, 0, 0, 0];

function paint(data, u, v, width, height, colorAt) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = u + x;
      const py = v + y;
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) {
        throw new Error(`UV overflow ${px},${py}`);
      }
      const color = colorAt(x, y, width, height);
      const index = (py * WIDTH + px) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = color[3];
    }
  }
}

function stripeColor(along, length) {
  const head = along < 2;
  if (head) return along === 0 ? YELLOW : YELLOW_MID;
  const band = Math.floor((along - 2) / 2) % 2;
  return band === 0 ? BLACK : (along % 4 === 3 ? YELLOW_MID : YELLOW);
}

function bodyFront(x, y) {
  const leftEye = x >= 1 && x <= 2 && y >= 2 && y <= 3;
  const rightEye = x >= 4 && x <= 5 && y >= 2 && y <= 3;
  if (leftEye || rightEye) {
    const pupil = (x === 2 || x === 5) && y >= 2;
    return pupil ? PUPIL : EYE;
  }
  if (y === 5 && x >= 2 && x <= 4) return BLACK_SOFT;
  if (y >= 6) return YELLOW_DEEP;
  return y <= 1 ? YELLOW : YELLOW_MID;
}

function bodySide(x, y) {
  const base = stripeColor(x, 10);
  return y === 0 || y === 6 ? (base === BLACK ? BLACK_SOFT : YELLOW_DEEP) : base;
}

function bodyTop(x, y) {
  return stripeColor(y, 10);
}

function bodyBack(x, y) {
  return (x + y) % 3 === 0 ? BLACK : BLACK_SOFT;
}

function bodyBottom(x, y) {
  return stripeColor(y, 10) === BLACK ? BLACK_SOFT : YELLOW_DEEP;
}

function wingMembrane(x, y, width, height) {
  const nx = (x + 0.5) / width - 0.5;
  const ny = (y + 0.5) / height - 0.5;
  const ellipse = nx * nx * 3.1 + ny * ny * 4.4;
  if (ellipse > 1) return CLEAR;
  const vein = x === 1 || y === Math.floor(height / 2) || (x === 4 && y >= 1 && y <= height - 2);
  return vein ? WING_VEIN : WING;
}

function stingerColor(x, y, width, height) {
  return x > width * 0.55 || y > height * 0.55 ? STINGER_TIP : STINGER;
}

export function createBeeTextureRgba() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  // Body 7×7×10 at [0, 0]. Cross layout from cuboidUvRects.
  paint(data, 10, 0, 7, 10, bodyTop);
  paint(data, 17, 0, 7, 10, bodyBottom);
  paint(data, 0, 10, 10, 7, bodySide);
  paint(data, 10, 10, 7, 7, bodyFront);
  paint(data, 17, 10, 10, 7, (x, y) => bodySide(9 - x, y));
  paint(data, 27, 10, 7, 7, bodyBack);
  // Stinger 2×2×4 at [0, 20].
  paint(data, 4, 20, 2, 4, stingerColor);
  paint(data, 6, 20, 2, 4, stingerColor);
  paint(data, 0, 24, 4, 2, () => STINGER);
  paint(data, 4, 24, 2, 2, () => STINGER_TIP);
  paint(data, 6, 24, 4, 2, () => STINGER);
  paint(data, 10, 24, 2, 2, () => STINGER_TIP);
  // Antenna 1×5×1 at [16, 20].
  paint(data, 17, 20, 1, 1, () => ANTENNA);
  paint(data, 18, 20, 1, 1, () => ANTENNA);
  paint(data, 16, 21, 1, 5, () => ANTENNA);
  paint(data, 17, 21, 1, 5, () => ANTENNA);
  paint(data, 18, 21, 1, 5, () => ANTENNA);
  paint(data, 19, 21, 1, 5, () => ANTENNA);
  // Legs 1×3×1 at [24, 20].
  paint(data, 25, 20, 1, 1, () => LEG);
  paint(data, 26, 20, 1, 1, () => LEG);
  paint(data, 24, 21, 1, 3, () => LEG);
  paint(data, 25, 21, 1, 3, () => LEG);
  paint(data, 26, 21, 1, 3, () => LEG);
  paint(data, 27, 21, 1, 3, () => LEG);
  // Wings 10×1×7 at [0, 32]. Top and bottom share the membrane.
  paint(data, 7, 32, 10, 7, wingMembrane);
  paint(data, 17, 32, 10, 7, wingMembrane);
  paint(data, 0, 39, 7, 1, (x) => (x === 0 || x === 6 ? CLEAR : WING_VEIN));
  paint(data, 7, 39, 10, 1, (x) => (x === 0 || x === 9 ? CLEAR : WING));
  paint(data, 17, 39, 7, 1, (x) => (x === 0 || x === 6 ? CLEAR : WING_VEIN));
  paint(data, 24, 39, 10, 1, (x) => (x === 0 || x === 9 ? CLEAR : WING));
  return data;
}

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '../public/textures/entity/bee.png');
writeFileSync(target, encodeRgbaPng({ width: WIDTH, height: HEIGHT, data: createBeeTextureRgba() }));
console.log(`wrote ${target}`);
