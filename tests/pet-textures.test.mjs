import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';
import { cuboidUvRects } from '../src/rendering/TexturedCuboid';

const WOLF = [
  'public/textures/entity/wolf/wolf.png',
  'public/textures/entity/wolf/wolf_angry.png',
  'public/textures/entity/wolf/wolf_tame.png',
  'public/textures/entity/wolf/wolf_collar.png',
];
const CAT = [
  'public/textures/entity/cat/black.png',
  'public/textures/entity/cat/red.png',
  'public/textures/entity/cat/siamese.png',
  'public/textures/entity/cat/ocelot.png',
];

function opaqueRatio(decoded, rect, logical = [64, 32]) {
  const scaleX = decoded.width / logical[0];
  const scaleY = decoded.height / logical[1];
  const u0 = Math.floor(rect.u * scaleX);
  const v0 = Math.floor(rect.v * scaleY);
  const u1 = Math.ceil((rect.u + rect.width) * scaleX);
  const v1 = Math.ceil((rect.v + rect.height) * scaleY);
  let opaque = 0;
  let total = 0;
  for (let y = v0; y < v1; y += 1) {
    for (let x = u0; x < u1; x += 1) {
      if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) continue;
      total += 1;
      if (decoded.data[(y * decoded.width + x) * 4 + 3] > 8) opaque += 1;
    }
  }
  return total === 0 ? 0 : opaque / total;
}

describe('wolf and cat entity textures', () => {
  it('keeps 128×64 physical sheets with readable alpha', async () => {
    for (const path of [...WOLF, ...CAT]) {
      const decoded = decodeRgbaPng(await readFile(path));
      expect(decoded.width, path).toBe(128);
      expect(decoded.height, path).toBe(64);
      expect(decoded.data.length, path).toBe(128 * 64 * 4);
      let transparent = 0;
      let opaque = 0;
      for (let index = 3; index < decoded.data.length; index += 4) {
        if (decoded.data[index] === 0) transparent += 1;
        else opaque += 1;
      }
      expect(transparent, path).toBeGreaterThan(0);
      expect(opaque, path).toBeGreaterThan(0);
    }
  });

  it('keeps wolf body core faces on opaque pixels of every body sheet', async () => {
    const mapped = cuboidUvRects({
      size: [6, 9, 6],
      textureOffset: [18, 14],
      logicalTextureSize: [64, 32],
      faceUvRects: { top: { u: 30, v: 14, width: 6, height: 6 } },
    });
    const legacyTop = cuboidUvRects({
      size: [6, 9, 6], textureOffset: [18, 14], logicalTextureSize: [64, 32],
    }).top;
    for (const path of WOLF.filter((entry) => !entry.endsWith('wolf_collar.png'))) {
      const decoded = decodeRgbaPng(await readFile(path));
      expect(opaqueRatio(decoded, legacyTop), `${path} vanilla top island`).toBe(0);
      expect(opaqueRatio(decoded, mapped.top), `${path} remapped top`).toBeGreaterThan(0.9);
      expect(opaqueRatio(decoded, mapped.front), path).toBeGreaterThan(0.9);
      expect(opaqueRatio(decoded, mapped.back), path).toBeGreaterThan(0.9);
      expect(opaqueRatio(decoded, mapped.left), path).toBeGreaterThan(0.9);
      expect(opaqueRatio(decoded, mapped.right), path).toBeGreaterThan(0.9);
    }
  });
});
