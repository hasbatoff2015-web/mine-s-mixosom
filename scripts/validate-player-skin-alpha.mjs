import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodeAlpha(path) {
  const png = readFileSync(path);
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${path} is not a PNG.`);
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let transparency = Buffer.alloc(0);
  const imageData = [];
  for (let offset = PNG_SIGNATURE.length; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'tRNS') transparency = data;
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (width !== 64 || height !== 64 || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`${path} must be a non-interlaced 64x64 PNG with 8-bit channels.`);
  }
  const channels = colorType === 6 ? 4 : colorType === 3 ? 1 : 0;
  if (channels === 0) throw new Error(`${path} uses unsupported PNG color type ${colorType}.`);
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(imageData));
  if (filtered.length !== (stride + 1) * height) throw new Error(`${path} has unexpected scanline data.`);
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[source++];
    const row = y * stride;
    const previousRow = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[source++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[previousRow + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previousRow + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += Math.floor((left + above) / 2);
      else if (filter === 4) value += paethPredictor(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`${path} uses unsupported PNG filter ${filter}.`);
      pixels[row + x] = value & 0xff;
    }
  }
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = colorType === 6
      ? pixels[index * channels + 3]
      : (transparency[pixels[index]] ?? 255);
  }
  return { width, height, alpha };
}

function addRect(mask, u, v, width, height) {
  for (let y = v; y < v + height; y += 1) {
    for (let x = u; x < u + width; x += 1) mask.add(y * 64 + x);
  }
}

function addCuboid(mask, u, v, width, height, depth) {
  addRect(mask, u + depth, v, width, depth);
  addRect(mask, u + depth + width, v, width, depth);
  addRect(mask, u, v + depth, depth, height);
  addRect(mask, u + depth, v + depth, width, height);
  addRect(mask, u + depth + width, v + depth, depth, height);
  addRect(mask, u + depth + width + depth, v + depth, width, height);
}

function layerMasks(model) {
  const armWidth = model === 'slim' ? 3 : 4;
  const base = new Set();
  const outer = new Set();
  addCuboid(base, 0, 0, 8, 8, 8);
  addCuboid(base, 16, 16, 8, 12, 4);
  addCuboid(base, 40, 16, armWidth, 12, 4);
  addCuboid(base, 32, 48, armWidth, 12, 4);
  addCuboid(base, 0, 16, 4, 12, 4);
  addCuboid(base, 16, 48, 4, 12, 4);
  addCuboid(outer, 32, 0, 8, 8, 8);
  addCuboid(outer, 16, 32, 8, 12, 4);
  addCuboid(outer, 40, 32, armWidth, 12, 4);
  addCuboid(outer, 48, 48, armWidth, 12, 4);
  addCuboid(outer, 0, 32, 4, 12, 4);
  addCuboid(outer, 0, 48, 4, 12, 4);
  return { base, outer };
}

export function scanPlayerSkinAlpha(path, model) {
  const { alpha } = decodeAlpha(path);
  const masks = layerMasks(model);
  let intermediatePixels = 0;
  let baseIntermediatePixels = 0;
  let outerIntermediatePixels = 0;
  let unusedIntermediatePixels = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index];
    if (value === 0 || value === 255) continue;
    intermediatePixels += 1;
    if (masks.base.has(index)) baseIntermediatePixels += 1;
    else if (masks.outer.has(index)) outerIntermediatePixels += 1;
    else unusedIntermediatePixels += 1;
  }
  return {
    hasBinaryAlpha: intermediatePixels === 0,
    hasIntermediateAlpha: intermediatePixels > 0,
    intermediatePixels,
    baseIntermediatePixels,
    outerIntermediatePixels,
    unusedIntermediatePixels,
  };
}

function productionDescriptors(projectRoot) {
  const source = readFileSync(resolve(projectRoot, 'src/player/appearance/builtinSkins.ts'), 'utf8');
  const entry = /\{\s*id:\s*'([^']+)'\s*,\s*texturePath:\s*'([^']+)'\s*,\s*defaultModel:\s*'(classic|slim)'(?:\s*,\s*outerLayerAlpha:\s*'(translucent)')?\s*\}/g;
  return [...source.matchAll(entry)].map((match) => ({
    id: match[1],
    texturePath: match[2],
    defaultModel: match[3],
    outerLayerAlpha: match[4] ?? 'binary',
  })).filter((skin) => skin.texturePath.startsWith('player/skins/'));
}

export function scanProductionPlayerSkins(projectRoot = process.cwd()) {
  return productionDescriptors(projectRoot).map((skin) => ({
    skinId: skin.id,
    model: skin.defaultModel,
    declaredOuterAlpha: skin.outerLayerAlpha,
    ...scanPlayerSkinAlpha(
      resolve(projectRoot, 'public', 'textures', `${skin.texturePath}.png`),
      skin.defaultModel,
    ),
  }));
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  const results = scanProductionPlayerSkins();
  console.table(results);
  const mismatches = results.filter((skin) => (
    skin.declaredOuterAlpha === 'translucent'
  ) !== (skin.outerIntermediatePixels > 0));
  if (mismatches.length > 0) {
    console.error('Player skin outer-alpha metadata does not match PNG contents:', mismatches.map((skin) => skin.skinId));
    process.exitCode = 1;
  }
}
