import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('block breaking overlay production textures', () => {
  it('ships ten original 32×32 crack masks at gui/destroy', async () => {
    for (let stage = 0; stage <= 9; stage += 1) {
      const bytes = await readFile(`public/textures/gui/destroy/destroy_stage_${stage}.png`);
      expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(bytes.readUInt32BE(16)).toBe(32);
      expect(bytes.readUInt32BE(20)).toBe(32);
      expect(bytes.length).toBeGreaterThan(150);
    }
  });
});
