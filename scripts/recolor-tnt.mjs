import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng } from './png-rgba.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tntPath = join(here, '..', 'public', 'textures', 'block', 'tnt.png');

function isRedBody(r, g, b) {
  return r > 100 && r >= g + 40 && r >= b + 40;
}

function decodeRgbPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Invalid PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bit = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bit !== 8 || interlace !== 0) throw new Error('Expected 8-bit non-interlaced PNG');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const data = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const ul = x >= channels ? prev[x - channels] : 0;
      const p = left + up - ul;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - ul);
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? (left + up) >> 1
              : pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      row[x] = (row[x] + predictor) & 255;
    }
    row.copy(prev);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = row[x * channels];
      data[i + 1] = row[x * channels + 1];
      data[i + 2] = row[x * channels + 2];
      data[i + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
  }
  return { width, height, data };
}

function recolor(src, mapPixel) {
  const data = Buffer.from(src.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!isRedBody(r, g, b)) continue;
    const next = mapPixel(r, g, b);
    data[i] = next[0];
    data[i + 1] = next[1];
    data[i + 2] = next[2];
  }
  return { width: src.width, height: src.height, data };
}

function toBlack(r) {
  const shade = Math.max(10, Math.min(48, Math.round(r * 0.18)));
  return [shade, shade, shade];
}

function toDarkPurple(r, g) {
  return [
    Math.max(18, Math.min(72, Math.round(r * 0.22))),
    Math.max(6, Math.min(28, Math.round(g * 0.45))),
    Math.max(36, Math.min(96, Math.round(r * 0.38))),
  ];
}

export async function writeTntVariantTextures(tntFile = tntPath) {
  const src = decodeRgbPng(await readFile(tntFile));
  const powerful = recolor(src, (r) => toBlack(r));
  const destructive = recolor(src, (r, g) => toDarkPurple(r, g));
  const dir = dirname(tntFile);
  await writeFile(join(dir, 'tnt_powerful.png'), encodeRgbaPng(powerful));
  await writeFile(join(dir, 'tnt_destructive.png'), encodeRgbaPng(destructive));
  return { width: src.width, height: src.height };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = await writeTntVariantTextures();
  console.log(`Wrote tnt_powerful.png and tnt_destructive.png (${result.width}×${result.height})`);
}
