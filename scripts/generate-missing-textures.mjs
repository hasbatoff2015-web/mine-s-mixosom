/**
 * Writes pack-missing gameplay textures as small unique PNGs.
 * Used when the local Faithful tree is absent, and as a fallback after
 * `assets:import` if a mapped source file was not in the pack.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = join(process.cwd(), 'public', 'textures');

function crc32(bytes) {
  let crc = ~0;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, crcInput, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paint(width, height, plotter) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = plotter(x, y) ?? [0, 0, 0, 0];
      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = color[3];
    }
  }
  return encodePng(width, height, rgba);
}

const px = (r, g, b, a = 255) => [r, g, b, a];

const icons = {
  'item/flint_and_steel.png': (x, y) => {
    if (x + y > 22 || x + y < 6) return px(0, 0, 0, 0);
    if (y > x - 2 && y < x + 4) return y < 8 ? px(90, 90, 95) : px(170, 175, 185);
    if (y > 9 && x < 8) return px(70, 70, 78);
    return px(0, 0, 0, 0);
  },
  'item/glass_bottle.png': (x, y) => {
    const dx = Math.abs(x - 7.5);
    const neck = y >= 1 && y <= 4 && dx <= 2;
    const body = y >= 5 && y <= 14 && dx <= 4 + (y - 5) * 0.05;
    if (!neck && !body) return px(0, 0, 0, 0);
    if (dx >= 3.6 || y === 5 || y === 14 || (neck && dx >= 1.6)) return px(210, 230, 235);
    return px(160, 200, 210, 90);
  },
  'item/potion_invisibility.png': (x, y) => {
    const dx = Math.abs(x - 7.5);
    const neck = y >= 1 && y <= 4 && dx <= 2;
    const body = y >= 5 && y <= 14 && dx <= 4;
    if (!neck && !body) return px(0, 0, 0, 0);
    if (dx >= 3.6 || y === 5 || y === 14 || (neck && dx >= 1.6)) return px(210, 230, 235);
    if (y >= 7) return px(180, 170, 210);
    return px(160, 200, 210, 80);
  },
  'item/potion_regeneration.png': (x, y) => {
    const dx = Math.abs(x - 7.5);
    const neck = y >= 1 && y <= 4 && dx <= 2;
    const body = y >= 5 && y <= 14 && dx <= 4;
    if (!neck && !body) return px(0, 0, 0, 0);
    if (dx >= 3.6 || y === 5 || y === 14 || (neck && dx >= 1.6)) return px(210, 230, 235);
    if (y >= 7) return px(255, 90, 150);
    return px(160, 200, 210, 80);
  },
  'item/bucket.png': (x, y) => {
    if (y < 4 || y > 14 || x < 2 || x > 13) return px(0, 0, 0, 0);
    if (x === 2 || x === 13 || y === 14 || y === 4) return px(90, 90, 95);
    return px(150, 150, 158);
  },
  'item/water_bucket.png': (x, y) => {
    if (y < 4 || y > 14 || x < 2 || x > 13) return px(0, 0, 0, 0);
    if (x === 2 || x === 13 || y === 14 || y === 4) return px(90, 90, 95);
    if (y >= 7) return px(40, 90, 200);
    return px(150, 150, 158);
  },
  'item/lava_bucket.png': (x, y) => {
    if (y < 4 || y > 14 || x < 2 || x > 13) return px(0, 0, 0, 0);
    if (x === 2 || x === 13 || y === 14 || y === 4) return px(90, 90, 95);
    if (y >= 7) return px(220, 90, 20);
    return px(150, 150, 158);
  },
  'item/minecart.png': (x, y) => {
    if (y < 6 || y > 14 || x < 1 || x > 14) return px(0, 0, 0, 0);
    if (y >= 11) return (x + y) % 2 === 0 ? px(50, 50, 55) : px(80, 80, 86);
    return px(120, 120, 128);
  },
  'item/fire_arrow.png': (x, y) => {
    const shaft = y >= 4 && y <= 11 && x >= 2 && x <= 13 && Math.abs((y - 7.5) - (x - 8) * 0.15) < 1.6;
    const head = x >= 11 && y >= 5 && y <= 10;
    const flame = x <= 5 && y >= 3 && y <= 12;
    if (flame && (x + y) % 3 !== 0) return px(255, 140 - y * 4, 20);
    if (head) return px(160, 160, 170);
    if (shaft) return px(150, 105, 55);
    return px(0, 0, 0, 0);
  },
  'block/fire.png': (x, y) => {
    const height = 14 - ((x * 5 + 3) % 6);
    if (y > height) return px(0, 0, 0, 0);
    if (y < 4) return px(255, 230, 80, 220);
    if (y < 9) return px(255, 140, 20, 230);
    return px(220, 40, 10, 200);
  },
  'block/cobweb.png': (x, y) => {
    const diag = Math.abs(x - y) <= 1 || Math.abs(x + y - 15) <= 1;
    const plus = x === 7 || x === 8 || y === 7 || y === 8;
    if (diag || plus) return px(235, 235, 240);
    if ((x + y) % 5 === 0) return px(200, 200, 210, 180);
    return px(0, 0, 0, 0);
  },
  'block/rail.png': (x, y) => {
    const sleeper = y % 4 === 1;
    const rail = x === 3 || x === 4 || x === 11 || x === 12;
    if (rail) return px(140, 140, 148);
    if (sleeper && x >= 2 && x <= 13) return px(110, 70, 30);
    return px(0, 0, 0, 0);
  },
  'entity/minecart.png': (x, y) => {
    if (y < 8) return px(0, 0, 0, 0);
    if (y >= 20) return (x + y) % 2 === 0 ? px(40, 40, 44) : px(70, 70, 76);
    return px(110, 110, 118);
  },
};

export async function generateMissingTextures(force = false) {
  let written = 0;
  for (const [relative, plotter] of Object.entries(icons)) {
    const path = join(root, relative);
    if (!force) {
      try {
        await access(path);
        continue;
      } catch {
        // missing
      }
    }
    await mkdir(dirname(path), { recursive: true });
    const size = relative.startsWith('entity/') ? 32 : 16;
    await writeFile(path, paint(size, size, plotter));
    written += 1;
  }
  return written;
}

const isDirect = process.argv[1]?.includes('generate-missing-textures');
if (isDirect) {
  const written = await generateMissingTextures(process.argv.includes('--force'));
  console.log(`Wrote ${written} missing gameplay textures.`);
}
