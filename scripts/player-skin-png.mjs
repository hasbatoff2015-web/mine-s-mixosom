/**
 * Shared 64×64 player-skin PNG decoder, Classic/Slim classifier, and outer-alpha scan.
 * Used by the catalog generator and `assets:validate-player-skins`. No Three.js, DOM, or Vite.
 */
import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const PLAYER_SKIN_SIZE = 64;

/** Opaque pixels required in the classic-only arm columns before a skin is classic. */
const CLASSIC_ONLY_MIN_OPAQUE = 24;
/** Classic-only arm pixels still allowed on a slim skin (stray texels). */
const SLIM_MAX_CLASSIC_ONLY = 2;
/** Slim arm island is 192 px. Both arms must actually be painted, not merely empty. */
const SLIM_MIN_OPAQUE = 96;

const BASE_ARMS = [
  { name: 'right', u: 40, v: 16 },
  { name: 'left', u: 32, v: 48 },
];

export class PlayerSkinCatalogError extends Error {
  /**
   * @param {string} fileName
   * @param {string} reason
   * @param {string} fix
   */
  constructor(fileName, reason, fix) {
    super(`${fileName}: ${reason} ${fix}`);
    this.name = 'PlayerSkinCatalogError';
    this.fileName = fileName;
    this.reason = reason;
    this.fix = fix;
  }
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

/**
 * @param {Buffer} png
 * @param {string} label
 */
function readChunks(png, label) {
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new PlayerSkinCatalogError(
      label,
      'The file is not a PNG (signature does not match).',
      'Export the skin as a PNG, not a JPEG or a renamed image.',
    );
  }
  /** @type {{ type: string, data: Buffer }[]} */
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new PlayerSkinCatalogError(
        label,
        'The PNG container is truncated.',
        'Re-export the 64×64 skin from a skin editor.',
      );
    }
    const length = png.readUInt32BE(offset);
    if (length < 0 || offset + 12 + length > png.length) {
      throw new PlayerSkinCatalogError(
        label,
        'A PNG chunk extends past the end of the file.',
        'Re-export the 64×64 skin from a skin editor.',
      );
    }
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const type = png.toString('ascii', typeStart, dataStart);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new PlayerSkinCatalogError(
        label,
        'The PNG contains a chunk with an invalid type.',
        'Re-export the 64×64 skin from a skin editor.',
      );
    }
    const actual = crc32(png.subarray(typeStart, dataEnd)) >>> 0;
    const expected = png.readUInt32BE(dataEnd);
    if (actual !== expected) {
      throw new PlayerSkinCatalogError(
        label,
        `PNG chunk ${type} has a bad CRC.`,
        'Re-export the file. Do not hand-edit the PNG bytes.',
      );
    }
    chunks.push({ type, data: png.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (chunks.at(-1)?.type !== 'IEND') {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG has no IEND chunk.',
      'Re-export the 64×64 skin from a skin editor.',
    );
  }
  if (offset !== png.length) {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG has trailing bytes after IEND.',
      'Re-export the 64×64 skin from a skin editor.',
    );
  }
  return chunks;
}

/**
 * @param {Buffer} png
 * @param {string} [label]
 * @returns {{ width: number, height: number, colorType: number, bitDepth: number, alpha: Uint8Array }}
 */
