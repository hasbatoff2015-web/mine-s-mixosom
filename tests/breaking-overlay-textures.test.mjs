import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

describe('block breaking overlay production textures', () => {
  it('ships ten original 32×32 crack masks at gui/destroy', async () => {
    let previousOpaquePixels = 0;
    for (let stage = 0; stage <= 9; stage += 1) {
      const bytes = await readFile(`public/textures/gui/destroy/destroy_stage_${stage}.png`);
      expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      const decoded = decodeRgbaPng(bytes);
      expect(decoded.width).toBe(32);
      expect(decoded.height).toBe(32);
      let opaquePixels = 0;
      for (let index = 3; index < decoded.data.length; index += 4) {
        if (decoded.data[index] > 0) opaquePixels += 1;
      }
      expect(opaquePixels).toBeGreaterThan(previousOpaquePixels);
      previousOpaquePixels = opaquePixels;
    }
  });
});
