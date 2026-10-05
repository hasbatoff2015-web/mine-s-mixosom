import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { decodeRgbaPng } from '../scripts/png-rgba.mjs';

const IRON = 'assets/minecraft/textures/items/iron_sword.png';
const STICK = 'assets/minecraft/textures/items/stick.png';
const TITANIUM = 'public/textures/item/titanium_sword.png';
const GOD = 'public/textures/item/god_sword.png';

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function handleColors(stick) {
  const colors = new Set();
  for (let index = 0; index < stick.data.length; index += 4) {
    if (stick.data[index + 3] === 0) continue;
    colors.add(`${stick.data[index]},${stick.data[index + 1]},${stick.data[index + 2]}`);
  }
  return colors;
}

function isRed(data, index) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return red > 80 && red > green + 40 && red > blue + 40;
}

describe('God Sword texture', () => {
  it('keeps the iron sword silhouette, a darker blade, and a minority of red accents', async () => {
    const god = decodeRgbaPng(await readFile(GOD));
    const iron = decodeRgbaPng(await readFile(IRON));
    const titanium = decodeRgbaPng(await readFile(TITANIUM));
    const stick = decodeRgbaPng(await readFile(STICK));
    expect([god.width, god.height]).toEqual([32, 32]);
    expect([iron.width, iron.height]).toEqual([32, 32]);
    expect([titanium.width, titanium.height]).toEqual([32, 32]);
    expect(god.data.length).toBe(32 * 32 * 4);

    const handles = handleColors(stick);
    let opaque = 0;
    let red = 0;
    let hot = 0;
    const godMetal = [];
    const titaniumMetal = [];
    for (let index = 0; index < iron.data.length; index += 4) {
      expect(god.data[index + 3]).toBe(iron.data[index + 3]);
      if (iron.data[index + 3] === 0) {
        expect(god.data[index + 3]).toBe(0);
        continue;
      }
      opaque += 1;
      const key = `${iron.data[index]},${iron.data[index + 1]},${iron.data[index + 2]}`;
      if (handles.has(key)) {
        expect(god.data.subarray(index, index + 4)).toEqual(iron.data.subarray(index, index + 4));
      }
      if (isRed(god.data, index)) {
        red += 1;
        if (god.data[index] >= 240) hot += 1;
      } else if (!handles.has(key)) {
        godMetal.push(luminance(god.data[index], god.data[index + 1], god.data[index + 2]));
      }
      if (!handles.has(key)) {
        titaniumMetal.push(luminance(titanium.data[index], titanium.data[index + 1], titanium.data[index + 2]));
      }
    }
    expect(opaque).toBeGreaterThan(200);
    expect(red).toBeGreaterThanOrEqual(18);
    expect(red).toBeLessThan(opaque * 0.2);
    expect(hot).toBeGreaterThanOrEqual(8);
    const godMean = godMetal.reduce((sum, value) => sum + value, 0) / godMetal.length;
    const titaniumMean = titaniumMetal.reduce((sum, value) => sum + value, 0) / titaniumMetal.length;
    expect(godMean).toBeLessThan(titaniumMean * 0.7);
  });

  it('matches a second run of the generator', async () => {
    const before = await readFile(GOD);
    execFileSync('python3', ['scripts/generate-tier-assets.py', '--check', '--no-preview'], { stdio: 'pipe' });
    execFileSync('python3', ['scripts/generate-tier-assets.py', '--no-preview'], { stdio: 'pipe' });
    expect(await readFile(GOD)).toEqual(before);
  });
});