export function decodePlayerSkinPng(png, label = 'player-skin.png') {
  const chunks = readChunks(png, label);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr || ihdr.data.length !== 13) {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG is missing a valid IHDR header.',
      'Re-export a modern Minecraft Java skin as a 64×64 PNG.',
    );
  }
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const compression = ihdr.data[10];
  const filterMethod = ihdr.data[11];
  const interlace = ihdr.data[12];
  if (width !== PLAYER_SKIN_SIZE || height !== PLAYER_SKIN_SIZE) {
    throw new PlayerSkinCatalogError(
      label,
      `Size is ${width}×${height}; a player skin must be 64×64.`,
      'Use a modern Java layout. Legacy 64×32 skins are not accepted.',
    );
  }
  if (bitDepth !== 8 || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    throw new PlayerSkinCatalogError(
      label,
      `Unsupported PNG encoding (bit depth ${bitDepth}, compression ${compression}, filter ${filterMethod}, interlace ${interlace}).`,
      'Export a non-interlaced 8-bit PNG without interlacing.',
    );
  }
  if (colorType !== 6 && colorType !== 3) {
    throw new PlayerSkinCatalogError(
      label,
      `Unsupported PNG color type ${colorType}.`,
      'Export RGBA (color type 6) or indexed (color type 3) 8-bit PNG. RGB-without-alpha and grayscale are not accepted.',
    );
  }
  const palette = chunks.find((chunk) => chunk.type === 'PLTE');
  const transparencyChunk = chunks.find((chunk) => chunk.type === 'tRNS');
  if (colorType === 3 && (!palette || palette.data.length < 3 || palette.data.length % 3 !== 0)) {
    throw new PlayerSkinCatalogError(
      label,
      'Indexed PNG is missing a valid palette.',
      'Re-export the skin as RGBA or as an indexed PNG with a palette.',
    );
  }
  const idat = chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data);
  if (idat.length === 0) {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG has no image data.',
      'Re-export the 64×64 skin from a skin editor.',
    );
  }
  const channels = colorType === 6 ? 4 : 1;
  const stride = width * channels;
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(idat));
  } catch {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG image data could not be inflated.',
      'Re-export the 64×64 skin. The file is not a valid PNG payload.',
    );
  }
  if (filtered.length !== (stride + 1) * height) {
    throw new PlayerSkinCatalogError(
      label,
      'The PNG image data has an unexpected size.',
      'Re-export a non-interlaced 64×64 8-bit skin.',
    );
  }
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[source];
    source += 1;
    const row = y * stride;
    const previousRow = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[source];
      source += 1;
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[previousRow + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previousRow + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += Math.floor((left + above) / 2);
      else if (filter === 4) value += paethPredictor(left, above, upperLeft);
      else if (filter !== 0) {
        throw new PlayerSkinCatalogError(
          label,
          `Unsupported PNG scanline filter ${filter}.`,
          'Re-export the skin with standard PNG filters (None, Sub, Up, Average, or Paeth).',
        );
      }
      pixels[row + x] = value & 0xff;
    }
  }
  const alpha = new Uint8Array(width * height);
  if (colorType === 6) {
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3];
  } else {
    const transparency = transparencyChunk?.data ?? Buffer.alloc(0);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = transparency.length > 0 ? (transparency[pixels[index]] ?? 255) : 255;
    }
  }
  return { width, height, colorType, bitDepth, alpha };
}

/**
 * @param {string} path
 */
