/**
 * Writes pack-missing gameplay textures as small unique PNGs.
 * Used when the local Faithful tree is absent, and as a fallback after
 * `assets:import` if a mapped source file was not in the pack.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
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

function fromMap(rows, palette) {
  return (x, y) => {
    const row = rows[y];
    if (!row || x >= row.length) return px(0, 0, 0, 0);
    return palette[row[x]] ?? px(0, 0, 0, 0);
  };
}

const FIRE_FRAMES = 8;
const FIRE_SIZE = 16;

function hash2(x, y, frame) {
  let n = (x * 374761393 + y * 668265263 + frame * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fireFramePixel(frame, x, y) {
  const fromBottom = FIRE_SIZE - 1 - y;
  if (fromBottom < 0) return px(0, 0, 0, 0);
  const tongues = [
    { cx: 3.2 + Math.sin(frame * 0.9) * 0.7, width: 2.1, height: 11 + Math.sin(frame * 1.1 + 0.2) * 2.2 },
    { cx: 7.8 + Math.cos(frame * 0.8) * 0.6, width: 3.1, height: 14.2 + Math.sin(frame * 0.95 + 1.3) * 1.4 },
    { cx: 12.4 + Math.sin(frame * 1.05 + 2) * 0.7, width: 2.3, height: 11.6 + Math.cos(frame * 0.85) * 2 },
  ];
  let heat = 0;
  for (const tongue of tongues) {
    const dx = Math.abs(x + 0.5 - tongue.cx);
    const top = tongue.height;
    if (fromBottom > top) continue;
    const flare = 1 + (fromBottom / Math.max(1, top)) * 0.55;
    const half = tongue.width * flare * (0.55 + (1 - fromBottom / top) * 0.55);
    if (dx > half) continue;
    const edge = 1 - dx / half;
    const rise = fromBottom / top;
    const jagged = 0.78 + hash2(x, frame, Math.floor(fromBottom)) * 0.35;
    if (rise > jagged) continue;
    const hole = hash2(x * 3, fromBottom, frame);
    if (rise > 0.55 && hole > 0.72) continue;
    heat = Math.max(heat, edge * (1 - rise * 0.42) * jagged);
  }
  if (heat < 0.16) return px(0, 0, 0, 0);
  if (fromBottom < 3 + hash2(x, frame, 3) * 1.5) {
    return px(255, 248 - fromBottom * 8, 170 + fromBottom * 10, 255);
  }
  if (heat > 0.78 && fromBottom < 7) return px(255, 230, 90);
  if (fromBottom < 8) return px(255, 168 - frame, 28);
  if (fromBottom < 12) return px(255, 110, 18);
  return px(198, 42, 8, 240);
}

const icons = {
  'item/flint_and_steel.png': fromMap([
    '................',
    '..sss...........',
    '.sHHHs..........',
    '.sH..Hs.........',
    '.sH...s.........',
    '.sH..Hs.........',
    '.sHHHs..........',
    '..sss...........',
    '.........xxx....',
    '........xxXxx...',
    '.......xxX.Xx...',
    '......xxxXXxx...',
    '.......xxXxx....',
    '........xxx.....',
    '................',
    '................',
  ], {
    '.': px(0, 0, 0, 0),
    s: px(62, 62, 70),
    H: px(188, 192, 202),
    x: px(28, 28, 32),
    X: px(72, 74, 80),
  }),
  'item/fire_arrow.png': fromMap([
    '.............FY.',
    '............FYF.',
    '...........YF#F.',
    '..........F#MF..',
    '.........s#M.F..',
    '........s#s.....',
    '.......s#s......',
    '......s#s.......',
    '.....W#s........',
    '....W#..........',
    '...WW...........',
    '..WwW...........',
    '.WW.............',
    '................',
    '................',
    '................',
  ], {
    '.': px(0, 0, 0, 0),
    s: px(132, 88, 42),
    '#': px(168, 118, 58),
    M: px(168, 170, 178),
    W: px(236, 236, 240),
    w: px(186, 186, 194),
    Y: px(255, 236, 96),
    F: px(255, 132, 22),
  }),
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
        const existing = await readFile(path);
        const tinyStub = existing.length < 250 && (
          relative === 'item/flint_and_steel.png' || relative === 'item/fire_arrow.png'
        );
        if (!tinyStub) continue;
      } catch {
        // missing
      }
    }
    await mkdir(dirname(path), { recursive: true });
    const size = relative.startsWith('entity/') ? 32 : 16;
    await writeFile(path, paint(size, size, plotter));
    written += 1;
  }
  const firePath = join(root, 'block/fire.png');
  let writeFire = force;
  if (!writeFire) {
    try {
      const existing = await readFile(firePath);
      const width = existing.readUInt32BE(16);
      const height = existing.readUInt32BE(20);
      writeFire = height <= width;
    } catch {
      writeFire = true;
    }
  }
  if (writeFire) {
    await mkdir(dirname(firePath), { recursive: true });
    await writeFile(firePath, paint(FIRE_SIZE, FIRE_SIZE * FIRE_FRAMES, (x, y) => {
      const frameFromBottom = FIRE_FRAMES - 1 - Math.floor(y / FIRE_SIZE);
      const localY = y % FIRE_SIZE;
      return fireFramePixel(frameFromBottom, x, localY);
    }));
    written += 1;
  }
  return written;
}

const isDirect = process.argv[1]?.includes('generate-missing-textures');
if (isDirect) {
  const written = await generateMissingTextures(process.argv.includes('--force'));
  console.log(`Wrote ${written} missing gameplay textures.`);
}
