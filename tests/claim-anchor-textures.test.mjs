import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

function mean(img, pred) {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < img.width * img.height; i += 1) {
    const pr = img.data[i * 4];
    const pg = img.data[i * 4 + 1];
    const pb = img.data[i * 4 + 2];
    if (!pred(pr, pg, pb)) continue;
    n += 1;
    r += pr;
    g += pg;
    b += pb;
  }
  return n === 0 ? null : { n, r: r / n, g: g / n, b: b / n };
}

describe('claim-anchor block textures', () => {
  it('ships 16×16 diamond/gold/iron tiles with distinct palettes', async () => {
    const diamond = decodeRgbaPng(await readFile('public/textures/block/diamond_block.png'));
    const gold = decodeRgbaPng(await readFile('public/textures/block/gold_block.png'));
    const iron = decodeRgbaPng(await readFile('public/textures/block/iron_block.png'));
    for (const tile of [diamond, gold, iron]) {
      expect(tile.width).toBe(16);
      expect(tile.height).toBe(16);
    }
    const cyan = mean(diamond, (r, g, b) => b > r && g > r);
    const yellow = mean(gold, (r, g, b) => r > 200 && g > 100 && b < 80);
    const gray = mean(iron, (r, g, b) => Math.abs(r - g) < 8 && Math.abs(g - b) < 8);
    expect(cyan?.n).toBeGreaterThan(200);
    expect(yellow?.n).toBeGreaterThan(150);
    expect(gray?.n).toBeGreaterThan(200);
  });
});
