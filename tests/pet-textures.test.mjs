import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

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
});
