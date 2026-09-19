import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';
import { alphaMask, eventLatchBounds, loadEventChestSource, paintEventChestAtlas } from '../scripts/paint-event-chest.mjs';

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

  it('keeps the source latch island opaque and contrasted in the painted atlas', async () => {
    const source = await loadEventChestSource();
    const painted = paintEventChestAtlas(source);
    const bounds = eventLatchBounds(source);
    expect(bounds.maxX).toBeGreaterThanOrEqual(bounds.minX);
    expect(bounds.maxY).toBeGreaterThanOrEqual(bounds.minY);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(2);
    expect(bounds.maxY - bounds.minY).toBeGreaterThanOrEqual(2);

    let sourceOpaque = 0;
    let paintedOpaque = 0;
    let minLuma = 1;
    let maxLuma = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const si = (y * source.width + x) * 4;
        const pi = (y * painted.width + x) * 4;
        const sa = source.data[si + 3];
        const pa = painted.data[pi + 3];
        if (sa > 8) sourceOpaque += 1;
        if (pa > 8) paintedOpaque += 1;
        if (pa <= 8) continue;
        const luma = (painted.data[pi] * 0.3 + painted.data[pi + 1] * 0.59 + painted.data[pi + 2] * 0.11) / 255;
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
    }
    expect(paintedOpaque).toBe(sourceOpaque);
    expect(paintedOpaque).toBeGreaterThan(8);
    expect(maxLuma - minLuma).toBeGreaterThan(0.12);
  });
});
