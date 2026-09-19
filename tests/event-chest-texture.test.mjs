import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';
import { alphaMask, loadEventChestSource, paintEventChestAtlas } from '../scripts/paint-event-chest.mjs';

describe('event chest visual assets', () => {
  it('keeps the source canvas size and alpha mask', async () => {
    const source = await loadEventChestSource();
    const painted = paintEventChestAtlas(source);
    expect(source.width).toBe(128);
    expect(source.height).toBe(128);
    expect(painted.width).toBe(source.width);
    expect(painted.height).toBe(source.height);
    expect(alphaMask(painted).equals(alphaMask(source))).toBe(true);
  });

  it('ships the generated entity sheet and 16×16 fallback tile', async () => {
    const entity = decodeRgbaPng(await readFile('public/textures/entity/chest/event.png'));
    const tile = decodeRgbaPng(await readFile('public/textures/block/event_chest.png'));
    const source = await loadEventChestSource();
    expect(entity.width).toBe(128);
    expect(entity.height).toBe(128);
    expect(alphaMask(entity).equals(alphaMask(source))).toBe(true);
    expect(tile.width).toBe(16);
    expect(tile.height).toBe(16);
  });

  it('paints crimson / gold / ruby without punching holes in the UV islands', async () => {
    const entity = decodeRgbaPng(await readFile('public/textures/entity/chest/event.png'));
    const crimson = (r, g, b) => r > 90 && r > g + 20 && r > b + 20;
    const gold = (r, g, b) => r > 150 && g > 90 && b < 120 && r > b + 40;
    const ruby = (r, g, b) => r > 170 && g < 90 && b < 110;
    let crimsonCount = 0;
    let goldCount = 0;
    let rubyCount = 0;
    for (let i = 0; i < entity.width * entity.height; i += 1) {
      const r = entity.data[i * 4];
      const g = entity.data[i * 4 + 1];
      const b = entity.data[i * 4 + 2];
      const a = entity.data[i * 4 + 3];
      if (a <= 8) continue;
      if (crimson(r, g, b)) crimsonCount += 1;
      if (gold(r, g, b)) goldCount += 1;
      if (ruby(r, g, b)) rubyCount += 1;
    }
    expect(crimsonCount).toBeGreaterThan(800);
    expect(goldCount).toBeGreaterThan(20);
    expect(rubyCount).toBeGreaterThan(10);
  });
});
