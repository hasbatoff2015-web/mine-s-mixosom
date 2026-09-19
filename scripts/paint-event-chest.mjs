/**
 * Crimson Relic event-chest atlas.
 *
 * Recolours an existing chest entity sheet in place so UV islands, canvas
 * size and the alpha mask stay 1:1 with the source. The Windows-only
 * `event_chest.png` asset is not in this repo; `scripts/event-chest-source.png`
 * is the checked-in UV/alpha source (vanilla/Faithful 128×128 chest layout).
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRgbaPng, encodeRgbaPng } from './png-rgba.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS_SOURCE = 'E:/Games/Minecraft123/assets/minecraft/textures/entity/chest/event_chest.png';
const sourcePath = join(root, 'scripts/event-chest-source.png');
const fallbackSource = join(root, 'public/textures/entity/chest/normal.png');
const outEntity = join(root, 'public/textures/entity/chest/event.png');
const outBlock = join(root, 'public/textures/block/event_chest.png');

const px = (r, g, b, a = 255) => [r, g, b, a];

const GUNMETAL = px(32, 36, 42);
const GUNMETAL_HI = px(58, 64, 74);
const CRIMSON_LO = px(62, 10, 16);
const CRIMSON = px(118, 18, 28);
const CRIMSON_MID = px(148, 28, 38);
const CRIMSON_HI = px(176, 48, 52);
const VARNISH = px(210, 72, 64);
const GOLD_LO = px(120, 82, 28);
const GOLD = px(198, 148, 48);
const GOLD_HI = px(236, 198, 92);
const RUBY_LO = px(120, 8, 22);
const RUBY = px(196, 24, 46);
const RUBY_HI = px(255, 72, 88);

function get(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function put(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = color[0];
  img.data[i + 1] = color[1];
  img.data[i + 2] = color[2];
  img.data[i + 3] = color[3] ?? img.data[i + 3];
}

function opaque(img, x, y) {
  return get(img, x, y)[3] > 8;
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

function luma(r, g, b) {
  return (r * 0.3 + g * 0.59 + b * 0.11) / 255;
}

function recolorPixel(r, g, b) {
  const light = luma(r, g, b);
  const brown = r > g + 8 && r > b && g < 140;
  if (light < 0.08) return GUNMETAL;
  if (light < 0.16) return lerpColor(GUNMETAL, CRIMSON_LO, 0.55);
  if (!brown && light > 0.55 && Math.abs(r - g) < 20) return lerpColor(GUNMETAL_HI, GOLD, 0.35);
  if (light < 0.28) return lerpColor(CRIMSON_LO, CRIMSON, (light - 0.16) / 0.12);
  if (light < 0.45) return lerpColor(CRIMSON, CRIMSON_MID, (light - 0.28) / 0.17);
  if (light < 0.62) return lerpColor(CRIMSON_MID, CRIMSON_HI, (light - 0.45) / 0.17);
  return lerpColor(CRIMSON_HI, VARNISH, Math.min(1, (light - 0.62) / 0.3));
}

function paintIfOpaque(img, x, y, color) {
  const [, , , a] = get(img, x, y);
  if (a <= 8) return;
  put(img, x, y, [color[0], color[1], color[2], a]);
}

function diamond(cx, cy, radius, pred) {
  const cells = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.abs(x) + Math.abs(y) <= radius && pred(x, y, Math.abs(x) + Math.abs(y))) {
        cells.push([cx + x, cy + y]);
      }
    }
  }
  return cells;
}

function overlayLidOrnament(img) {
  const ox = 56;
  const oy = 0;
  const cx = ox + 13;
  const cy = oy + 13;
  for (const [x, y] of diamond(cx, cy, 9, (_x, _y, d) => d === 9 || d === 8)) {
    paintIfOpaque(img, x, y, GOLD_LO);
  }
  for (const [x, y] of diamond(cx, cy, 7, (_x, _y, d) => d === 7 || d === 6)) {
    paintIfOpaque(img, x, y, GOLD);
  }
  for (const [x, y] of diamond(cx, cy, 4, (_x, _y, d) => d >= 2)) {
    paintIfOpaque(img, x, y, dOf(x, y, cx, cy) <= 2 ? RUBY_HI : RUBY);
  }
  paintIfOpaque(img, cx, cy, RUBY_HI);
  paintIfOpaque(img, cx, cy - 1, GOLD_HI);
  for (const [dx, dy] of [[-10, -10], [10, -10], [-10, 10], [10, 10], [0, -11], [0, 11], [-11, 0], [11, 0]]) {
    paintIfOpaque(img, cx + dx, cy + dy, GOLD);
  }
}

function dOf(x, y, cx, cy) {
  return Math.abs(x - cx) + Math.abs(y - cy);
}

function overlayFrontOrnament(img) {
  const ox = 84;
  const oy = 66;
  for (let x = 4; x <= 23; x += 1) {
    paintIfOpaque(img, ox + x, oy + 1, GUNMETAL_HI);
    paintIfOpaque(img, ox + x, oy + 18, GUNMETAL);
  }
  const cx = ox + 13;
  const cy = oy + 8;
  for (const [x, y] of diamond(cx, cy, 5, (_x, _y, d) => d === 5 || d === 4)) {
    paintIfOpaque(img, x, y, GOLD);
  }
  for (const [x, y] of diamond(cx, cy, 3, () => true)) {
    paintIfOpaque(img, x, y, dOf(x, y, cx, cy) <= 1 ? RUBY_HI : RUBY);
  }
  paintIfOpaque(img, cx, cy, RUBY_HI);
  paintIfOpaque(img, cx, cy - 1, GOLD_HI);
}

function overlayLatch(img) {
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      if (!opaque(img, x, y)) continue;
      const edge = x <= 1 || x >= 10 || y <= 1 || y >= 8;
      const gem = x >= 4 && x <= 7 && y >= 3 && y <= 6;
      if (gem) paintIfOpaque(img, x, y, (x === 5 || x === 6) && (y === 4 || y === 5) ? RUBY_HI : RUBY);
      else if (edge) paintIfOpaque(img, x, y, y <= 1 ? GOLD_HI : GOLD);
      else paintIfOpaque(img, x, y, GOLD_LO);
    }
  }
}

function overlaySideTrim(img, ox, oy, w, h) {
  for (let x = 0; x < w; x += 1) {
    paintIfOpaque(img, ox + x, oy + 1, GUNMETAL_HI);
    paintIfOpaque(img, ox + x, oy + h - 2, GUNMETAL);
    if (x === 2 || x === w - 3) {
      for (let y = 2; y < h - 2; y += 1) paintIfOpaque(img, ox + x, oy + y, GUNMETAL);
    }
  }
}

export function paintEventChestAtlas(source) {
  const img = {
    width: source.width,
    height: source.height,
    data: Buffer.from(source.data),
  };
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [r, g, b, a] = get(img, x, y);
      if (a <= 8) continue;
      const color = recolorPixel(r, g, b);
      put(img, x, y, [color[0], color[1], color[2], a]);
    }
  }
  overlayLidOrnament(img);
  overlayFrontOrnament(img);
  overlaySideTrim(img, 0, 66, 28, 20);
  overlaySideTrim(img, 28, 66, 28, 20);
  overlaySideTrim(img, 56, 66, 28, 20);
  overlayLatch(img);
  grainFromSource(img, source);
  return img;
}

function grainFromSource(img, source) {
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [, , , a] = get(img, x, y);
      if (a <= 8) continue;
      if (x < 12 && y < 10) continue;
      const [sr, sg, sb] = get(source, x, y);
      const n = (x * 17 + y * 31 + (sr + sg * 3 + sb) * 5) & 7;
      const [r, g, b] = get(img, x, y);
      if (n === 0) put(img, x, y, [Math.max(0, r - 18), Math.max(0, g - 10), Math.max(0, b - 8), a]);
      else if (n === 1) put(img, x, y, [Math.min(255, r + 16), Math.min(255, g + 8), Math.min(255, b + 4), a]);
      else if (n === 2 && luma(r, g, b) > 0.28) {
        put(img, x, y, [Math.min(255, r + 8), Math.min(255, g + 12), Math.min(255, b + 2), a]);
      }
    }
  }
  const studs = [
    [2, 68], [25, 68], [2, 82], [25, 82],
    [30, 68], [53, 68], [30, 82], [53, 82],
    [58, 68], [81, 68], [58, 82], [81, 82],
    [86, 68], [109, 68], [86, 82], [109, 82],
    [58, 2], [81, 2], [58, 25], [81, 25],
  ];
  for (const [sx, sy] of studs) paintIfOpaque(img, sx, sy, GOLD);
}

function paintBlockIcon(entity) {
  const img = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      put(img, x, y, GUNMETAL);
    }
  }
  for (let y = 1; y <= 14; y += 1) {
    for (let x = 1; x <= 14; x += 1) {
      const light = y < 6 ? 0.7 : 0.45;
      put(img, x, y, lerpColor(CRIMSON_LO, CRIMSON_HI, light - (x % 3) * 0.04));
    }
  }
  for (let x = 1; x <= 14; x += 1) {
    put(img, x, 1, GUNMETAL_HI);
    put(img, x, 6, GOLD_LO);
    put(img, x, 14, GUNMETAL);
  }
  for (let y = 1; y <= 14; y += 1) {
    put(img, 1, y, GUNMETAL_HI);
    put(img, 14, y, GUNMETAL);
  }
  put(img, 7, 7, GOLD);
  put(img, 8, 7, GOLD);
  put(img, 7, 8, RUBY);
  put(img, 8, 8, RUBY_HI);
  put(img, 7, 9, RUBY);
  put(img, 8, 9, RUBY);
  put(img, 6, 8, GOLD);
  put(img, 9, 8, GOLD);
  if (entity) {
    const sample = get(entity, 90, 74);
    put(img, 4, 4, sample);
  }
  return img;
}

export function alphaMask(img) {
  const mask = Buffer.alloc(img.width * img.height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = img.data[i * 4 + 3] > 8 ? 1 : 0;
  return mask;
}

export function eventLatchBounds(img) {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  const limit = Math.min(16, img.width, img.height);
  for (let y = 0; y < limit; y += 1) {
    for (let x = 0; x < limit; x += 1) {
      if (img.data[(y * img.width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export async function loadEventChestSource() {
  const candidates = [WINDOWS_SOURCE, sourcePath, fallbackSource];
  let lastError;
  for (const path of candidates) {
    try {
      return decodeRgbaPng(await readFile(path));
    } catch (error) {
      lastError = error;
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  throw lastError;
}

export async function writeEventChestTextures() {
  const source = await loadEventChestSource();
  if (source.width !== 128 || source.height !== 128) {
    throw new Error(`event chest source must be 128×128, got ${source.width}×${source.height}`);
  }
  const painted = paintEventChestAtlas(source);
  if (painted.width !== source.width || painted.height !== source.height) {
    throw new Error('painted atlas changed canvas size');
  }
  const srcMask = alphaMask(source);
  const dstMask = alphaMask(painted);
  if (!srcMask.equals(dstMask)) throw new Error('alpha mask diverged from source');
  await writeFile(outEntity, encodeRgbaPng(painted));
  await writeFile(outBlock, encodeRgbaPng(paintBlockIcon(painted)));
  try {
    await readFile(sourcePath);
  } catch {
    await copyFile(fallbackSource, sourcePath);
  }
  return { sourcePath, outEntity, outBlock };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const written = await writeEventChestTextures();
  console.log('wrote', written.outEntity);
  console.log('wrote', written.outBlock);
  console.log('source', written.sourcePath);
}