export function readPlayerSkinPng(path) {
  let png;
  try {
    png = readFileSync(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable';
    throw new PlayerSkinCatalogError(path, `The PNG could not be read (${reason}).`, 'Check that the file exists and is readable.');
  }
  return decodePlayerSkinPng(png, path);
}

/**
 * @param {Set<number>} mask
 * @param {number} u
 * @param {number} v
 * @param {number} width
 * @param {number} height
 */
function addRect(mask, u, v, width, height) {
  for (let y = v; y < v + height; y += 1) {
    for (let x = u; x < u + width; x += 1) mask.add(y * PLAYER_SKIN_SIZE + x);
  }
}

/**
 * Java cuboid UV island. Matches `cuboidUvRects` / the historical alpha scanner.
 * @param {Set<number>} mask
 * @param {number} u
 * @param {number} v
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 */
export function addSkinCuboid(mask, u, v, width, height, depth) {
  addRect(mask, u + depth, v, width, depth);
  addRect(mask, u + depth + width, v, width, depth);
  addRect(mask, u, v + depth, depth, height);
  addRect(mask, u + depth, v + depth, width, height);
  addRect(mask, u + depth + width, v + depth, depth, height);
  addRect(mask, u + depth + width + depth, v + depth, width, height);
}

/**
 * @param {'classic' | 'slim'} model
 */
export function playerSkinLayerMasks(model) {
  const armWidth = model === 'slim' ? 3 : 4;
  const base = new Set();
  const outer = new Set();
  addSkinCuboid(base, 0, 0, 8, 8, 8);
  addSkinCuboid(base, 16, 16, 8, 12, 4);
  addSkinCuboid(base, 40, 16, armWidth, 12, 4);
  addSkinCuboid(base, 32, 48, armWidth, 12, 4);
  addSkinCuboid(base, 0, 16, 4, 12, 4);
  addSkinCuboid(base, 16, 48, 4, 12, 4);
  addSkinCuboid(outer, 32, 0, 8, 8, 8);
  addSkinCuboid(outer, 16, 32, 8, 12, 4);
  addSkinCuboid(outer, 40, 32, armWidth, 12, 4);
  addSkinCuboid(outer, 48, 48, armWidth, 12, 4);
  addSkinCuboid(outer, 0, 32, 4, 12, 4);
  addSkinCuboid(outer, 0, 48, 4, 12, 4);
  return { base, outer };
}

/**
 * @param {Uint8Array} alpha
 * @param {Iterable<number>} pixels
 */
function countOpaque(alpha, pixels) {
  let count = 0;
  for (const index of pixels) {
    if ((alpha[index] ?? 0) > 16) count += 1;
  }
  return count;
}

/**
 * Classic arms occupy a 16px-wide island; slim arms occupy the left 14px and leave the last two columns empty.
 * Both base arms must agree. Empty or conflicting islands are ambiguous and fall back to classic.
 * @param {Uint8Array} alpha
 */
export function classifyPlayerSkinModel(alpha) {
  const arms = BASE_ARMS.map((arm) => {
    const classic = new Set();
    const slim = new Set();
    addSkinCuboid(classic, arm.u, arm.v, 4, 12, 4);
    addSkinCuboid(slim, arm.u, arm.v, 3, 12, 4);
    const classicOnly = [...classic].filter((index) => !slim.has(index));
    return {
      name: arm.name,
      classicOnlyPixels: classicOnly.length,
      classicOnlyOpaque: countOpaque(alpha, classicOnly),
      slimPixels: slim.size,
      slimOpaque: countOpaque(alpha, slim),
    };
  });
  const classicVotes = arms.filter((arm) => arm.classicOnlyOpaque >= CLASSIC_ONLY_MIN_OPAQUE).length;
  const slimVotes = arms.filter((arm) => (
    arm.classicOnlyOpaque <= SLIM_MAX_CLASSIC_ONLY && arm.slimOpaque >= SLIM_MIN_OPAQUE
  )).length;
  if (classicVotes === arms.length && slimVotes === 0) {
    return { model: 'classic', confidence: 'high', arms };
  }
  if (slimVotes === arms.length && classicVotes === 0) {
    return { model: 'slim', confidence: 'high', arms };
  }
  return { model: 'classic', confidence: 'ambiguous', arms };
}

/**
 * @param {Uint8Array} alpha
 * @param {'classic' | 'slim'} model
 */
export function scanPlayerSkinAlphaBuffer(alpha, model) {
  const masks = playerSkinLayerMasks(model);
  let intermediatePixels = 0;
  let baseIntermediatePixels = 0;
  let outerIntermediatePixels = 0;
  let unusedIntermediatePixels = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index] ?? 0;
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

/**
 * @param {string} path
 * @param {'classic' | 'slim'} model
 */
export function scanPlayerSkinAlpha(path, model) {
  const { alpha } = readPlayerSkinPng(path);
  return scanPlayerSkinAlphaBuffer(alpha, model);
}
