import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

const LATCH_HEX = [
  '000000000000ffec5cffec5ca8e64ea8e64effec5cffec5cffec5ca8e64e000000000000',
  '000000000000ffec5ca8e64ea8e64ea8e64effec5cffec5ca8e64ea8e64e000000000000',
  '1c4e481c4e481c4e481c4e483eba5c3eba5c1c4e481c4e481c4e481c4e483eba5c3eba5c',
  '1c4e481c4e481c4e483eba5c3eba5c3eba5c1c4e481c4e481c4e483eba5c3eba5c3eba5c',
  '3eba5c1c4e481c4e483eba5c3eba5ca8e64e1c4e481c4e481c4e483eba5c3eba5ca8e64e',
  '3eba5c1c4e481c4e483eba5ca8e64ea8e64e1c4e481c4e481c4e483eba5ca8e64ea8e64e',
  '3eba5c1c4e483eba5c3eba5ca8e64effec5c1c4e481c4e483eba5c3eba5ca8e64effec5c',
  'a8e64e3eba5c3eba5c3eba5ca8e64effec5c1c4e483eba5c3eba5c3eba5ca8e64effec5c',
  'a8e64e3eba5c3eba5ca8e64effec5cffec5c3eba5c3eba5c3eba5ca8e64effec5cffec5c',
  'a8e64ea8e64ea8e64effec5cffec5cffec5c3eba5ca8e64ea8e64effec5cffec5cffec5c',
];

function hexAt(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Buffer.from(img.data.subarray(i, i + 3)).toString('hex');
}

function latchHexRows(img) {
  return Array.from({ length: 10 }, (_, y) => {
    let row = '';
    for (let x = 0; x < 12; x += 1) row += hexAt(img, x, y);
    return row;
  });
}

function countChannel(img, x, y, w, h, pred) {
  let n = 0;
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const p = (y + j) * img.width + (x + i);
      const r = img.data[p * 4];
      const g = img.data[p * 4 + 1];
      const b = img.data[p * 4 + 2];
      if (pred(r, g, b)) n += 1;
    }
  }
  return n;
}

describe('portal chest visual assets', () => {
  it('keeps the 128×128 atlas UV size and the gold/lime latch 12×10', async () => {
    const portal = decodeRgbaPng(await readFile('public/textures/entity/chest/portal.png'));
    expect(portal.width).toBe(128);
    expect(portal.height).toBe(128);
    expect(latchHexRows(portal)).toEqual(LATCH_HEX);
  });

  it('paints portal accents on the body/lid without recolouring the latch', async () => {
    const portal = decodeRgbaPng(await readFile('public/textures/entity/chest/portal.png'));
    const purple = (r, g, b) => r > 80 && b > 140 && g < 130;
    const teal = (r, g, b) => g > r + 8 && g > 36 && b > 36 && r < 50;
    const lidTopPurple = countChannel(portal, 56, 0, 28, 28, purple);
    const bodyFrontPurple = countChannel(portal, 84, 66, 28, 20, purple);
    const bodySidePurple = countChannel(portal, 0, 66, 28, 20, purple);
    const bodyFrontTeal = countChannel(portal, 84, 66, 28, 20, teal);
    expect(lidTopPurple).toBeGreaterThan(40);
    expect(bodyFrontPurple).toBeGreaterThan(8);
    expect(bodySidePurple).toBeGreaterThan(8);
    expect(bodyFrontTeal).toBeGreaterThan(20);
    expect(countChannel(portal, 0, 0, 12, 10, purple)).toBe(0);
  });

  it('does not change the ordinary wooden chest sheet', async () => {
    const normal = decodeRgbaPng(await readFile('public/textures/entity/chest/normal.png'));
    expect(normal.width).toBe(128);
    expect(normal.height).toBe(128);
    expect(latchHexRows(normal)).not.toEqual(LATCH_HEX);
    expect(hexAt(normal, 4, 0)).not.toBe('ffec5c');
  });

  it('ships a 16×16 portal_chest fallback tile', async () => {
    const tile = decodeRgbaPng(await readFile('public/textures/block/portal_chest.png'));
    expect(tile.width).toBe(16);
    expect(tile.height).toBe(16);
  });
});
